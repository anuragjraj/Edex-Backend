// ════════════════════════════════════════════════════════════════
//  Service Clients
//  Centralised initialisation of every external SDK / client used
//  across the app. Each is lazily disabled when its env var is absent
//  (matching the original server.js behaviour exactly).
// ════════════════════════════════════════════════════════════════
require('./env');

const { createClient } = require('@supabase/supabase-js');
const Anthropic        = require('@anthropic-ai/sdk');
const OpenAI           = require('openai');
const Groq             = require('groq-sdk');
const { OAuth2Client } = require('google-auth-library');
const Razorpay         = require('razorpay');
const nodemailer       = require('nodemailer');
const multer           = require('multer');

const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const openai = process.env.OPENAI_API_KEY
  ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY }) : null;

const groq = process.env.GROQ_API_KEY
  ? new Groq({ apiKey: process.env.GROQ_API_KEY }) : null;

const googleAuth = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

const razorpay = process.env.RAZORPAY_KEY_ID
  ? new Razorpay({ key_id: process.env.RAZORPAY_KEY_ID, key_secret: process.env.RAZORPAY_KEY_SECRET })
  : null;

const mailer = process.env.EMAIL_USER
  ? nodemailer.createTransport({ service: 'gmail', auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS } })
  : null;

// Multer for file uploads
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter(req, file, cb) {
    const allowed = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'application/pdf'];
    cb(null, allowed.includes(file.mimetype));
  },
});
const uploadCSV = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

module.exports = { db, anthropic, openai, groq, googleAuth, razorpay, mailer, upload, uploadCSV };
