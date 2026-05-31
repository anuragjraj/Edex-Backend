// ════════════════════════════════════════════════════════════════
//  Express App — middleware wiring + route mounting
// ════════════════════════════════════════════════════════════════
require('./config/env');

const express   = require('express');
const cors      = require('cors');
const helmet    = require('helmet');
const morgan    = require('morgan');
const rateLimit = require('express-rate-limit');

const app = express();

// ── Global middleware ────────────────────────────────────────────
app.use(helmet());
app.use(morgan('dev'));
app.use(cors({
  origin(origin, cb) {
    if (!origin) return cb(null, true);
    const allowed = [process.env.FRONTEND_URL, 'http://localhost:3000', 'http://localhost:5173'];
    const ok = allowed.includes(origin) || origin.includes('vercel.app') || origin.includes('netlify.app');
    cb(ok ? null : new Error('CORS blocked'), ok);
  },
  credentials: true,
}));
app.use(express.json({ limit: '10mb' }));

const globalLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 400 });
app.use(globalLimiter);

// ── Routes ───────────────────────────────────────────────────────
app.use('/api/auth',            require('./routes/auth.routes'));
app.use('/api/user',            require('./routes/user.routes'));
app.use('/api/upload',          require('./routes/upload.routes'));
app.use('/api/posts',           require('./routes/posts.routes'));
app.use('/api/courses',         require('./routes/courses.routes'));
app.use('/api/search',          require('./routes/search.routes'));
app.use('/api/profiles',        require('./routes/profiles.routes'));
app.use('/api/conversations',   require('./routes/messaging.routes'));
app.use('/api/school',          require('./routes/school.routes'));
app.use('/api/assignments',     require('./routes/assignments.routes'));
app.use('/api/buddy',           require('./routes/buddy.routes'));
app.use('/api/admin',           require('./routes/admin.routes'));
app.use('/api/subscription',    require('./routes/subscription.routes'));
app.use('/api/ai',              require('./routes/ai.routes'));
app.use('/api/chapter-courses', require('./routes/chapterCourses.routes'));
app.use('/debug',               require('./routes/debug.routes'));
app.use('/health',              require('./routes/health.routes'));

// ── Error handlers ───────────────────────────────────────────────
app.use((err, req, res, next) => { console.error('[Unhandled]', err); res.status(500).json({ error: 'Internal server error' }); });
app.use((req, res) => res.status(404).json({ error: `Not found: ${req.method} ${req.path}` }));

module.exports = app;
