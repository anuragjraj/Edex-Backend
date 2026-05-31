// ════════════════════════════════════════════════════════════════
//  Auth helpers & middleware
// ════════════════════════════════════════════════════════════════
const jwt    = require('jsonwebtoken');
const crypto = require('crypto');
const { db } = require('../config/clients');
const { FREE_WINDOW_SECONDS } = require('../config/constants');

function signToken(payload) {
  return jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '30d' });
}

async function createSession(userId, deviceInfo = {}) {
  const sessionToken = crypto.randomBytes(32).toString('hex');
  await db.from('user_sessions').update({ is_active: false }).eq('user_id', userId);
  await db.from('user_sessions').insert({
    user_id: userId, session_token: sessionToken,
    device_info: deviceInfo, ip_address: deviceInfo.ip || null,
    user_agent: deviceInfo.userAgent || null, is_active: true,
    expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
  });
  return sessionToken;
}

async function verifyToken(req, res, next) {
  const auth = req.headers.authorization;
  const stok = req.headers['x-session-token'];
  if (!auth?.startsWith('Bearer ')) return res.status(401).json({ error: 'Authentication required' });
  try {
    req.user = jwt.verify(auth.slice(7), process.env.JWT_SECRET);
  } catch {
    return res.status(401).json({ error: 'Session expired. Please sign in again.' });
  }
  if (stok) {
    const { data: sess } = await db.from('user_sessions')
      .select('id').eq('user_id', req.user.id).eq('session_token', stok).eq('is_active', true).maybeSingle();
    if (!sess) return res.status(401).json({ error: 'Signed in on another device.', code: 'SESSION_REPLACED' });
    await db.from('user_sessions').update({ last_seen_at: new Date().toISOString() })
      .eq('user_id', req.user.id).eq('session_token', stok);
  }
  next();
}

function verifyAdmin(req, res, next) {
  if (req.headers['x-admin-key'] !== process.env.ADMIN_SECRET_KEY) return res.status(403).json({ error: 'Admin required' });
  next();
}

// ════════════════════════════════════════════════════════════════
//  FREE TIER — Wall-clock 10 minutes from first AI call
// ════════════════════════════════════════════════════════════════
async function checkAccess(req, res, next) {
  if (req.user.type === 'school') return next();

  const { data: u } = await db.from('users')
    .select('subscription_status, subscription_expires_at, free_tier_started_at')
    .eq('id', req.user.id).single();

  // Active paid subscriber
  if (u?.subscription_status === 'active' && u.subscription_expires_at && new Date(u.subscription_expires_at) > new Date()) {
    return next();
  }

  // First ever AI call — start the clock
  if (!u?.free_tier_started_at) {
    await db.from('users')
      .update({ free_tier_started_at: new Date().toISOString() })
      .eq('id', req.user.id);
    req.freeSecondsRemaining = FREE_WINDOW_SECONDS;
    return next();
  }

  // Calculate remaining wall-clock time
  const elapsed   = Math.floor((Date.now() - new Date(u.free_tier_started_at)) / 1000);
  const remaining = FREE_WINDOW_SECONDS - elapsed;

  if (remaining <= 0) {
    return res.status(402).json({
      error:            'Your 10-minute free trial has ended.',
      code:             'SUBSCRIPTION_REQUIRED',
      secondsRemaining: 0,
    });
  }

  req.freeSecondsRemaining = remaining;
  next();
}

module.exports = { signToken, createSession, verifyToken, verifyAdmin, checkAccess };
