// ════════════════════════════════════════════════════════════════
//  ROUTES: SOCIAL FEED (with media + rich comments)  (mounted at /api/posts)
// ════════════════════════════════════════════════════════════════
const express = require('express');
const crypto  = require('crypto');
const { db } = require('../config/clients');
const { verifyToken } = require('../middleware/auth');

const router = express.Router();

router.get('/', verifyToken, async (req, res) => {
  try {
    let query = db.from('posts').select('*').order('created_at', { ascending: false }).limit(100);
    // School users only see posts from their school
    if (req.user.type === 'school') {
      const { data: u } = await db.from('users').select('school_id').eq('id', req.user.id).single();
      query = query.eq('school_id', u.school_id);
    } else {
      query = query.is('school_id', null);
    }
    const { data } = await query;
    res.json(data || []);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/', verifyToken, async (req, res) => {
  try {
    const { body, subj, tags, anon, grad, media_url, media_type } = req.body;
    if (!body?.trim() && !media_url) return res.status(400).json({ error: 'Post cannot be empty' });
    const { data: user } = await db.from('users').select('name, class_level, school_id').eq('id', req.user.id).single();
    const { data, error } = await db.from('posts').insert({
      uid:           anon ? null : req.user.id,
      uname:         anon ? 'Anonymous Student' : user.name,
      ucls:          user.class_level || 'Student',
      subj:          subj || 'General',
      body:          body?.trim() || '',
      tags:          tags || [],
      likes:         0,
      rich_comments: [],
      anon:          !!anon,
      grad:          grad || '135deg,#6366F1,#8B5CF6',
      media_url:     media_url || null,
      media_type:    media_type || null,
      school_id:     req.user.type === 'school' ? user.school_id : null,
    }).select().single();
    if (error) throw error;
    res.status(201).json(data);
  } catch (e) { console.error('[post]', e); res.status(500).json({ error: e.message }); }
});

router.patch('/:id/like', verifyToken, async (req, res) => {
  try {
    await db.rpc('increment_post_like', { p_post_id: req.params.id });
    res.json({ success: true });
  } catch {
    const { data: post } = await db.from('posts').select('likes').eq('id', req.params.id).single();
    await db.from('posts').update({ likes: (post?.likes || 0) + 1 }).eq('id', req.params.id);
    res.json({ success: true });
  }
});

router.post('/:id/comment', verifyToken, async (req, res) => {
  try {
    const { text, media_url, media_type } = req.body;
    if (!text?.trim() && !media_url) return res.status(400).json({ error: 'Comment cannot be empty' });

    const { data: post } = await db.from('posts').select('rich_comments, school_id').eq('id', req.params.id).single();

    // School isolation
    if (post?.school_id && req.user.type === 'school') {
      const { data: u } = await db.from('users').select('school_id').eq('id', req.user.id).single();
      if (u.school_id !== post.school_id) return res.status(403).json({ error: 'Access denied' });
    }

    const comment = {
      id:          crypto.randomUUID(),
      author_id:   req.user.id,
      author_name: req.user.name || 'User',
      text:        text?.trim() || '',
      media_url:   media_url || null,
      media_type:  media_type || null,
      created_at:  new Date().toISOString(),
    };
    const updated = [...(post?.rich_comments || []), comment];
    await db.from('posts').update({ rich_comments: updated }).eq('id', req.params.id);
    res.json(comment);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
