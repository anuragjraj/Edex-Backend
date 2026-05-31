// ════════════════════════════════════════════════════════════════
//  ROUTES: MEDIA UPLOAD  (mounted at /api/upload)
// ════════════════════════════════════════════════════════════════
const express = require('express');
const crypto  = require('crypto');
const { db, upload } = require('../config/clients');
const { verifyToken } = require('../middleware/auth');

const router = express.Router();

router.post('/media', verifyToken, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file provided' });
    const ext  = req.file.originalname.split('.').pop().toLowerCase();
    const name = `${req.user.id}/${Date.now()}-${crypto.randomBytes(6).toString('hex')}.${ext}`;
    const { error } = await db.storage
      .from(process.env.SUPABASE_STORAGE_BUCKET || 'brainspark-media')
      .upload(name, req.file.buffer, { contentType: req.file.mimetype });
    if (error) throw error;
    const { data: urlData } = db.storage
      .from(process.env.SUPABASE_STORAGE_BUCKET || 'brainspark-media')
      .getPublicUrl(name);
    res.json({
      url:  urlData.publicUrl,
      type: req.file.mimetype.startsWith('image/') ? 'image' : 'pdf',
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
