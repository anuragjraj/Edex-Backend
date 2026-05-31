// ════════════════════════════════════════════════════════════════
//  ROUTES: AI TOOLS  (mounted at /api/ai)
// ════════════════════════════════════════════════════════════════
const express   = require('express');
const rateLimit = require('express-rate-limit');
const { AI_CONFIGS } = require('../config/constants');
const { verifyToken, checkAccess } = require('../middleware/auth');
const { callAI } = require('../services/ai');
const { logActivity } = require('../helpers/gamification');

const router = express.Router();

const aiLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 80, message: { error: 'AI rate limit reached. Please wait.' } });

router.post('/:tool', verifyToken, checkAccess, aiLimiter, async (req, res) => {
  const cfg = AI_CONFIGS[req.params.tool];
  if (!cfg) return res.status(400).json({ error: `Unknown tool: ${req.params.tool}` });
  try {
    const { messages, system = '', subject = '', chapter = '', chapters = [] } = req.body;
    if (!Array.isArray(messages) || !messages.length) return res.status(400).json({ error: 'Messages array required' });
    const { text, provider } = await callAI(messages, system, cfg.maxTokens, cfg.label);
    logActivity(req.user.id, cfg.label, { subject, chapter, chapters, xpEarned: cfg.xp, provider, meta: { subject, chapter } }).catch(console.error);
    const resp = { content: text, xpEarned: cfg.xp, provider };
    if (req.freeSecondsRemaining !== undefined) resp.secondsRemaining = req.freeSecondsRemaining;
    res.json(resp);
  } catch (e) {
    console.error(`[AI /${req.params.tool}]`, e.message);
    if (e.message?.includes('429') || e.message?.includes('rate_limit')) return res.status(429).json({ error: 'AI is busy. Try again in a moment.' });
    res.status(500).json({ error: 'AI service error.' });
  }
});

module.exports = router;
