// ════════════════════════════════════════════════════════════════
//  Chapter Course engine
//  - module-specific AI prompts
//  - in-memory SSE event bus
//  - Supabase chapter_cache helpers
//  - background generation engine
// ════════════════════════════════════════════════════════════════
const { EventEmitter } = require('events');
const { db } = require('../config/clients');
const { callAI } = require('./ai');
const { ytSearch, ytTranscript, getBestTranscript } = require('./youtube');
const { logActivity } = require('../helpers/gamification');

// ────────────────────────────────────────────────────────────────
//  AI HELPERS — module-specific prompts
// ────────────────────────────────────────────────────────────────

/** Generate the list of 8-15 modules for a chapter using Claude */
async function aiGenerateModuleList(subject, cls, chapter, moduleCount = 10) {
  const prompt = `You are an expert CBSE curriculum designer.
Break down the CBSE chapter "${chapter}" (${subject}, ${cls}) into exactly ${moduleCount} focused learning modules.
Each module should cover a distinct sub-topic that can be taught via a single YouTube video (10-20 min).
Module ${moduleCount} should be a "Practice & Exam Tips" or "Solved Examples" module.

Return ONLY valid JSON (no markdown):
{
  "modules": [
    {
      "id": 1,
      "title": "Introduction to ${chapter}",
      "description": "Brief description under 40 words",
      "emoji": "🔢",
      "estimatedMinutes": 15,
      "keyTopics": ["topic1", "topic2", "topic3"],
      "searchQuery": "specific YouTube search query for this sub-topic CBSE"
    }
  ]
}`;
  const r = await callAI([{ role: 'user', content: prompt }], '', 2000, 'notes');
  try {
    const parsed = JSON.parse(r.text.replace(/```[\w]*\n?/g, '').trim());
    return parsed?.modules || null;
  } catch { return null; }
}

/** Generate notes + Q&A + quiz for one module using transcript (or fallback to topic knowledge) */
async function aiGenerateModuleContent(moduleTitle, chapter, subject, cls, transcript) {
  const transcriptSection = transcript
    ? `Use this YouTube video transcript as your PRIMARY source. Base notes, Q&A and quiz STRICTLY on what the transcript teaches:\n\n"${transcript.slice(0, 7000)}"\n\nSupplement with CBSE knowledge only where the transcript is insufficient.`
    : `No transcript available. Use your expert CBSE knowledge of "${moduleTitle}" in ${subject} ${cls}.`;

  const prompt = `You are an expert CBSE teacher creating learning content.
Module: "${moduleTitle}"
Chapter: "${chapter}" | Subject: ${subject} | Class: ${cls} | Board: CBSE

${transcriptSection}

Return ONLY valid JSON (no markdown, no preamble):
{
  "notes": {
    "summary": "3-4 substantial paragraphs covering the module content",
    "keyConcepts": [{"term": "string", "definition": "1-2 sentences"}],
    "keyPoints": ["10 key points as complete sentences with explanation"],
    "formulas": ["formulas with units and when to use them — empty array if not applicable"],
    "solvedExample": "One worked example relevant to this module (null if not applicable)",
    "commonMistakes": ["3 common mistakes students make"],
    "examTips": ["3 specific exam tips for this sub-topic"]
  },
  "qa": [
    {"q": "question", "a": "3-4 sentence answer", "difficulty": "Easy|Medium|Hard"}
  ],
  "quiz": [
    {"q": "question text", "opts": ["A", "B", "C", "D"], "ans": 0, "exp": "explanation why correct"}
  ]
}
Include exactly 6 Q&A items and 8 quiz questions. "ans" is 0-indexed.`;

  const r = await callAI([{ role: 'user', content: prompt }], '', 5000, 'notes');
  try {
    const parsed = JSON.parse(r.text.replace(/```[\w]*\n?/g, '').trim());
    if (!parsed?.notes) throw new Error('No notes');
    return { notes: parsed.notes, qa: parsed.qa || [], quiz: parsed.quiz || [] };
  } catch {
    return {
      notes: {
        summary: `Content for "${moduleTitle}" is being prepared. Please retry in a moment.`,
        keyConcepts: [], keyPoints: [], formulas: [], solvedExample: null, commonMistakes: [], examTips: [],
      },
      qa: [], quiz: [],
    };
  }
}

// ────────────────────────────────────────────────────────────────
//  SSE EVENT BUS (in-memory, for real-time progress streaming)
// ────────────────────────────────────────────────────────────────
const moduleEventBus = new Map(); // courseKey → EventEmitter

function emitModuleEvent(courseKey, data) {
  moduleEventBus.get(courseKey)?.emit('update', data);
}

// ────────────────────────────────────────────────────────────────
//  CACHE HELPERS (Supabase chapter_cache table)
// ────────────────────────────────────────────────────────────────
function moduleListKey(subject, cls, chapter) {
  const safe = s => s.replace(/[^a-zA-Z0-9]/g, '').toLowerCase().slice(0, 20);
  return `bscm-list-${safe(subject)}-${safe(cls)}-${safe(chapter)}`;
}

function moduleContentKey(subject, cls, chapter, moduleId) {
  const safe = s => s.replace(/[^a-zA-Z0-9]/g, '').toLowerCase().slice(0, 16);
  return `bscm-mod-${safe(subject)}-${safe(cls)}-${safe(chapter)}-${moduleId}`;
}

async function getCacheEntry(key) {
  try {
    const { data } = await db.from('chapter_cache').select('*').eq('cache_key', key).maybeSingle();
    return data || null;
  } catch { return null; }
}

async function setCacheEntry(key, payload, meta = {}) {
  try {
    await db.from('chapter_cache').upsert({
      cache_key: key,
      notes:     JSON.stringify(payload), // reuse notes column for JSON blobs
      subject:   meta.subject || '',
      class_level: meta.cls || '',
      chapter:   meta.chapter || '',
      updated_at: new Date().toISOString(),
    }, { onConflict: 'cache_key' });
  } catch (e) { console.error('[setCacheEntry]', e.message); }
}

// ────────────────────────────────────────────────────────────────
//  MODULE COUNT based on role
// ────────────────────────────────────────────────────────────────
function getModuleCount(user) {
  // Teachers / pro: 12 modules; Students: 10
  if (user.role === 'teacher') return 12;
  if (user.subscription_status === 'active') return 12;
  return 10;
}

// ────────────────────────────────────────────────────────────────
//  BACKGROUND GENERATION ENGINE
// ────────────────────────────────────────────────────────────────
async function generateChapterCourse(listKey, subject, cls, chapter, moduleCount, userId) {
  const emitter = new EventEmitter();
  emitter.setMaxListeners(100);
  moduleEventBus.set(listKey, emitter);

  const emit = data => emitter.emit('update', data);

  try {
    // ── Step 1: Generate module structure ────────────────────
    emit({ type: 'status', message: `Designing ${moduleCount} modules for "${chapter}"…` });

    const modules = await aiGenerateModuleList(subject, cls, chapter, moduleCount);
    if (!modules?.length) throw new Error('Module generation failed');

    // Save module list skeleton immediately (no content yet)
    const skeleton = modules.map(m => ({
      ...m,
      status: 'pending',  // pending | building | done | error
      videoId: null,
      videoTitle: null,
      videoChannel: null,
      videoThumbnail: null,
      searchResults: [],
    }));

    await setCacheEntry(listKey, { modules: skeleton, generatedAt: new Date().toISOString() }, { subject, cls, chapter });
    emit({ type: 'modules_listed', modules: skeleton });

    // ── Step 2: Process each module sequentially ──────────────
    // Sequential gives better quality (no rate-limit collisions)
    for (const mod of modules) {
      const modKey = moduleContentKey(subject, cls, chapter, mod.id);
      emit({ type: 'module_building', moduleId: mod.id, title: mod.title });

      try {
        // Search YouTube
        const searchQ = `${mod.searchQuery || mod.title} ${subject} ${cls} CBSE explained`;
        const videos  = await ytSearch(searchQ, 5);

        // Get best transcript
        const { transcript, videoId: bestVidId } = await getBestTranscript(videos);
        const topVideo = videos.find(v => v.videoId === bestVidId) || videos[0] || null;

        // Generate content
        const content = await aiGenerateModuleContent(
          mod.title, chapter, subject, cls, transcript
        );

        // Cache module content
        const modData = {
          moduleId:        mod.id,
          title:           mod.title,
          description:     mod.description,
          emoji:           mod.emoji,
          estimatedMinutes: mod.estimatedMinutes,
          keyTopics:       mod.keyTopics,
          videoId:         bestVidId || null,
          videoTitle:      topVideo?.title || null,
          videoChannel:    topVideo?.channel || null,
          videoThumbnail:  topVideo?.thumbnail || null,
          searchResults:   videos,
          transcript:      transcript || null,
          transcriptStatus: transcript ? 'success' : bestVidId ? 'unavailable' : 'none',
          notes:           content.notes,
          qa:              content.qa,
          quiz:            content.quiz,
          generatedAt:     new Date().toISOString(),
        };
        await setCacheEntry(modKey, modData, { subject, cls, chapter });

        // Update skeleton with video info
        skeleton[mod.id - 1] = {
          ...skeleton[mod.id - 1],
          status:          'done',
          videoId:         bestVidId || null,
          videoTitle:      topVideo?.title || null,
          videoChannel:    topVideo?.channel || null,
          videoThumbnail:  topVideo?.thumbnail || null,
          transcriptStatus: modData.transcriptStatus,
        };
        await setCacheEntry(listKey, { modules: skeleton, generatedAt: new Date().toISOString() }, { subject, cls, chapter });

        emit({ type: 'module_done', moduleId: mod.id, videoId: bestVidId, transcriptStatus: modData.transcriptStatus });

        // Brief pause to avoid rate limits
        await new Promise(r => setTimeout(r, 800));

      } catch (e) {
        console.error(`[module ${mod.id} error]`, e.message);
        skeleton[mod.id - 1].status = 'error';
        await setCacheEntry(listKey, { modules: skeleton, generatedAt: new Date().toISOString() }, { subject, cls, chapter });
        emit({ type: 'module_error', moduleId: mod.id });
      }
    }

    emit({ type: 'generation_complete', modules: skeleton });
    logActivity(userId, 'notes', { subject, chapter, xpEarned: 30 }).catch(() => {});

  } catch (e) {
    console.error('[generateChapterCourse]', e.message);
    emit({ type: 'error', message: e.message });
  } finally {
    // Clean up emitter after 3 minutes
    setTimeout(() => moduleEventBus.delete(listKey), 3 * 60 * 1000);
  }
}

module.exports = {
  aiGenerateModuleList,
  aiGenerateModuleContent,
  moduleEventBus,
  emitModuleEvent,
  moduleListKey,
  moduleContentKey,
  getCacheEntry,
  setCacheEntry,
  getModuleCount,
  generateChapterCourse,
};
