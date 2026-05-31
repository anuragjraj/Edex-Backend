// ════════════════════════════════════════════════════════════════
//  ROUTES: SCHOOL — notices, timetable, analytics  (mounted at /api/school)
// ════════════════════════════════════════════════════════════════
const express = require('express');
const { db } = require('../config/clients');
const { verifyToken } = require('../middleware/auth');

const router = express.Router();

// ── Notices ──────────────────────────────────────────────────────
router.get('/notices', verifyToken, async (req, res) => {
  const { data: u } = await db.from('users').select('school_id').eq('id', req.user.id).single();
  if (!u?.school_id) return res.json([]);
  const { data } = await db.from('school_notices').select('*')
    .eq('school_id', u.school_id)
    .order('is_pinned', { ascending: false })
    .order('created_at',  { ascending: false }).limit(50);
  res.json(data || []);
});

router.post('/notices', verifyToken, async (req, res) => {
  const { data: u } = await db.from('users').select('school_id, role').eq('id', req.user.id).single();
  if (!['admin', 'principal', 'teacher'].includes(u?.role))
    return res.status(403).json({ error: 'Only admin/teachers can post notices' });
  // Only admin can post school-wide notices
  const { title, content, notice_type, target_audience, media_url, is_pinned, expires_at } = req.body;
  if (target_audience === 'all' && u.role === 'teacher')
    return res.status(403).json({ error: 'Only admin can post school-wide notices' });
  const { data, error } = await db.from('school_notices').insert({
    school_id: u.school_id, title, content, notice_type: notice_type || 'general',
    target_audience: target_audience || 'all', media_url: media_url || null,
    is_pinned: is_pinned || false, expires_at: expires_at || null, posted_by: req.user.id,
  }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.status(201).json(data);
});

// ── Timetable ────────────────────────────────────────────────────
router.get('/timetable', verifyToken, async (req, res) => {
  const { data: u } = await db.from('users').select('school_id, class_level, section').eq('id', req.user.id).single();
  if (!u?.school_id) return res.json(null);
  const { data } = await db.from('timetables').select('*')
    .eq('school_id', u.school_id)
    .eq('class_level', u.class_level || '').maybeSingle();
  res.json(data || null);
});

router.post('/timetable', verifyToken, async (req, res) => {
  const { data: u } = await db.from('users').select('school_id, role').eq('id', req.user.id).single();
  if (!['teacher', 'admin'].includes(u?.role)) return res.status(403).json({ error: 'Teachers only' });
  const { class_level, section, schedule, academic_year } = req.body;
  const { data, error } = await db.from('timetables').upsert({
    school_id: u.school_id, class_level, section, schedule,
    academic_year: academic_year || '2024-25', uploaded_by: req.user.id,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'school_id,class_level,section' }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// ── Analytics ────────────────────────────────────────────────────
router.get('/analytics', verifyToken, async (req, res) => {
  const { data: u } = await db.from('users').select('school_id, role').eq('id', req.user.id).single();
  if (!['admin', 'teacher'].includes(u?.role)) return res.status(403).json({ error: 'Admin/Teacher only' });
  const { data } = await db.from('school_analytics').select('*').eq('school_id', u.school_id);
  res.json(data || []);
});

module.exports = router;
