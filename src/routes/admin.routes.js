// ════════════════════════════════════════════════════════════════
//  ROUTES: SCHOOL DATA UPLOAD (CSV) & SCHOOL ADMIN  (mounted at /api/admin)
// ════════════════════════════════════════════════════════════════
const express = require('express');
const bcrypt  = require('bcryptjs');
const csv     = require('csv-parser');
const stream  = require('stream');
const { db, uploadCSV } = require('../config/clients');
const { verifyAdmin } = require('../middleware/auth');

const router = express.Router();

router.post('/schools/:code/upload/students-csv', verifyAdmin, uploadCSV.single('file'), async (req, res) => {
  try {
    const { data: school } = await db.from('schools').select('id').eq('school_code', req.params.code.toUpperCase()).single();
    if (!school) return res.status(404).json({ error: 'School not found' });
    const rows = [];
    const readable = stream.Readable.from(req.file.buffer.toString());
    await new Promise((resolve, reject) => {
      readable.pipe(csv()).on('data', row => rows.push(row)).on('end', resolve).on('error', reject);
    });
    const students = await Promise.all(rows.filter(r => r.roll_number && r.name).map(async r => ({
      school_id: school.id, roll_number: r.roll_number?.trim(), name: r.name?.trim(),
      class_level: r.class_level?.trim() || '', section: r.section?.trim() || '',
      email: r.email || null, phone: r.phone || null,
      parent_name: r.parent_name || null, parent_phone: r.parent_phone || null,
      password_hash: await bcrypt.hash(r.password || r.roll_number?.trim(), 12),
    })));
    const { data, error } = await db.from('school_students')
      .upsert(students, { onConflict: 'school_id,roll_number' }).select();
    if (error) throw error;
    res.json({ success: true, imported: data.length });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/schools/:code/upload/teachers-csv', verifyAdmin, uploadCSV.single('file'), async (req, res) => {
  try {
    const { data: school } = await db.from('schools').select('id').eq('school_code', req.params.code.toUpperCase()).single();
    if (!school) return res.status(404).json({ error: 'School not found' });
    const rows = [];
    const readable = stream.Readable.from(req.file.buffer.toString());
    await new Promise((resolve, reject) => {
      readable.pipe(csv()).on('data', row => rows.push(row)).on('end', resolve).on('error', reject);
    });
    const teachers = await Promise.all(rows.filter(r => r.employee_id && r.name).map(async r => ({
      school_id: school.id, employee_id: r.employee_id?.trim(), name: r.name?.trim(),
      subjects: r.subjects ? r.subjects.split('|').map(s => s.trim()) : [],
      email: r.email || null, phone: r.phone || null, qualification: r.qualification || null,
      password_hash: await bcrypt.hash(r.password || r.employee_id?.trim(), 12),
    })));
    const { data, error } = await db.from('school_teachers')
      .upsert(teachers, { onConflict: 'school_id,employee_id' }).select();
    if (error) throw error;
    res.json({ success: true, imported: data.length });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/schools', verifyAdmin, async (req, res) => {
  try {
    const { name, schoolCode, address, city, state, contactEmail, contactPhone, maxStudents = 500, maxTeachers = 50 } = req.body;
    if (!name || !schoolCode) return res.status(400).json({ error: 'Name and code required' });
    const { data, error } = await db.from('schools').insert({
      name: name.trim(), school_code: schoolCode.toUpperCase().trim(), address, city, state,
      contact_email: contactEmail, contact_phone: contactPhone, max_students: maxStudents, max_teachers: maxTeachers,
    }).select().single();
    if (error?.code === '23505') return res.status(409).json({ error: 'School code already exists' });
    if (error) throw error;
    res.status(201).json(data);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/schools', verifyAdmin, async (req, res) => {
  const { data } = await db.from('schools').select('*').order('created_at', { ascending: false });
  res.json(data || []);
});

module.exports = router;
