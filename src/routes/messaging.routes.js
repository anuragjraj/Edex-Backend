// ════════════════════════════════════════════════════════════════
//  ROUTES: MESSAGING  (mounted at /api/conversations)
// ════════════════════════════════════════════════════════════════
const express = require('express');
const { db } = require('../config/clients');
const { verifyToken } = require('../middleware/auth');

const router = express.Router();

async function canMessage(senderId, receiverId) {
  const [{ data: sender }, { data: receiver }] = await Promise.all([
    db.from('users').select('role, school_id, type').eq('id', senderId).single(),
    db.from('users').select('role, school_id, type').eq('id', receiverId).single(),
  ]);
  if (!sender || !receiver) return false;
  // School users: must be same school + no student↔student
  if (sender.type === 'school' || receiver.type === 'school') {
    if (sender.school_id !== receiver.school_id) return false;
    if (sender.role === 'student' && receiver.role === 'student') return false;
  }
  return true;
}

router.get('/', verifyToken, async (req, res) => {
  try {
    const { data } = await db.from('conversations')
      .select('id, participant_ids, last_message, last_message_at, created_at')
      .contains('participant_ids', [req.user.id])
      .order('last_message_at', { ascending: false });
    // Fetch other participant info
    const enriched = await Promise.all((data || []).map(async c => {
      const otherId = c.participant_ids.find(id => id !== req.user.id);
      const { data: other } = await db.from('users').select('id, name, role, class_level, avatar_url').eq('id', otherId).single();
      return { ...c, other };
    }));
    res.json(enriched);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/', verifyToken, async (req, res) => {
  try {
    const { receiverId } = req.body;
    if (!await canMessage(req.user.id, receiverId))
      return res.status(403).json({ error: 'Messaging not allowed between these users' });
    const participants = [req.user.id, receiverId].sort();
    const { data: existing } = await db.from('conversations')
      .select('id').contains('participant_ids', participants).maybeSingle();
    if (existing) return res.json(existing);
    const { data: u } = await db.from('users').select('school_id').eq('id', req.user.id).single();
    const { data, error } = await db.from('conversations').insert({
      participant_ids: participants, school_id: u.school_id || null,
    }).select().single();
    if (error) throw error;
    res.json(data);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/:id/messages', verifyToken, async (req, res) => {
  try {
    const { data: conv } = await db.from('conversations').select('participant_ids').eq('id', req.params.id).single();
    if (!conv?.participant_ids.includes(req.user.id)) return res.status(403).json({ error: 'Forbidden' });
    const { data } = await db.from('messages')
      .select('id, sender_id, content, media_url, media_type, created_at')
      .eq('conversation_id', req.params.id)
      .order('created_at', { ascending: true }).limit(100);
    res.json(data || []);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/:id/messages', verifyToken, async (req, res) => {
  try {
    const { content, media_url, media_type } = req.body;
    if (!content?.trim() && !media_url) return res.status(400).json({ error: 'Empty message' });
    const { data: conv } = await db.from('conversations').select('participant_ids').eq('id', req.params.id).single();
    if (!conv?.participant_ids.includes(req.user.id)) return res.status(403).json({ error: 'Forbidden' });
    const { data, error } = await db.from('messages').insert({
      conversation_id: req.params.id, sender_id: req.user.id,
      content: content?.trim() || null, media_url: media_url || null, media_type: media_type || null,
    }).select().single();
    if (error) throw error;
    await db.from('conversations').update({
      last_message_at: new Date().toISOString(),
      last_message:    content?.slice(0, 80) || '📷 Media',
    }).eq('id', req.params.id);
    res.json(data);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
