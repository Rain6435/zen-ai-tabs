// Firefox on-device provider via browser.trial.ml (experimental, optional permission "trialML").
// Zero-shot classification: each tab is scored against candidate labels (existing group names + fixed topics).
// Runs sequentially: the trial API does not allow parallel engines. No network calls after model download.
import { COLORS, ProviderError } from './aiProvider.js';

// Model labels (short, classifier-friendly) mapped to display names (<= 18 chars).
export const TOPIC_LABELS = {
  'software development': '💻 Dev',
  documentation: '📚 Docs',
  research: '🔬 Research',
  news: '📰 News',
  'social media': '💬 Social',
  video: '🎬 Video',
  music: '🎵 Music',
  shopping: '🛒 Shopping',
  finance: '💰 Finance',
  travel: '✈️ Travel',
  email: '📧 Email',
  entertainment: '🎮 Fun',
  education: '🎓 Learning',
  work: '💼 Work',
};
export const MIN_SCORE = 0.35;
const MAX_LABELS = 20;

export function localAvailable() {
  return typeof browser?.trial?.ml?.createEngine === 'function';
}

// Must be called from a user gesture (popup click). Returns true if granted.
export async function requestLocalPermission() {
  return browser.permissions.request({ permissions: ['trialML'] });
}

function readScores(res) {
  const r = Array.isArray(res) ? res[0] : res;
  if (!r || !Array.isArray(r.labels) || !Array.isArray(r.scores)) {
    throw new ProviderError('Firefox on-device engine returned an unexpected result shape');
  }
  return r;
}

// compressed: [{id, domain, title}]; existingNames: string[] of current group titles.
export async function classifyLocal(compressed, existingNames = []) {
  if (!localAvailable()) {
    throw new ProviderError(
      'Firefox on-device AI unavailable. Set browser.ml.enable and extensions.ml.enabled to true in about:config.'
    );
  }
  const labels = [...new Set([...existingNames.filter(Boolean), ...Object.keys(TOPIC_LABELS)])].slice(0, MAX_LABELS);
  await browser.trial.ml.createEngine({ taskName: 'zero-shot-classification' });

  const byLabel = new Map();
  for (const t of compressed) {
    const res = await browser.trial.ml.runEngine({ args: [`${t.domain}: ${t.title}`, labels] });
    const { labels: outLabels, scores } = readScores(res);
    if (!scores.length || scores[0] < MIN_SCORE) continue;
    const top = outLabels[0];
    if (!byLabel.has(top)) byLabel.set(top, []);
    byLabel.get(top).push(t.id);
  }

  // Existing group titles pass through unchanged so applyGroupDiff merges into them.
  const groups = [...byLabel.entries()]
    .filter(([, ids]) => ids.length >= 2)
    .map(([label, tabIds], i) => ({
      name: TOPIC_LABELS[label] ?? label,
      color: COLORS[i % COLORS.length],
      tabIds,
    }));
  return { groups };
}
