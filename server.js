/**
 * BrainSpark AI — Backend Server v5.0
 * Node.js + Express + Claude AI + OpenAI + Groq (fallback chain)
 *
 * Entry point. Application wiring lives in src/app.js; feature logic is
 * split across src/{config,middleware,helpers,services,routes}.
 *
 * INSTALL:
 *   npm install express cors bcryptjs jsonwebtoken express-rate-limit
 *              helmet morgan @supabase/supabase-js @anthropic-ai/sdk
 *              google-auth-library razorpay nodemailer crypto dotenv
 *              openai groq-sdk multer csv-parser
 *
 * ENV VARS (add to .env):
 *   OPENAI_API_KEY=sk-...
 *   GROQ_API_KEY=gsk_...
 *   SUPABASE_STORAGE_BUCKET=brainspark-media
 */
require('./src/config/env');

const app = require('./src/app');
const { startAssignmentAnalysisCron } = require('./src/services/assignmentAnalysis');

const PORT = process.env.PORT || 5000;

// Assignment auto-analysis engine (runs every 15 min)
startAssignmentAnalysisCron();

app.listen(PORT, () => {
  console.log(`\n🚀 BrainSpark AI v5 — http://localhost:${PORT}`);
  console.log(`   Claude:   ${process.env.ANTHROPIC_API_KEY ? '✅' : '❌ MISSING'}`);
  console.log(`   OpenAI:   ${process.env.OPENAI_API_KEY   ? '✅' : '⚠️  not set (fallback disabled)'}`);
  console.log(`   Groq:     ${process.env.GROQ_API_KEY     ? '✅' : '⚠️  not set (fallback disabled)'}`);
  console.log(`   Supabase: ${process.env.SUPABASE_URL     ? '✅' : '❌ MISSING'}`);
  console.log(`   Razorpay: ${process.env.RAZORPAY_KEY_ID  ? '✅' : '⚠️  not set (payments disabled)'}`);
  console.log(`   Email:    ${process.env.EMAIL_USER       ? '✅' : '⚠️  not set (password reset disabled)'}\n`);
});
