const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
const MODEL = 'openai/gpt-4o-mini';

const SYSTEM_PROMPT = `Ты дружелюбный футуристичный AI-компаньон, существующий в дополненной реальности.
Ты появляешься как голографический персонаж перед пользователем через камеру телефона.
Отвечай коротко, живо и выразительно — максимум 2 предложения.
Иногда упоминай, что ты AR-существо или что видишь мир пользователя.
Никогда не используй эмодзи — только текст.`;

// Conversation history — ready for memory feature in future
const history = [];

/**
 * Send user text to OpenRouter and return AI reply string.
 * @param {string} userText
 * @returns {Promise<string>}
 */
export async function askAI(userText) {
  const apiKey = import.meta.env.VITE_OPENROUTER_API_KEY;

  if (!apiKey) {
    throw new Error('VITE_OPENROUTER_API_KEY не задан в .env файле');
  }

  history.push({ role: 'user', content: userText });

  const body = {
    model: MODEL,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      ...history,
    ],
    max_tokens: 120,
    temperature: 0.85,
  };

  const res = await fetch(OPENROUTER_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': window.location.origin,
      'X-Title': 'AR AI',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`OpenRouter error ${res.status}: ${err}`);
  }

  const data = await res.json();
  const reply = data.choices?.[0]?.message?.content?.trim() ?? '...';

  history.push({ role: 'assistant', content: reply });

  // Keep history from growing unbounded (last 10 exchanges)
  if (history.length > 20) history.splice(0, 2);

  return reply;
}

/** Clear conversation history */
export function clearHistory() {
  history.length = 0;
}
