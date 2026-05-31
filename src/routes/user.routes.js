// ════════════════════════════════════════════════════════════════
//  ROUTES: USER PROFILE, STATS & SAVED CONTENT  (mounted at /api/user)
// ════════════════════════════════════════════════════════════════
const express = require('express');
const bcrypt  = require('bcryptjs');
const { db } = require('../config/clients');
const { FREE_WINDOW_SECONDS } = require('../config/constants');
const { verifyToken } = require('../middleware/auth');
const { safeUser } = require('../helpers/gamification');

const router = express.Router();

router.get('/profile', verifyToken, async (req, res) => {
  const { data: user } = await db.from('users').select('*, schools(name, school_code, logo_url)').eq('id', req.user.id).maybeSingle();
  res.json(safeUser(user));
});

router.put('/profile', verifyToken, async (req, res) => {
  try {
    const { name, bio, phone, classLevel, section, subjectSpecialization, preferredSubjects } = req.body;
    const { data: user, error } = await db.from('users').update({
      ...(name                              && { name: name.trim() }),
      ...(bio               !== undefined   && { bio }),
      ...(phone             !== undefined   && { phone }),
      ...(classLevel        !== undefined   && { class_level: classLevel }),
      ...(section           !== undefined   && { section }),
      ...(subjectSpecialization !== undefined && { subject_specialization: subjectSpecialization }),
      ...(preferredSubjects !== undefined   && { preferred_subjects: preferredSubjects }),
      updated_at: new Date().toISOString(),
    }).eq('id', req.user.id).select().single();
    if (error) throw error;
    res.json(safeUser(user));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.put('/password', verifyToken, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    if (!newPassword || newPassword.length < 8) return res.status(400).json({ error: 'New password must be >= 8 characters' });
    const { data: user } = await db.from('users').select('password_hash').eq('id', req.user.id).single();
    if (user.password_hash && !await bcrypt.compare(currentPassword, user.password_hash))
      return res.status(401).json({ error: 'Current password is incorrect' });
    await db.from('users').update({ password_hash: await bcrypt.hash(newPassword, 12), updated_at: new Date().toISOString() }).eq('id', req.user.id);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/stats', verifyToken, async (req, res) => {
  try {
    const { data: stats  } = await db.rpc('get_user_stats', { p_user_id: req.user.id });
    const { data: recent } = await db.from('activity_log').select('tool,subject,chapter,xp_earned,created_at')
      .eq('user_id', req.user.id).order('created_at', { ascending: false }).limit(20);
    const sevenAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const { data: weekly } = await db.from('activity_log').select('tool,xp_earned,created_at')
      .eq('user_id', req.user.id).gte('created_at', sevenAgo);
    res.json({ stats: stats?.[0] || {}, recentActivity: recent || [], weeklyActivity: weekly || [] });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/history', verifyToken, async (req, res) => {
  const page  = parseInt(req.query.page) || 1;
  const limit = 50;
  const { data } = await db.from('activity_log')
    .select('id, tool, subject, chapter, chapters, xp_earned, ai_provider, created_at')
    .eq('user_id', req.user.id)
    .order('created_at', { ascending: false })
    .range((page - 1) * limit, page * limit - 1);
  res.json(data || []);
});

router.get('/achievements', verifyToken, async (req, res) => {
  const { data: all } = await db.from('achievements').select('*').order('sort_order');
  const { data: unlocked } = await db.from('user_achievements').select('achievement_id, unlocked_at').eq('user_id', req.user.id);
  const unlockedMap = Object.fromEntries((unlocked || []).map(u => [u.achievement_id, u.unlocked_at]));
  res.json((all || []).map(a => ({ ...a, unlocked: !!unlockedMap[a.id], unlocked_at: unlockedMap[a.id] || null })));
});

router.get('/subscription', verifyToken, async (req, res) => {
  const { data: user } = await db.from('users')
    .select('subscription_status, subscription_plan, subscription_expires_at, free_tier_started_at, type, role')
    .eq('id', req.user.id).single();
  // Calculate seconds remaining for frontend
  let freeSecondsRemaining = null;
  if (user?.type === 'personal' && user.subscription_status !== 'active') {
    if (!user.free_tier_started_at) {
      freeSecondsRemaining = FREE_WINDOW_SECONDS; // not started yet
    } else {
      const elapsed = Math.floor((Date.now() - new Date(user.free_tier_started_at)) / 1000);
      freeSecondsRemaining = Math.max(0, FREE_WINDOW_SECONDS - elapsed);
    }
  }
  res.json({ ...user, freeSecondsRemaining });
});

// Saved Notes
router.get('/notes', verifyToken, async (req, res) => {
  const { data } = await db.from('saved_notes').select('id,title,subject,class_level,chapter,style,created_at').eq('user_id', req.user.id).order('created_at', { ascending: false });
  res.json(data || []);
});
router.get('/notes/:id', verifyToken, async (req, res) => {
  const { data } = await db.from('saved_notes').select('*').eq('id', req.params.id).eq('user_id', req.user.id).maybeSingle();
  if (!data) return res.status(404).json({ error: 'Not found' });
  res.json(data);
});
router.post('/notes', verifyToken, async (req, res) => {
  const { subject, classLevel, chapter, style, content } = req.body;
  const { data, error } = await db.from('saved_notes').insert({ user_id: req.user.id, title: `${chapter} — ${subject}`, subject, class_level: classLevel, chapter, style, content, word_count: content?.split(/\s+/).length || 0 }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.status(201).json(data);
});
router.delete('/notes/:id', verifyToken, async (req, res) => {
  await db.from('saved_notes').delete().eq('id', req.params.id).eq('user_id', req.user.id);
  res.json({ success: true });
});

// Saved Papers
router.get('/papers', verifyToken, async (req, res) => {
  const { data } = await db.from('saved_papers').select('id,title,subject,class_level,chapters,marks,duration,created_at').eq('user_id', req.user.id).order('created_at', { ascending: false });
  res.json(data || []);
});
router.post('/papers', verifyToken, async (req, res) => {
  const { subject, classLevel, chapters, marks, duration, description, content } = req.body;
  const { data, error } = await db.from('saved_papers').insert({ user_id: req.user.id, title: `${subject} — ${classLevel} — ${marks}M`, subject, class_level: classLevel, chapters: chapters || [], marks, duration, description, content }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.status(201).json(data);
});
router.delete('/papers/:id', verifyToken, async (req, res) => {
  await db.from('saved_papers').delete().eq('id', req.params.id).eq('user_id', req.user.id);
  res.json({ success: true });
});

// Cheat Sheets
router.get('/cheatsheets', verifyToken, async (req, res) => {
  const { data } = await db.from('cheat_sheets').select('id,title,subject,class_level,chapters,exam_date,created_at').eq('user_id', req.user.id).order('created_at', { ascending: false });
  res.json(data || []);
});
router.post('/cheatsheets', verifyToken, async (req, res) => {
  const { subject, classLevel, chapters, examDate, content } = req.body;
  const { data, error } = await db.from('cheat_sheets').insert({ user_id: req.user.id, title: `${subject} — ${(chapters || []).join(', ')}`, subject, class_level: classLevel, chapters: chapters || [], exam_date: examDate || null, content, word_count: content?.split(/\s+/).length || 0 }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.status(201).json(data);
});
router.delete('/cheatsheets/:id', verifyToken, async (req, res) => {
  await db.from('cheat_sheets').delete().eq('id', req.params.id).eq('user_id', req.user.id);
  res.json({ success: true });
});

// Lesson Plans
router.get('/lessonplans', verifyToken, async (req, res) => {
  const { data } = await db.from('lesson_plans').select('id,title,subject,topic,class_level,duration_minutes,created_at').eq('user_id', req.user.id).order('created_at', { ascending: false });
  res.json(data || []);
});
router.post('/lessonplans', verifyToken, async (req, res) => {
  const { subject, topic, classLevel, durationMinutes, customPrompt, content } = req.body;
  const { data, error } = await db.from('lesson_plans').insert({ user_id: req.user.id, title: `${topic} — ${subject}`, subject, topic, class_level: classLevel, duration_minutes: durationMinutes, custom_prompt: customPrompt, content }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.status(201).json(data);
});
router.delete('/lessonplans/:id', verifyToken, async (req, res) => {
  await db.from('lesson_plans').delete().eq('id', req.params.id).eq('user_id', req.user.id);
  res.json({ success: true });
});

// Quiz History
router.get('/quiz-history', verifyToken, async (req, res) => {
  const { data } = await db.from('quiz_history').select('*').eq('user_id', req.user.id).order('created_at', { ascending: false }).limit(20);
  res.json(data || []);
});
router.post('/quiz-history', verifyToken, async (req, res) => {
  const { subject, topic, difficulty, totalQuestions, correctAnswers, xpEarned, isPerfect } = req.body;
  const { data, error } = await db.from('quiz_history').insert({
    user_id: req.user.id, subject, topic, difficulty,
    total_questions: totalQuestions, correct_answers: correctAnswers,
    score_percent: Math.round((correctAnswers / totalQuestions) * 100),
    xp_earned: xpEarned, is_perfect: isPerfect || false,
  }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  if (isPerfect) await db.rpc('increment_counter', { p_user_id: req.user.id, p_field: 'quizzes_perfect' });
  res.status(201).json(data);
});

module.exports = router;
