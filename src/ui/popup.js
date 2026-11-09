const $ = (id) => document.getElementById(id);
const DEFAULTS = { gemini: 'gemini-3.1-flash-lite', claude: 'claude-haiku-5-5', openai: 'gpt-6-luna' };
const statusEl = $('status');

// state: '' | 'ok' | 'err' | 'busy' (true is accepted as 'err')
function setStatus(text, state = '') {
  statusEl.textContent = text;
  statusEl.dataset.state = state === true ? 'err' : state;
}

async function loadSettings() {
  const { settings = {} } = await browser.storage.local.get('settings');
  return settings;
}

async function saveSettings(patch) {
  const s = await loadSettings();
  const next = { ...s, ...patch };
  await browser.storage.local.set({ settings: next });
  return next;
}

async function refreshFields() {
  const s = await loadSettings();
  const p = s.provider || 'gemini';
  const isClaude = p === 'claude';
  const oauthOn = isClaude && s.claudeAuth === 'oauth';
  $('provider').value = p;
  $('key').value = oauthOn ? '' : s.keys?.[p] || '';
  $('key').placeholder = oauthOn ? 'OAuth token saved (paste to replace)' : 'API key';
  $('model').value = s.models?.[p] || '';
  $('model').placeholder = DEFAULTS[p];
  const isLocal = p === 'local';
  $('keyField').hidden = isLocal;
  $('modelField').hidden = isLocal;
  $('oauthRow').hidden = !isClaude;
  $('oauthToggle').checked = oauthOn;
  const info = $('oauthInfo');
  info.hidden = !oauthOn;
  if (oauthOn) {
    const exp = s.oauth?.expiresAt;
    info.textContent = exp
      ? `OAuth token expires ${new Date(exp).toLocaleString()}`
      : 'OAuth token saved (no expiry recorded)';
  }
}

// Accepts either the raw accessToken or the full ~/.claude/.credentials.json (same as jobby's paste flow).
function parseOauthPaste(text) {
  try {
    const parsed = JSON.parse(text);
    const o = parsed?.claudeAiOauth ?? parsed?.oauth;
    if (o?.accessToken) return { accessToken: o.accessToken.trim(), expiresAt: o.expiresAt ?? null };
  } catch {
    /* not JSON: treat as raw token */
  }
  return null;
}

$('provider').addEventListener('change', async (e) => {
  await saveSettings({ provider: e.target.value });
  await refreshFields();
});

$('key').addEventListener('change', async (e) => {
  const s = await loadSettings();
  const p = s.provider || 'gemini';
  const value = e.target.value.trim();
  if (!value) return;
  if (p === 'claude') {
    const oauth = parseOauthPaste(value);
    if (oauth) {
      await saveSettings({ claudeAuth: 'oauth', oauth });
      setStatus('Claude OAuth token saved');
      return refreshFields();
    }
    if ($('oauthToggle').checked) {
      await saveSettings({ claudeAuth: 'oauth', oauth: { accessToken: value, expiresAt: null } });
      return refreshFields();
    }
    await saveSettings({ claudeAuth: 'apikey', keys: { ...(s.keys || {}), claude: value } });
    return refreshFields();
  }
  await saveSettings({ keys: { ...(s.keys || {}), [p]: value } });
});

$('oauthToggle').addEventListener('change', async (e) => {
  await saveSettings({ claudeAuth: e.target.checked ? 'oauth' : 'apikey' });
  await refreshFields();
});

$('model').addEventListener('change', async (e) => {
  const s = await loadSettings();
  const p = s.provider || 'gemini';
  await saveSettings({ models: { ...(s.models || {}), [p]: e.target.value.trim() } });
});

function setBusy(busy) {
  $('tidy').disabled = busy;
  $('undo').disabled = busy;
}

$('tidy').addEventListener('click', async () => {
  const s = await loadSettings();
  if ((s.provider || 'gemini') === 'local') {
    // Must run in the click's user gesture; optional permission gates the trial API.
    if (typeof browser.trial?.ml?.createEngine !== 'function') {
      return setStatus(
        'Firefox on-device AI not available. Set browser.ml.enable and extensions.ml.enabled to true in about:config, then restart.',
        'err'
      );
    }
    const granted = await browser.permissions.request({ permissions: ['trialML'] });
    if (!granted) return setStatus('Permission trialML was not granted', 'err');
  }
  setBusy(true);
  setStatus('Grouping tabs…', 'busy');
  try {
    const win = await browser.windows.getCurrent();
    const r = await browser.runtime.sendMessage({ type: 'tidy', windowId: win.id });
    if (!r?.ok) return setStatus(r?.error || 'Failed', 'err');
    if (!r.groups) return setStatus(r.msg || 'No groups created');
    const t = r.timings;
    setStatus(
      `Created ${r.groups} group${r.groups === 1 ? '' : 's'} · ${r.tabs} tabs` +
      (r.dropped ? ` · ${r.dropped} invalid IDs dropped` : '') + '\n' +
      `sanitize ${t.sanitizeMs.toFixed(0)} ms · API ${t.apiMs.toFixed(0)} ms · apply ${t.applyMs.toFixed(0)} ms`,
      'ok'
    );
  } catch (e) {
    setStatus(e.message || String(e), 'err');
  } finally {
    setBusy(false);
  }
});

$('undo').addEventListener('click', async () => {
  setBusy(true);
  try {
    const r = await browser.runtime.sendMessage({ type: 'undo' });
    if (!r?.ok) return setStatus(r?.error || r?.reason || 'Nothing to undo', 'err');
    setStatus(r.restored ? 'Restored previous layout' : (r.reason || 'Nothing to undo'), r.restored ? 'ok' : 'err');
  } catch (e) {
    setStatus(e.message || String(e), 'err');
  } finally {
    setBusy(false);
  }
});

refreshFields();
