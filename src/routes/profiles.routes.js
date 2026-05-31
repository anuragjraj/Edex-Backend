// ════════════════════════════════════════════════════════════════
//  ROUTES: PROFILES (LinkedIn-style)  (mounted at /api/profiles)
// ════════════════════════════════════════════════════════════════
const express = require('express');
const { db } = require('../config/clients');
const { verifyToken } = require('../middleware/auth');

const router = express.Router();

router.put('/me', verifyToken, async (req, res) => {
  try {
    const { headline, about, location, website_url, skills, languages, hobbies,
            certifications, experience, education, visibility, banner_url } = req.body;
    const { data, error } = await db.from('user_profiles').upsert({
      user_id: req.user.id, headline, about, location, website_url, skills, languages,
      hobbies, certifications, experience, education, visibility, banner_url,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'user_id' }).select().single();
    if (error) throw error;
    res.json(data);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/:userId', verifyToken, async (req, res) => {
  try {
    const { userId } = req.params;
    // School isolation check
    if (req.user.type === 'school') {
      const [{ data: me }, { data: them }] = await Promise.all([
        db.from('users').select('school_id').eq('id', req.user.id).single(),
        db.from('users').select('school_id').eq('id', userId).single(),
      ]);
      if (!them || me.school_id !== them.school_id)
        return res.status(403).json({ error: 'Cannot view profiles from other schools' });
    }
    const [userRes, profileRes, xpRes] = await Promise.all([
      db.from('users').select('id, name, role, class_level, section, subject_specialization, school_id, created_at, type, bio, avatar_url').eq('id', userId).single(),
      db.from('user_profiles').select('*').eq('user_id', userId).maybeSingle(),
      db.from('user_xp').select('total_xp, current_streak, doubts_solved, quizzes_done, notes_made, papers_made, cheat_sheets_made, lesson_plans_made').eq('user_id', userId).single(),
    ]);
    // XP rank
    const { data: rankData } = await db.rpc('get_xp_ranking', { p_user_id: userId }).catch(() => ({ data: null }));
    res.json({
      user:    userRes.data,
      profile: profileRes.data || {},
      stats:   xpRes.data || {},
      rank:    rankData?.[0] || {},
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
