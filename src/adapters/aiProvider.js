// Unified BYOK adapter. Pure ESM; uses global fetch only. No telemetry, no proxy.
import { toPromptLines } from '../core/sanitize.js';

export const COLORS = ['blue', 'red', 'yellow', 'green', 'pink', 'purple', 'cyan', 'orange'];
export const MAX_NAME = 18;
const TIMEOUT_MS = 20000;

export const GROUP_SCHEMA = {
  type: 'object',
  properties: {
    groups: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'emoji + short name, <= 18 chars' },
          color: { type: 'string', enum: COLORS },
          tabIds: { type: 'array', items: { type: 'integer' } },
        },
        required: ['name', 'color', 'tabIds'],
        additionalProperties: false,
      },
    },
  },
  required: ['groups'],
  additionalProperties: false,
};

const SYSTEM = [
  'You cluster browser tabs into topical groups.',
  'Input lines are "[ID | domain | title]". Output only the JSON defined by the schema.',
  'Rules: each tabId may appear in at most one group; only use IDs from the input;',
  'reuse an existing group name exactly when a tab fits it; create at most 8 new groups;',
  'do not create groups with fewer than 2 tabs; leave unrelated tabs out.',
  'Group name: one emoji then a short label, max 18 characters.',
].join(' ');

export class ProviderError extends Error {
  constructor(message, status = 0) {
    super(message);
    this.name = 'ProviderError';
    this.status = status;
  }
}

function buildUserPrompt(compressed, existingGroups) {
  const existing = existingGroups.length
    ? `Existing groups (reuse exact name when applicable): ${existingGroups.map((g) => JSON.stringify(g.name)).join(', ')}\n`
    : '';
  return `${existing}Tabs:\n${toPromptLines(compressed)}`;
}

async function post(url, headers, body) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    const text = await res.text();
    if (!res.ok) throw new ProviderError(`HTTP ${res.status}: ${text.slice(0, 300)}`, res.status);
    try {
      return JSON.parse(text);
    } catch {
      throw new ProviderError('Provider returned non-JSON body', res.status);
    }
  } catch (e) {
    if (e.name === 'AbortError') throw new ProviderError('Provider timeout');
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

function parseJsonPayload(s) {
  if (typeof s !== 'string') return s;
  try {
    return JSON.parse(s);
  } catch {
    throw new ProviderError('Model output is not valid JSON');
  }
}

// Gemini: generateContent with responseMimeType + responseSchema (REST, camelCase).
export async function callGemini(compressed, apiKey, model = 'gemini-3.1-flash-lite', existingGroups = []) {
  const data = await post(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
    { 'x-goog-api-key': apiKey },
    {
      systemInstruction: { parts: [{ text: SYSTEM }] },
      contents: [{ role: 'user', parts: [{ text: buildUserPrompt(compressed, existingGroups) }] }],
      generationConfig: {
        temperature: 0,
        maxOutputTokens: 1024,
        responseMimeType: 'application/json',
        responseSchema: GROUP_SCHEMA,
      },
    }
  );
  const text = data?.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('');
  if (!text) throw new ProviderError('Gemini returned no content');
  return parseJsonPayload(text);
}

// Claude: single enforced tool call. Haiku 5.5 only.
// credential: API key string, or { type: 'apikey' | 'oauth', token }.
// OAuth (Claude Pro/Max, from ~/.claude/.credentials.json) is Bearer-auth with the oauth beta flag,
// the same mechanism jobby's ANTHROPIC_AUTH_TOKEN path uses. Restricted to Haiku, as jobby does:
// non-Haiku models return a generic 400 for OAuth tokens outside the Claude Code client.
export async function callClaude(compressed, credential, model = 'claude-haiku-5-5', existingGroups = []) {
  const TOOL = 'apply_tab_groups';
  const auth = typeof credential === 'string' ? { type: 'apikey', token: credential } : credential;
  if (auth.type === 'oauth' && !/haiku/i.test(model)) {
    throw new ProviderError('Claude OAuth tokens are limited to Haiku models. Set the model to claude-haiku-5-5.');
  }
  const headers =
    auth.type === 'oauth'
      ? { authorization: `Bearer ${auth.token}`, 'anthropic-beta': 'oauth-2025-04-20' }
      : { 'x-api-key': auth.token };
  headers['anthropic-version'] = '2023-06-01';
  headers['anthropic-dangerous-direct-browser-access'] = 'true';

  let data;
  try {
    data = await post('https://api.anthropic.com/v1/messages', headers, {
      model,
      max_tokens: 1024,
      temperature: 0,
      system: SYSTEM,
      tools: [{ name: TOOL, description: 'Apply the tab grouping plan.', input_schema: GROUP_SCHEMA }],
      tool_choice: { type: 'tool', name: TOOL },
      messages: [{ role: 'user', content: buildUserPrompt(compressed, existingGroups) }],
    });
  } catch (e) {
    if (auth.type === 'oauth' && e.status === 401) {
      // Keep Anthropic's own error text so the cause (token vs model) is visible.
      throw new ProviderError(`Claude OAuth rejected (${e.message}). If the token is fresh, check the model is claude-haiku-4-5-20251001.`, 401);
    }
    if (auth.type === 'oauth' && e.status === 429) {
      throw new ProviderError(
        'Claude subscription Code usage limit hit for this ~5-hour window. This is separate from API credits.',
        429
      );
    }
    throw e;
  }
  const block = data?.content?.find((b) => b.type === 'tool_use' && b.name === TOOL);
  if (!block || typeof block.input !== 'object') throw new ProviderError('Claude returned no tool_use block');
  return block.input;
}

// OpenAI: Chat Completions with strict json_schema, reasoning disabled.
export async function callOpenAI(compressed, apiKey, model = 'gpt-6-luna', existingGroups = []) {
  const data = await post(
    'https://api.openai.com/v1/chat/completions',
    { authorization: `Bearer ${apiKey}` },
    {
      model,
      // gpt-6-luna: none/low/medium/high/xhigh/max; none = no reasoning tokens, lowest latency.
      reasoning_effort: 'none',
      max_completion_tokens: 1024,
      messages: [
        { role: 'system', content: SYSTEM },
        { role: 'user', content: buildUserPrompt(compressed, existingGroups) },
      ],
      response_format: {
        type: 'json_schema',
        json_schema: { name: 'apply_tab_groups', strict: true, schema: GROUP_SCHEMA },
      },
    }
  );
  const content = data?.choices?.[0]?.message?.content;
  if (!content) throw new ProviderError('OpenAI returned no content');
  return parseJsonPayload(content);
}

const ADAPTERS = { gemini: callGemini, claude: callClaude, openai: callOpenAI };

export function callProvider(provider, compressed, apiKey, model, existingGroups) {
  const fn = ADAPTERS[provider];
  if (!fn) throw new ProviderError(`Unknown provider: ${provider}`);
  return fn(compressed, apiKey, model || undefined, existingGroups);
}

// Schema validation + sanitization of model output. Never trusts IDs or structure.
// allowedIds: Set<number> of tab IDs that were actually sent.
export function validateGroups(raw, allowedIds) {
  const seen = new Set();
  const out = [];
  let dropped = 0;
  const list = Array.isArray(raw?.groups) ? raw.groups : [];
  for (const g of list) {
    const name = typeof g?.name === 'string' ? [...g.name.trim()].slice(0, MAX_NAME).join('') : '';
    const color = COLORS.includes(g?.color) ? g.color : 'blue';
    const ids = Array.isArray(g?.tabIds) ? g.tabIds : [];
    const clean = [];
    for (const id of ids) {
      if (Number.isInteger(id) && allowedIds.has(id) && !seen.has(id)) {
        seen.add(id);
        clean.push(id);
      } else {
        dropped++;
      }
    }
    if (!name || clean.length < 2) continue;
    out.push({ name, color, tabIds: clean });
  }
  return { groups: out, dropped };
}
