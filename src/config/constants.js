// ════════════════════════════════════════════════════════════════
//  Shared constants & configuration tables
// ════════════════════════════════════════════════════════════════

// AI model tier per tool — primary Claude model selection.
const MODEL_TIER = {
  doubt:      'claude-haiku-4-5-20251001',
  flashcards: 'claude-haiku-4-5-20251001',
  buddy:      'claude-haiku-4-5-20251001',
  quiz:       'claude-sonnet-4-6',
  notes:      'claude-sonnet-4-6',
  paper:      'claude-sonnet-4-6',
  cheatsheet: 'claude-sonnet-4-6',
  lessonplan: 'claude-sonnet-4-6',
};

// FREE TIER — wall-clock window (seconds) from first AI call.
const FREE_WINDOW_SECONDS = 600; // 10 minutes

// AI tool XP / token / label config.
const AI_CONFIGS = {
  doubt:      { xp: 15, maxTokens: 800,  label: 'doubt'      },
  quiz:       { xp: 5,  maxTokens: 7500, label: 'quiz'       },
  notes:      { xp: 20, maxTokens: 7500, label: 'notes'      },
  paper:      { xp: 25, maxTokens: 8000, label: 'paper'      },
  flashcards: { xp: 15, maxTokens: 2000, label: 'flashcards' },
  cheatsheet: { xp: 30, maxTokens: 8096, label: 'cheatsheet' },
  lessonplan: { xp: 30, maxTokens: 4000, label: 'lessonplan' },
};

// Subscription plans (amounts in paise).
const PLANS = {
  student_monthly:  { amount: 15000,  label: 'Student Monthly',  months: 1  },
  student_yearly:   { amount: 150000, label: 'Student Yearly',   months: 12 },
  teacher_monthly:  { amount: 18000,  label: 'Teacher Monthly',  months: 1  },
  teacher_yearly:   { amount: 180000, label: 'Teacher Yearly',   months: 12 },
};

module.exports = { MODEL_TIER, FREE_WINDOW_SECONDS, AI_CONFIGS, PLANS };
