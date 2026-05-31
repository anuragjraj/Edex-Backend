// ════════════════════════════════════════════════════════════════
//  AI — Anthropic → OpenAI → Groq (fallback chain)
// ════════════════════════════════════════════════════════════════
const { anthropic, openai, groq } = require('../config/clients');
const { MODEL_TIER } = require('../config/constants');

async function callAI(messages, system = '', maxTokens = 2000, tool = 'default') {
  const claudeModel = MODEL_TIER[tool] || 'claude-sonnet-4-6';

  // 1. Try Anthropic (Claude) — primary
  try {
    const response = await anthropic.messages.create({
      model:      claudeModel,
      max_tokens: Math.min(maxTokens, 8096),
      system:     system || undefined,
      messages:   messages.map(m => ({
        role:    m.role === 'assistant' ? 'assistant' : 'user',
        content: m.content,
      })),
    });
    const text = response.content[0].text;
    return { text: text.replace(/```[\w]*\n?/gi, '').trim(), provider: 'claude' };
  } catch (e) {
    console.warn('[Claude failed, trying OpenAI]', e.message?.slice(0, 80));
  }

  // 2. Try OpenAI — fallback 1
  if (openai) {
    try {
      const msgs = [];
      if (system) msgs.push({ role: 'system', content: system });
      msgs.push(...messages.map(m => ({
        role: m.role === 'assistant' ? 'assistant' : 'user', content: m.content,
      })));
      const r = await openai.chat.completions.create({
        model: 'gpt-4o-mini', max_tokens: Math.min(maxTokens, 4096), messages: msgs,
      });
      return { text: r.choices[0].message.content.trim(), provider: 'openai' };
    } catch (e) {
      console.warn('[OpenAI failed, trying Groq]', e.message?.slice(0, 80));
    }
  }

  // 3. Try Groq — fallback 2
  if (groq) {
    const msgs = [];
    if (system) msgs.push({ role: 'system', content: system });
    msgs.push(...messages.map(m => ({
      role: m.role === 'assistant' ? 'assistant' : 'user', content: m.content,
    })));
    const r = await groq.chat.completions.create({
      model: 'llama-3.3-70b-versatile', max_tokens: Math.min(maxTokens, 4096), messages: msgs,
    });
    return { text: r.choices[0].message.content.trim(), provider: 'groq' };
  }

  throw new Error('All AI providers failed. Please try again.');
}

module.exports = { callAI };
