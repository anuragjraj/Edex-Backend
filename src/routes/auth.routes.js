// ════════════════════════════════════════════════════════════════
//  ROUTES: AUTH  (mounted at /api/auth)
// ════════════════════════════════════════════════════════════════
const express = require('express');
const bcrypt  = require('bcryptjs');
const crypto  = require('crypto');
const { db, googleAuth, mailer } = require('../config/clients');
const { verifyToken } = require('../middleware/auth');
const { safeUser, buildLoginResponse } = require('../helpers/gamification');

const router = express.Router();

router.post('/register', async (req, res) => {
  try {
    const { name, email, password, role = 'student' } = req.body;
    if (!name || !email || !password) return res.status(400).json({ error: 'All fields required' });
    if (password.length < 8) return res.status(400).json({ error: 'Password must be >= 8 characters' });
    if (!['student', 'teacher'].includes(role)) return res.status(400).json({ error: 'Invalid role' });
    const { data: ex } = await db.from('users').select('id').eq('email', email.toLowerCase()).maybeSingle();
    if (ex) return res.status(409).json({ error: 'Email already registered.' });
    const { data: user, error } = await db.from('users').insert({
      name: name.trim(), email: email.toLowerCase().trim(),
      password_hash: await bcrypt.hash(password, 12),
      type: 'personal', role, provider: 'email',
    }).select().single();
    if (error) throw error;
    res.status(201).json(await buildLoginResponse(user, { ip: req.ip, userAgent: req.headers['user-agent'] }));
  } catch (e) { console.error('[register]', e); res.status(500).json({ error: 'Registration failed.' }); }
});

router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email and password required' });
    const { data: user } = await db.from('users').select('*').eq('email', email.toLowerCase()).maybeSingle();
    if (!user || !user.password_hash) return res.status(401).json({ error: 'Invalid email or password' });
    if (!await bcrypt.compare(password, user.password_hash)) return res.status(401).json({ error: 'Invalid email or password' });
    if (!user.is_active) return res.status(403).json({ error: 'Account is deactivated.' });
    res.json(await buildLoginResponse(user, { ip: req.ip, userAgent: req.headers['user-agent'] }));
  } catch (e) { console.error('[login]', e); res.status(500).json({ error: 'Login failed.' }); }
});

router.post('/google', async (req, res) => {
  try {
    const { idToken } = req.body;
    if (!idToken) return res.status(400).json({ error: 'Google token required' });
    const ticket  = await googleAuth.verifyIdToken({ idToken, audience: process.env.GOOGLE_CLIENT_ID });
    const payload = ticket.getPayload();
    const { email, name, picture, sub: googleId } = payload;
    let { data: user } = await db.from('users').select('*').eq('email', email.toLowerCase()).maybeSingle();
    if (!user) {
      const { data: newUser, error } = await db.from('users').insert({
        name, email: email.toLowerCase(), provider: 'google', type: 'personal', role: 'student',
        avatar_url: picture, google_id: googleId, email_verified: true,
      }).select().single();
      if (error) throw error;
      user = newUser;
    } else {
      await db.from('users').update({ avatar_url: picture, google_id: googleId }).eq('id', user.id);
      user = { ...user, avatar_url: picture, google_id: googleId };
    }
    res.json(await buildLoginResponse(user, { ip: req.ip, userAgent: req.headers['user-agent'] }));
  } catch (e) { console.error('[google]', e); res.status(401).json({ error: 'Google sign-in failed: ' + e.message }); }
});

router.post('/microsoft', async (req, res) => {
  try {
    const { accessToken } = req.body;
    if (!accessToken) return res.status(400).json({ error: 'Microsoft token required' });
    const graphRes = await fetch('https://graph.microsoft.com/v1.0/me?$select=id,displayName,mail,userPrincipalName', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!graphRes.ok) return res.status(401).json({ error: 'Invalid Microsoft token' });
    const profile = await graphRes.json();
    const email   = (profile.mail || profile.userPrincipalName).toLowerCase();
    const name    = profile.displayName;
    const msId    = profile.id;
    let { data: user } = await db.from('users').select('*').eq('email', email).maybeSingle();
    if (!user) {
      const { data: newUser, error } = await db.from('users').insert({
        name, email, provider: 'microsoft', type: 'personal', role: 'student',
        microsoft_id: msId, email_verified: true,
      }).select().single();
      if (error) throw error;
      user = newUser;
    } else {
      await db.from('users').update({ microsoft_id: msId }).eq('id', user.id);
    }
    res.json(await buildLoginResponse(user, { ip: req.ip, userAgent: req.headers['user-agent'] }));
  } catch (e) { console.error('[microsoft]', e); res.status(500).json({ error: 'Microsoft sign-in failed.' }); }
});

router.post('/school', async (req, res) => {
  try {
    const { schoolCode, identifier, password, role = 'student' } = req.body;
    if (!schoolCode || !identifier || !password) return res.status(400).json({ error: 'School code, ID and password required' });
    const { data: school } = await db.from('schools').select('*').eq('school_code', schoolCode.toUpperCase()).maybeSingle();
    if (!school)             return res.status(404).json({ error: 'School code not found.' });
    if (!school.is_active)   return res.status(403).json({ error: 'School account is inactive.' });
    if (school.subscription_status === 'expired') return res.status(403).json({ error: 'School subscription has expired.' });
    const table   = role === 'teacher' ? 'school_teachers' : 'school_students';
    const idField = role === 'teacher' ? 'employee_id'      : 'roll_number';
    const { data: member } = await db.from(table).select('*').eq('school_id', school.id).eq(idField, identifier.trim()).maybeSingle();
    if (!member)           return res.status(401).json({ error: `${role === 'teacher' ? 'Employee ID' : 'Roll number'} not found.` });
    if (!member.is_active) return res.status(403).json({ error: 'This account has been deactivated.' });
    if (!await bcrypt.compare(password, member.password_hash)) return res.status(401).json({ error: 'Incorrect password.' });
    const syntheticEmail = `${identifier.toLowerCase().replace(/[^a-z0-9]/g, '')}@${schoolCode.toLowerCase()}.school`;
    let { data: user } = await db.from('users').select('*').eq('email', syntheticEmail).maybeSingle();
    if (!user) {
      const { data: newUser, error } = await db.from('users').insert({
        name: member.name, email: syntheticEmail, type: 'school', role, provider: 'school',
        school_id: school.id, class_level: member.class_level || null,
        section: member.section || null, roll_number: role === 'student' ? identifier.trim() : null,
        employee_id: role === 'teacher' ? identifier.trim() : null,
        subject_specialization: role === 'teacher' ? (member.subjects || []).join(', ') : null,
      }).select().single();
      if (error) throw error;
      user = newUser;
    }
    const resp = await buildLoginResponse(user, { ip: req.ip, userAgent: req.headers['user-agent'] });
    resp.schoolName = school.name;
    resp.schoolCode = school.school_code;
    resp.schoolLogo = school.logo_url;
    res.json(resp);
  } catch (e) { console.error('[school login]', e); res.status(500).json({ error: 'School login failed.' }); }
});

router.post('/forgot-password', async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'Email required' });
    const { data: user } = await db.from('users').select('id, name').eq('email', email.toLowerCase()).maybeSingle();
    if (!user || !mailer) return res.json({ success: true, message: 'If that email exists, a reset link was sent.' });
    const token = crypto.randomBytes(32).toString('hex');
    await db.from('password_reset_tokens').insert({
      email: email.toLowerCase(), token,
      expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    });
    const resetLink = `${process.env.FRONTEND_URL}/reset-password?token=${token}`;
    await mailer.sendMail({
      from: `"BrainSpark AI" <${process.env.EMAIL_USER}>`, to: email,
      subject: 'Reset your BrainSpark AI password',
      html: `<div style="font-family:sans-serif;max-width:480px;margin:auto;padding:24px"><h2 style="color:#6366F1">Password Reset</h2><p>Hi ${user.name},</p><p>Click below to reset your password. This link expires in 1 hour.</p><a href="${resetLink}" style="display:inline-block;margin:20px 0;padding:12px 24px;background:#6366F1;color:#fff;text-decoration:none;border-radius:8px;font-weight:700">Reset Password</a><p style="color:#888;font-size:12px">If you didn't request this, ignore this email.</p></div>`,
    });
    res.json({ success: true, message: 'If that email exists, a reset link was sent.' });
  } catch (e) { console.error('[forgot-password]', e); res.status(500).json({ error: 'Failed to send reset email.' }); }
});

router.post('/reset-password', async (req, res) => {
  try {
    const { token, newPassword } = req.body;
    if (!token || !newPassword) return res.status(400).json({ error: 'Token and new password required' });
    if (newPassword.length < 8) return res.status(400).json({ error: 'Password must be >= 8 characters' });
    const { data: rec } = await db.from('password_reset_tokens')
      .select('*').eq('token', token).eq('used', false).maybeSingle();
    if (!rec || new Date(rec.expires_at) < new Date()) return res.status(400).json({ error: 'Invalid or expired reset link.' });
    await db.from('users').update({ password_hash: await bcrypt.hash(newPassword, 12), updated_at: new Date().toISOString() }).eq('email', rec.email);
    await db.from('password_reset_tokens').update({ used: true }).eq('id', rec.id);
    res.json({ success: true });
  } catch (e) { console.error('[reset-password]', e); res.status(500).json({ error: 'Reset failed.' }); }
});

router.get('/me', verifyToken, async (req, res) => {
  try {
    const { data: user } = await db.from('users')
      .select('*, schools(name, school_code, logo_url)')
      .eq('id', req.user.id).maybeSingle();
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json(safeUser(user));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/logout', verifyToken, async (req, res) => {
  const stok = req.headers['x-session-token'];
  if (stok) await db.from('user_sessions').update({ is_active: false }).eq('user_id', req.user.id).eq('session_token', stok);
  res.json({ success: true });
});

module.exports = router;
