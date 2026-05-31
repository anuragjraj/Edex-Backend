// ════════════════════════════════════════════════════════════════
//  ROUTES: CHAPTER COURSES  (mounted at /api/chapter-courses)
//  Background module generation + SSE progress streaming.
// ════════════════════════════════════════════════════════════════
const express = require('express');
const jwt     = require('jsonwebtoken');
const { verifyToken, checkAccess } = require('../middleware/auth');
const { ytSearch, ytTranscript, getBestTranscript } = require('../services/youtube');
const {
  aiGenerateModuleContent,
  moduleEventBus,
  moduleListKey,
  moduleContentKey,
  getCacheEntry,
  setCacheEntry,
  getModuleCount,
  generateChapterCourse,
} = require('../services/chapterCourse');

const router = express.Router();

/**
 * GET /api/chapter-courses/list/:key
 * Returns the cached module list for a chapter (or null if not generated yet).
 */
router.get('/list/:key', async (req, res) => {
  const entry = await getCacheEntry(req.params.key);
  if (!entry) return res.json(null);
  try { res.json(JSON.parse(entry.notes)); }
  catch { res.json(null); }
});

/**
 * GET /api/chapter-courses/module/:key
 * Returns cached content for a single module (or null).
 */
router.get('/module/:key', async (req, res) => {
  const entry = await getCacheEntry(req.params.key);
  if (!entry) return res.json(null);
  try { res.json(JSON.parse(entry.notes)); }
  catch { res.json(null); }
});

/**
 * POST /api/chapter-courses/generate
 * Starts background generation of ALL modules for a chapter.
 * Returns immediately with { courseKey, existing: bool }
 * Frontend should then connect to SSE stream.
 */
router.post('/generate', verifyToken, checkAccess, async (req, res) => {
  const { subject, cls, chapter } = req.body;
  if (!subject || !cls || !chapter)
    return res.status(400).json({ error: 'subject, cls, chapter required' });

  const listKey = moduleListKey(subject, cls, chapter);

  // Return existing if already generated
  const existing = await getCacheEntry(listKey);
  if (existing) {
    try {
      const parsed = JSON.parse(existing.notes);
      if (parsed?.modules?.length) return res.json({ courseKey: listKey, existing: true });
    } catch {}
  }

  // Start generation in background
  res.json({ courseKey: listKey, existing: false });

  const moduleCount = getModuleCount(req.user);
  generateChapterCourse(listKey, subject, cls, chapter, moduleCount, req.user.id).catch(e =>
    console.error('[generateChapterCourse]', e.message)
  );
});

/**
 * GET /api/chapter-courses/stream/:key
 * SSE endpoint for real-time generation progress.
 * Query param: token=<jwt>  (for SSE which can't set Authorization header)
 */
router.get('/stream/:key', async (req, res) => {
  // Auth via query param for SSE
  const token = req.headers.authorization?.slice(7) || req.query.token;
  if (!token) return res.status(401).json({ error: 'token required' });
  try { jwt.verify(token, process.env.JWT_SECRET); }
  catch { return res.status(401).json({ error: 'invalid token' }); }

  res.setHeader('Content-Type',  'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection',    'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  const courseKey = req.params.key;
  const send      = data => res.write(`data: ${JSON.stringify(data)}\n\n`);
  const keepAlive = setInterval(() => res.write(': ping\n\n'), 20000);
  const emitter   = moduleEventBus.get(courseKey);

  send({ type: 'connected' });

  if (!emitter) {
    // Check if already done
    const cached = await getCacheEntry(courseKey);
    if (cached) {
      try { send({ type: 'already_done', data: JSON.parse(cached.notes) }); }
      catch {}
    } else {
      send({ type: 'no_stream' });
    }
    clearInterval(keepAlive);
    return res.end();
  }

  emitter.on('update', send);
  req.on('close', () => {
    clearInterval(keepAlive);
    emitter.off('update', send);
  });
});

/**
 * POST /api/chapter-courses/module/regenerate
 * Regenerates content for a single module (e.g. after swapping video).
 */
router.post('/module/regenerate', verifyToken, checkAccess, async (req, res) => {
  const { subject, cls, chapter, moduleId, videoId, moduleTitle, searchQuery } = req.body;
  if (!subject || !cls || !chapter || moduleId === undefined)
    return res.status(400).json({ error: 'subject, cls, chapter, moduleId required' });

  const modKey = moduleContentKey(subject, cls, chapter, moduleId);
  res.json({ ok: true, modKey });

  // Background: fetch transcript for new video, regenerate content
  (async () => {
    try {
      let transcript = null;
      if (videoId) {
        transcript = await ytTranscript(videoId);
      } else if (searchQuery) {
        const videos = await ytSearch(`${searchQuery} ${subject} ${cls} CBSE`, 5);
        const best   = await getBestTranscript(videos);
        transcript = best.transcript;
      }

      const content = await aiGenerateModuleContent(
        moduleTitle || `Module ${moduleId}`, chapter, subject, cls, transcript
      );

      // Get existing module data and merge
      const existing = await getCacheEntry(modKey);
      let modData = {};
      try { modData = JSON.parse(existing?.notes || '{}'); } catch {}

      await setCacheEntry(modKey, {
        ...modData,
        notes:      content.notes,
        qa:         content.qa,
        quiz:       content.quiz,
        transcript: transcript || null,
        transcriptStatus: transcript ? 'success' : 'unavailable',
        videoId:    videoId || modData.videoId,
      }, { subject, cls, chapter });
    } catch (e) {
      console.error('[module regenerate]', e.message);
    }
  })();
});

/**
 * PATCH /api/chapter-courses/module/video
 * Swap to a different video for a module — triggers transcript fetch + content regen.
 * Returns new search results for the module.
 */
router.patch('/module/video', verifyToken, async (req, res) => {
  const { subject, cls, chapter, moduleId, newVideoId, moduleTitle } = req.body;
  if (!subject || !cls || !chapter || moduleId === undefined || !newVideoId)
    return res.status(400).json({ error: 'Missing required fields' });

  const modKey = moduleContentKey(subject, cls, chapter, moduleId);

  // Update videoId immediately for UX
  const existing = await getCacheEntry(modKey);
  let modData = {};
  try { modData = JSON.parse(existing?.notes || '{}'); } catch {}

  await setCacheEntry(modKey, {
    ...modData,
    videoId: newVideoId,
    transcriptStatus: 'pending',
  }, { subject, cls, chapter });

  res.json({ ok: true, videoId: newVideoId });

  // Background: fetch transcript + regenerate
  (async () => {
    try {
      const transcript = await ytTranscript(newVideoId);
      const content    = await aiGenerateModuleContent(
        moduleTitle || `Module ${moduleId}`, chapter, subject, cls, transcript
      );
      await setCacheEntry(modKey, {
        ...modData,
        videoId:          newVideoId,
        notes:            content.notes,
        qa:               content.qa,
        quiz:             content.quiz,
        transcript:       transcript || null,
        transcriptStatus: transcript ? 'success' : 'unavailable',
      }, { subject, cls, chapter });
    } catch (e) {
      console.error('[swap video regen]', e.message);
    }
  })();
});

module.exports = router;
