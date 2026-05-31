// ════════════════════════════════════════════════════════════════
//  ROUTES: DEBUG  (mounted at /debug)
// ════════════════════════════════════════════════════════════════
const express = require('express');
const { db } = require('../config/clients');
const { verifyToken } = require('../middleware/auth');

const router = express.Router();

router.get('/profile/:userId', verifyToken, async (req, res) => {
  const results = {}

  // Test 1: basic user select
  try {
    const { data, error } = await db.from('users')
      .select('id, name, role, type, school_id')
      .eq('id', req.params.userId)
      .maybeSingle()
    results.user = error ? { ERROR: error.message, code: error.code } : { OK: true, name: data?.name }
  } catch(e) { results.user = { EXCEPTION: e.message } }

  // Test 2: user_profiles table
  try {
    const { data, error } = await db.from('user_profiles').select('user_id').limit(1)
    results.user_profiles_table = error ? { ERROR: error.message } : { OK: true }
  } catch(e) { results.user_profiles_table = { EXCEPTION: e.message } }

  // Test 3: user_xp table
  try {
    const { data, error } = await db.from('user_xp')
      .select('user_id, total_xp')
      .eq('user_id', req.params.userId)
      .maybeSingle()
    results.user_xp = error ? { ERROR: error.message } : { OK: true, total_xp: data?.total_xp ?? 'no record' }
  } catch(e) { results.user_xp = { EXCEPTION: e.message } }

  // Test 4: get_xp_ranking RPC
  try {
    const { data, error } = await db.rpc('get_xp_ranking', { p_user_id: req.params.userId })
    results.get_xp_ranking_rpc = error ? { ERROR: error.message } : { OK: true, data }
  } catch(e) { results.get_xp_ranking_rpc = { EXCEPTION: e.message } }

  // Test 5: schools join
  try {
    const { data, error } = await db.from('users')
      .select('id, schools(name, school_code)')
      .eq('id', req.params.userId)
      .maybeSingle()
    results.schools_join = error ? { ERROR: error.message } : { OK: true }
  } catch(e) { results.schools_join = { EXCEPTION: e.message } }

  res.json(results)
})

module.exports = router;
