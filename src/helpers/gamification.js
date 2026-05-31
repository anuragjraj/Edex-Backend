// ════════════════════════════════════════════════════════════════
//  DB helpers — XP, activity logging, achievements, login response
// ════════════════════════════════════════════════════════════════
const { db } = require('../config/clients');
const { signToken, createSession } = require('../middleware/auth');

async function ensureXPRecord(userId) {
  await db.from('user_xp').upsert({ user_id: userId }, { onConflict: 'user_id', ignoreDuplicates: true });
}

async function logActivity(userId, tool, opts = {}) {
  const { subject = '', chapter = '', chapters = [], xpEarned = 0, meta = {}, provider = '' } = opts;
  try {
    await db.from('activity_log').insert({
      user_id: userId, tool, subject, chapter, chapters,
      xp_earned: xpEarned, ai_provider: provider, metadata: meta,
    });
    await db.rpc('increment_xp',  { p_user_id: userId, p_amount: xpEarned });
    await db.rpc('update_streak', { p_user_id: userId });
    const counters = {
      doubt: 'doubts_solved', quiz: 'quizzes_done', notes: 'notes_made',
      paper: 'papers_made',   flashcards: 'flashcards_made',
      cheatsheet: 'cheat_sheets_made', lessonplan: 'lesson_plans_made',
    };
    if (counters[tool]) await db.rpc('increment_counter', { p_user_id: userId, p_field: counters[tool] });
    const hour = new Date().getHours();
    if (hour >= 22) await db.from('user_xp').update({ night_owl_unlocked: true }).eq('user_id', userId).eq('night_owl_unlocked', false);
    if (hour < 7)   await db.from('user_xp').update({ early_bird_unlocked: true }).eq('user_id', userId).eq('early_bird_unlocked', false);
    const today = new Date().toISOString().split('T')[0];
    const { data: xpRow } = await db.from('user_xp').select('tools_used_today, tools_used_today_date, subjects_used').eq('user_id', userId).single();
    if (xpRow) {
      const sameDay  = xpRow.tools_used_today_date === today;
      const tools    = [...new Set([...(sameDay ? xpRow.tools_used_today || [] : []), tool])];
      const subjects = [...new Set([...(xpRow.subjects_used || []), ...(subject ? [subject] : [])])];
      await db.from('user_xp').update({ tools_used_today: tools, tools_used_today_date: today, subjects_used: subjects }).eq('user_id', userId);
    }
    checkAchievements(userId).catch(() => {});
  } catch (e) { console.error('[logActivity]', e.message); }
}

async function checkAchievements(userId) {
  const [{ data: stats }, { data: user }, { data: all }, { data: unlocked }] = await Promise.all([
    db.from('user_xp').select('*').eq('user_id', userId).single(),
    db.from('users').select('login_count').eq('id', userId).single(),
    db.from('achievements').select('*'),
    db.from('user_achievements').select('achievement_id').eq('user_id', userId),
  ]);
  if (!stats || !all) return;
  const done = new Set((unlocked || []).map(a => a.achievement_id));
  const toUnlock = [];
  for (const ach of all) {
    if (done.has(ach.id)) continue;
    let ok = false;
    const v = ach.condition_value;
    switch (ach.condition_type) {
      case 'xp':              ok = stats.total_xp          >= v; break;
      case 'streak':          ok = stats.current_streak    >= v; break;
      case 'doubts':          ok = stats.doubts_solved     >= v; break;
      case 'quizzes':         ok = stats.quizzes_done      >= v; break;
      case 'quizzes_perfect': ok = stats.quizzes_perfect   >= v; break;
      case 'notes':           ok = stats.notes_made        >= v; break;
      case 'papers':          ok = stats.papers_made       >= v; break;
      case 'flashcards':      ok = stats.flashcards_made   >= v; break;
      case 'cheat_sheets':    ok = stats.cheat_sheets_made >= v; break;
      case 'lesson_plans':    ok = stats.lesson_plans_made >= v; break;
      case 'login_count':     ok = (user?.login_count || 0) >= v; break;
      case 'night_owl':       ok = stats.night_owl_unlocked === true; break;
      case 'early_bird':      ok = stats.early_bird_unlocked === true; break;
      case 'subjects':        ok = (stats.subjects_used || []).length >= v; break;
      case 'all_tools':       ok = (stats.tools_used_today || []).length >= v; break;
    }
    if (ok) toUnlock.push(ach);
  }
  if (toUnlock.length > 0) {
    await db.from('user_achievements').insert(
      toUnlock.map(a => ({ user_id: userId, achievement_id: a.id })),
      { onConflict: 'user_id,achievement_id', ignoreDuplicates: true }
    );
    const bonus = toUnlock.reduce((s, a) => s + (a.xp_reward || 0), 0);
    if (bonus > 0) await db.rpc('increment_xp', { p_user_id: userId, p_amount: bonus });
  }
}

function safeUser(u) {
  if (!u) return null;
  const { password_hash, ...safe } = u;
  return safe;
}

async function buildLoginResponse(user, deviceInfo = {}) {
  const sessionToken = await createSession(user.id, deviceInfo);
  await db.from('users').update({ last_login_at: new Date().toISOString(), login_count: (user.login_count || 0) + 1 }).eq('id', user.id);
  await ensureXPRecord(user.id);
  return {
    token:        signToken({ id: user.id, email: user.email, type: user.type, role: user.role }),
    sessionToken,
    user:         safeUser(user),
  };
}

module.exports = { ensureXPRecord, logActivity, checkAchievements, safeUser, buildLoginResponse };
