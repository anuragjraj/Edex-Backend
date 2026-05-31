// ════════════════════════════════════════════════════════════════
//  ROUTES: HEALTH CHECK  (mounted at /health)
// ════════════════════════════════════════════════════════════════
const express = require('express');
const { anthropic, openai, groq, razorpay, mailer } = require('../config/clients');

const router = express.Router();

router.get('/', async (req, res) => {
  let ai = 'unknown';
  try {
    await anthropic.messages.create({ model: 'claude-haiku-4-5-20251001', max_tokens: 10, messages: [{ role: 'user', content: 'ok' }] });
    ai = 'claude:ok';
  } catch (e) { ai = `claude:error`; }
  res.json({
    status:   'ok',
    time:     new Date().toISOString(),
    version:  '5.0.0',
    ai,
    openai:   !!openai,
    groq:     !!groq,
    razorpay: !!razorpay,
    email:    !!mailer,
  });
});

module.exports = router;
