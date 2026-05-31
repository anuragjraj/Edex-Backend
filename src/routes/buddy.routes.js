// ════════════════════════════════════════════════════════════════
//  ROUTES: AI BUDDY  (mounted at /api/buddy)
// ════════════════════════════════════════════════════════════════
const express = require('express');
const { db } = require('../config/clients');
const { verifyToken } = require('../middleware/auth');
const { callAI } = require('../services/ai');
const { getBuddyContext, extractBuddyMemories } = require('../services/buddy');

const router = express.Router();

router.post('/chat', verifyToken, async (req, res) => {
  try {
    const { message, sessionMessages = [] } = req.body;
    if (!message?.trim()) return res.status(400).json({ error: 'Message required' });
    const systemPrompt = await getBuddyContext(req.user.id);
    const messages = [
      ...sessionMessages.slice(-10),
      { role: 'user', content: message },
    ];
    const r = await callAI(messages, systemPrompt, 600, 'buddy');
    extractBuddyMemories(req.user.id, [...messages, { role: 'assistant', content: r.text }]).catch(() => {});
    const today = new Date().toISOString().split('T')[0];
    const { data: existing } = await db.from('ai_buddy_conversations')
      .select('id, messages').eq('user_id', req.user.id).eq('session_date', today).maybeSingle();
    const newMessages = [
      ...(existing?.messages || []),
      { role: 'user', content: message, ts: new Date().toISOString() },
      { role: 'assistant', content: r.text, ts: new Date().toISOString() },
    ];
    await db.from('ai_buddy_conversations').upsert(
      { user_id: req.user.id, session_date: today, messages: newMessages, updated_at: new Date().toISOString() },
      { onConflict: 'user_id,session_date' }
    );
    res.json({ content: r.text, provider: r.provider });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
