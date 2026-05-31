// ════════════════════════════════════════════════════════════════
//  ROUTES: ASSIGNMENTS  (mounted at /api/assignments)
// ════════════════════════════════════════════════════════════════
const express = require('express');
const { db, upload } = require('../config/clients');
const { verifyToken } = require('../middleware/auth');
const { callAI } = require('../services/ai');

const router = express.Router();

router.get('/', verifyToken, async (req, res) => {
  const { data: u } = await db.from('users').select('school_id, role, class_level, section').eq('id', req.user.id).single();
  if (!u?.school_id) return res.json([]);
  let query = db.from('assignments').select('*, users!teacher_id(name)').eq('school_id', u.school_id);
  if (u.role === 'teacher') {
    query = query.eq('teacher_id', req.user.id);
  } else {
    query = query.eq('class_level', u.class_level);
  }
  const { data } = await query.order('deadline', { ascending: true });
  res.json(data || []);
});

router.post('/', verifyToken, async (req, res) => {
  const { data: u } = await db.from('users').select('school_id, role').eq('id', req.user.id).single();
  if (u?.role !== 'teacher') return res.status(403).json({ error: 'Teachers only' });
  const { title, description, subject, class_level, section, chapters, total_marks,
          deadline, answer_type, grading_notes, question_paper_url, question_paper_text, questions_json } = req.body;
  if (!title || !deadline) return res.status(400).json({ error: 'Title and deadline are required' });
  const { data, error } = await db.from('assignments').insert({
    school_id: u.school_id, teacher_id: req.user.id, title, description, subject,
    class_level, section: section || null, chapters: chapters || [], total_marks: total_marks || 0,
    deadline, answer_type: answer_type || 'both', grading_notes: grading_notes || '',
    question_paper_url: question_paper_url || null,
    question_paper_text: question_paper_text || null,
    questions_json: questions_json || null,
  }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.status(201).json(data);
});

router.post('/generate-paper', verifyToken, async (req, res) => {
  const { data: u } = await db.from('users').select('role').eq('id', req.user.id).single();
  if (u?.role !== 'teacher') return res.status(403).json({ error: 'Teachers only' });
  const { subject, class_level, chapters, marks, answer_type, teacher_notes, question_types } = req.body;
  const prompt = `Create a formal CBSE ${marks}-mark assignment question paper.
Subject: ${subject} | Class: ${class_level}
Chapters covered: ${(chapters || []).join(', ')}
Expected answer format: ${answer_type || 'both'} (text or PDF upload)
Teacher's grading priorities: ${teacher_notes || 'Standard CBSE grading'}
Preferred question types: ${question_types || 'Mix of MCQ, Short Answer, Long Answer'}

IMPORTANT: Number every question clearly as Q1., Q2., etc. with marks in brackets like [2 marks].
Write a clean, professional question paper. After the paper, write exactly: ===JSON===
Then return ONLY this JSON (no markdown, no explanation):
{"questions":[{"q_num":1,"question":"full question text","type":"mcq","max_marks":2},{"q_num":2,"question":"...","type":"short","max_marks":5}]}`;
  try {
    const r = await callAI([{ role: 'user', content: prompt }], '', 4000, 'paper');
    const sepIdx = r.text.indexOf('===JSON===');
    let paperText = r.text, questionsJson = null;
    if (sepIdx > -1) {
      paperText = r.text.slice(0, sepIdx).trim();
      try { questionsJson = JSON.parse(r.text.slice(sepIdx + 10).trim()); } catch {}
    }
    res.json({ paper_text: paperText, questions_json: questionsJson, provider: r.provider });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/:id/submit', verifyToken, upload.single('pdf'), async (req, res) => {
  try {
    const { data: assignment } = await db.from('assignments').select('*').eq('id', req.params.id).single();
    if (!assignment) return res.status(404).json({ error: 'Assignment not found' });
    const isLate = new Date() > new Date(assignment.deadline);
    let pdf_url = null, answers_text = null, submission_type = 'text';
    if (req.file) {
      const name = `assignments/${req.user.id}/${req.params.id}-${Date.now()}.pdf`;
      const { error: uploadErr } = await db.storage
        .from(process.env.SUPABASE_STORAGE_BUCKET || 'brainspark-media')
        .upload(name, req.file.buffer, { contentType: 'application/pdf' });
      if (uploadErr) throw uploadErr;
      const { data: urlData } = db.storage
        .from(process.env.SUPABASE_STORAGE_BUCKET || 'brainspark-media')
        .getPublicUrl(name);
      pdf_url = urlData.publicUrl;
      submission_type = 'pdf';
    } else {
      const raw = req.body.answers;
      answers_text = raw ? (typeof raw === 'string' ? JSON.parse(raw) : raw) : [];
      submission_type = 'text';
    }
    const { data, error } = await db.from('assignment_submissions').upsert({
      assignment_id: req.params.id, student_id: req.user.id,
      school_id: assignment.school_id, submission_type,
      answers_text, pdf_url, is_late: isLate,
      submitted_at: new Date().toISOString(),
    }, { onConflict: 'assignment_id,student_id' }).select().single();
    if (error) throw error;
    res.json(data);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/:id/analysis/me', verifyToken, async (req, res) => {
  const { data } = await db.from('assignment_analysis')
    .select('*').eq('assignment_id', req.params.id).eq('student_id', req.user.id).maybeSingle();
  res.json(data || null);
});

router.get('/:id/analysis/all', verifyToken, async (req, res) => {
  const { data: u } = await db.from('users').select('role').eq('id', req.user.id).single();
  if (u?.role !== 'teacher') return res.status(403).json({ error: 'Teachers only' });
  const { data } = await db.from('assignment_analysis')
    .select('*, users!student_id(name, class_level, section, roll_number)')
    .eq('assignment_id', req.params.id);
  res.json(data || []);
});

module.exports = router;
