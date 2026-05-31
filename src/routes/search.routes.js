// ════════════════════════════════════════════════════════════════
//  ROUTES: SEARCH  (mounted at /api/search)
// ════════════════════════════════════════════════════════════════
const express = require('express');
const { db } = require('../config/clients');
const { verifyToken } = require('../middleware/auth');

const router = express.Router();

router.get('/', verifyToken, async (req, res) => {
  const { q } = req.query;
  if (!q || q.length < 2) return res.json([]);
  try {
    if (req.user.type === 'school') {
      const { data: me } = await db.from('users').select('school_id').eq('id', req.user.id).single();
      const { data } = await db.from('users')
        .select('id, name, role, class_level, section, avatar_url, subject_specialization')
        .eq('school_id', me.school_id).ilike('name', `%${q}%`).limit(20);
      return res.json(data || []);
    }
    const { data } = await db.from('users')
      .select('id, name, role, class_level, bio, avatar_url')
      .eq('type', 'personal').ilike('name', `%${q}%`).limit(20);
    res.json(data || []);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
