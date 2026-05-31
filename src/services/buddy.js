// ════════════════════════════════════════════════════════════════
//  AI Buddy — context building + long-term memory extraction
// ════════════════════════════════════════════════════════════════
const { db } = require('../config/clients');
const { callAI } = require('./ai');

async function getBuddyContext(userId) {
  const sevenDaysAgo = new Date(Date.now() - 7 * 86400000).toISOString();
  const { data: u } = await db.from('users').select('school_id, role, name, class_level').eq('id', userId).single();
  const [activity, xpData, memories] = await Promise.all([
    db.from('activity_log').select('tool, subject, chapter, created_at').eq('user_id', userId).gte('created_at', sevenDaysAgo).limit(20),
    db.from('user_xp').select('total_xp, current_streak, doubts_solved, quizzes_done, notes_made').eq('user_id', userId).single(),
    db.from('ai_buddy_memories').select('memory, importance').eq('user_id', userId).order('importance', { ascending: false }).limit(15),
  ]);
  let schoolContext = '';
  if (u?.school_id) {
    const [notices, assignments] = await Promise.all([
      db.from('school_notices').select('title, notice_type').eq('school_id', u.school_id).gte('created_at', sevenDaysAgo).limit(5),
      db.from('assignments').select('title, subject, deadline').eq('school_id', u.school_id).gt('deadline', new Date().toISOString()).limit(5),
    ]);
    schoolContext = `
Recent school notices: ${(notices.data || []).map(n => `[${n.notice_type}] ${n.title}`).join(' | ')}
Upcoming assignments: ${(assignments.data || []).map(a => `${a.subject}: "${a.title}" due ${new Date(a.deadline).toLocaleDateString('en-IN')}`).join(' | ')}`;
  }
  return `You are ${u?.name || 'a student'}'s AI Study Buddy — warm, encouraging, and genuinely helpful like a caring friend who truly knows them.

WHO THEY ARE:
- Name: ${u?.name} | Role: ${u?.role} | Class: ${u?.class_level || 'N/A'}
- XP: ${xpData.data?.total_xp || 0} | Streak: ${xpData.data?.current_streak || 0} days
- Doubts: ${xpData.data?.doubts_solved || 0} | Quizzes: ${xpData.data?.quizzes_done || 0}

RECENT ACTIVITY (7 days): ${(activity.data || []).slice(0, 10).map(a => `${a.tool}(${a.subject})`).join(', ') || 'None yet'}
${schoolContext}
WHAT I REMEMBER ABOUT THEM: ${(memories.data || []).map(m => m.memory).join('; ') || 'This is our first conversation!'}

Guidelines: Be like a real friend — concise (2-4 sentences), warm, specific to their context. Use their name. Reference their actual data. Ask good questions. Give actionable suggestions. Use emojis sparingly. When they're stressed, acknowledge it first before helping.`;
}

async function extractBuddyMemories(userId, conversation) {
  if (conversation.length < 4) return;
  try {
    const r = await callAI([{
      role: 'user',
      content: `From this conversation, identify 0-3 IMPORTANT long-term facts about this person to remember (goals, struggles, key events, preferences, milestones). Be specific and concise.
Return ONLY valid JSON array (empty [] if nothing worth remembering):
[{"memory": "Student is preparing for IIT JEE and finds organic chemistry very hard", "importance": 5, "category": "goal"}]
Conversation: ${JSON.stringify(conversation.slice(-6))}`,
    }], '', 400, 'buddy');
    const memories = JSON.parse(r.text.replace(/```[\w]*\n?/g, '').trim());
    if (Array.isArray(memories) && memories.length > 0) {
      await db.from('ai_buddy_memories').insert(memories.map(m => ({ user_id: userId, ...m })));
    }
  } catch {}
}

module.exports = { getBuddyContext, extractBuddyMemories };
