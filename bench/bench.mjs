// Usage: node bench/bench.mjs <provider> <apiKey> [model] [runs]
// Measures sanitize + API roundtrip + validation on synthetic 50-tab input. Apply step needs a browser; see README-free notes in chat.
import { compressTabs, toPromptLines } from '../src/core/sanitize.js';
import { callProvider, validateGroups } from '../src/adapters/aiProvider.js';

const [provider = 'gemini', apiKey, model, runs = '3'] = process.argv.slice(2);
if (!apiKey) { console.error('apiKey required'); process.exit(1); }

const sites = [
  ['github.com', 'owner/repo: fix flaky test in scheduler'], ['stackoverflow.com', 'How to dedupe arrays in JS - Stack Overflow'],
  ['en.wikipedia.org', 'Transformer (deep learning) - Wikipedia'], ['youtube.com', 'Lo-fi beats to study to | YouTube'],
  ['docs.python.org', 'asyncio — Asynchronous I/O'], ['news.ycombinator.com', 'Show HN: a tiny CRDT library'],
  ['mail.google.com', 'Inbox (12) - you@example.com'], ['amazon.ca', 'USB-C hub 7-in-1 - Amazon.ca'],
];
const tabs = Array.from({ length: 50 }, (_, i) => {
  const [host, title] = sites[i % sites.length];
  return { id: 100 + i, url: `https://${host}/p/${i}?utm_source=x&fbclid=abc${i}#frag`, title, groupId: -1, pinned: false, cookieStoreId: 'firefox-default' };
});

const compressed = compressTabs(tabs);
const promptText = toPromptLines(compressed);
console.log(`prompt ~${Math.ceil(promptText.length / 4)} tokens (chars/4 estimate), ${compressed.length} tabs`);

const allowed = new Set(tabs.map((t) => t.id));
const samples = [];
for (let r = 0; r < Number(runs); r++) {
  const t0 = performance.now();
  const s0 = performance.now(); compressTabs(tabs); const sanitizeMs = performance.now() - s0;
  const a0 = performance.now();
  const raw = await callProvider(provider, compressed, apiKey, model, []);
  const apiMs = performance.now() - a0;
  const v0 = performance.now(); const { groups, dropped } = validateGroups(raw, allowed); const validateMs = performance.now() - v0;
  samples.push({ run: r + 1, sanitizeMs, apiMs, validateMs, totalMs: performance.now() - t0, groups: groups.length, dropped });
}
console.table(samples.map((s) => Object.fromEntries(Object.entries(s).map(([k, v]) => [k, typeof v === 'number' ? +v.toFixed(2) : v]))));
