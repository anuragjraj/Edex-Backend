// ════════════════════════════════════════════════════════════════
//  ROUTES: CHAPTER COURSE CACHE  (mounted at /api/courses)
// ════════════════════════════════════════════════════════════════
const express = require('express');
const { db } = require('../config/clients');
const { verifyToken } = require('../middleware/auth');

const router = express.Router();

router.get('/:key', async (req, res) => {
  const { data } = await db.from('chapter_cache').select('*').eq('cache_key', req.params.key).maybeSingle();
  res.json(data || null);
});

router.post('/', verifyToken, async (req, res) => {
  try {
    const { cacheKey, notes, qa, quiz, subject, cls, chapter } = req.body;
    if (!cacheKey) return res.status(400).json({ error: 'cacheKey required' });
    const { data, error } = await db.from('chapter_cache').upsert({
      cache_key: cacheKey, notes, qa, quiz, subject, class_level: cls, chapter,
      generated_by: req.user.id, updated_at: new Date().toISOString(),
    }, { onConflict: 'cache_key' }).select().single();
    if (error) throw error;
    res.json(data);
  } catch (e) { console.error('[courses]', e); res.status(500).json({ error: e.message }); }
});

module.exports = router;
