// ════════════════════════════════════════════════════════════════
//  Assignment auto-analysis engine (runs every 15 min)
// ════════════════════════════════════════════════════════════════
const { db, anthropic } = require('../config/clients');
const { callAI } = require('./ai');

async function analyzeTextSubmission(assignment, submission) {
  const prompt = `You are an expert CBSE teacher grading an assignment.

ASSIGNMENT: "${assignment.title}"
SUBJECT: ${assignment.subject} | TOTAL MARKS: ${assignment.total_marks}
QUESTIONS: ${JSON.stringify(assignment.questions_json?.questions || [])}
TEACHER GRADING PREFERENCES: ${assignment.grading_notes || 'Standard CBSE grading. Award marks for correct method.'}

STUDENT ANSWERS: ${JSON.stringify(submission.answers_text)}

CRITICAL: Match answers to questions by question NUMBER only (Q1 answer → Q1 question, Q2 → Q2, etc.)
Give detailed, constructive feedback for each answer.

Return ONLY this JSON (no markdown):
{
  "questions_analysis": [
    {"q_num": 1, "marks_awarded": 3, "marks_max": 5, "feedback": "Good explanation but missed the formula derivation.", "improvement_tip": "Always show the derivation step in your working.", "correctness_pct": 70}
  ],
  "total_marks_awarded": 18,
  "total_marks_max": 25,
  "overall_feedback": "Well-structured answers. Focus on showing working steps.",
  "strengths": ["Good conceptual understanding", "Neat presentation"],
  "improvements": ["Show derivations", "Elaborate on definitions"]
}`;
  const r = await callAI([{ role: 'user', content: prompt }], '', 3000, 'notes');
  const parsed = JSON.parse(r.text.replace(/```[\w]*\n?/g, '').trim());
  return { ...parsed, ai_provider: r.provider };
}

async function analyzePDFSubmission(assignment, submission) {
  const prompt = `You are an expert CBSE teacher grading a handwritten assignment.

ASSIGNMENT: "${assignment.title}"
SUBJECT: ${assignment.subject} | TOTAL MARKS: ${assignment.total_marks}
QUESTIONS: ${JSON.stringify(assignment.questions_json?.questions || [])}
GRADING PREFERENCES: ${assignment.grading_notes || 'Standard CBSE'}

CRITICAL: Match student answers to questions by question number (Q1., Q2., etc.) ONLY.

Analyze the handwritten answers and return ONLY this JSON:
{
  "questions_analysis": [{"q_num": 1, "marks_awarded": 3, "marks_max": 5, "feedback": "...", "improvement_tip": "..."}],
  "total_marks_awarded": 18, "total_marks_max": 25,
  "overall_feedback": "...",
  "strengths": ["..."], "improvements": ["..."],
  "handwriting_quality": "good",
  "handwriting_tips": "Your handwriting is clear. Try to maintain consistent letter size."
}`;
  const r = await anthropic.messages.create({
    model: 'claude-sonnet-4-6', max_tokens: 3000,
    messages: [{
      role: 'user',
      content: [
        { type: 'document', source: { type: 'url', url: submission.pdf_url } },
        { type: 'text', text: prompt },
      ],
    }],
  });
  const text = r.content[0].text.replace(/```[\w]*\n?/g, '').trim();
  const parsed = JSON.parse(text);
  return { ...parsed, ai_provider: 'claude' };
}

async function runAssignmentAnalysis() {
  try {
    const { data: pending } = await db.from('assignments')
      .select('id').eq('status', 'active').lt('deadline', new Date().toISOString());
    for (const a of pending || []) {
      await db.from('assignments').update({ status: 'closed' }).eq('id', a.id);
      const { data: submissions } = await db.from('assignment_submissions')
        .select('*').eq('assignment_id', a.id);
      const { data: assignment } = await db.from('assignments').select('*').eq('id', a.id).single();
      for (const sub of submissions || []) {
        const { data: existing } = await db.from('assignment_analysis')
          .select('id').eq('submission_id', sub.id).maybeSingle();
        if (existing) continue;
        try {
          let result;
          if (sub.submission_type === 'pdf' && sub.pdf_url) {
            result = await analyzePDFSubmission(assignment, sub);
          } else {
            result = await analyzeTextSubmission(assignment, sub);
          }
          await db.from('assignment_analysis').insert({
            submission_id: sub.id, assignment_id: a.id,
            student_id: sub.student_id, school_id: sub.school_id,
            ...result, analyzed_at: new Date().toISOString(),
          });
        } catch (e) { console.error('[analysis error]', e.message); }
      }
    }
  } catch (e) { console.error('[runAssignmentAnalysis]', e.message); }
}

// Starts the recurring 15-minute analysis loop. Called once at boot.
function startAssignmentAnalysisCron() {
  setInterval(runAssignmentAnalysis, 15 * 60 * 1000);
}

module.exports = {
  analyzeTextSubmission,
  analyzePDFSubmission,
  runAssignmentAnalysis,
  startAssignmentAnalysisCron,
};
