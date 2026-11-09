import { callProvider, validateGroups } from './adapters/aiProvider.js';
import { toPromptLines } from './core/sanitize.js';
import { withLock, captureSanitizedState, applyGroupDiff, rollbackLastState, listSnapshots } from './core/tabManager.js';

const DEFAULT_MODELS = { gemini: 'gemini-3.1-flash-lite', claude: 'claude-haiku-5-5', openai: 'gpt-6-luna' };

async function loadSettings() {
  const { settings = {} } = await browser.storage.local.get('settings');
  const provider = settings.provider || 'gemini';
  return {
    provider,
    apiKey: settings.keys?.[provider] || '',
    model: settings.models?.[provider] || DEFAULT_MODELS[provider],
  };
}

async function tidy(windowId) {
  const { provider, apiKey, model } = await loadSettings();
  if (!apiKey) throw new Error(`No API key set for ${provider}`);

  const t0 = performance.now();
  const state = await captureSanitizedState(windowId);
  const t1 = performance.now();
  if (state.tabs.length < 2) return { ok: true, groups: 0, tabs: 0, msg: 'Nothing to group' };

  const allowed = new Set(state.tabs.map((t) => t.id));
  const raw = await callProvider(provider, state.compressed, apiKey, model, state.existingGroups);
  const t2 = performance.now();
  const { groups, dropped } = validateGroups(raw, allowed);

  const result = await applyGroupDiff({ groups }, windowId);
  const t3 = performance.now();

  const tabsGrouped = result.applied.reduce((n, g) => n + g.count, 0);
  return {
    ok: true,
    groups: result.applied.length,
    tabs: tabsGrouped,
    dropped,
    promptTokensApprox: Math.ceil(toPromptLines(state.compressed).length / 4),
    timings: { sanitizeMs: t1 - t0, apiMs: t2 - t1, applyMs: t3 - t2, totalMs: t3 - t0 },
  };
}

browser.runtime.onMessage.addListener((msg) => {
  switch (msg?.type) {
    case 'tidy':
      return withLock(() => tidy(msg.windowId)).catch((e) => ({ ok: false, error: e.message || String(e) }));
    case 'undo':
      return withLock(() => rollbackLastState()).catch((e) => ({ ok: false, error: e.message || String(e) }));
    case 'snapshots':
      return listSnapshots();
    default:
      return undefined;
  }
});
