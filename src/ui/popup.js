const $ = (id) => document.getElementById(id);
const DEFAULTS = { gemini: 'gemini-3.1-flash-lite', claude: 'claude-haiku-5-5', openai: 'gpt-6-luna' };
const statusEl = $('status');

function setStatus(text, isErr = false) {
  statusEl.textContent = text;
  statusEl.classList.toggle('err', isErr);
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
  $('provider').value = p;
  $('key').value = s.keys?.[p] || '';
  $('model').value = s.models?.[p] || '';
  $('model').placeholder = DEFAULTS[p];
}

$('provider').addEventListener('change', async (e) => {
  await saveSettings({ provider: e.target.value });
  await refreshFields();
});

$('key').addEventListener('change', async (e) => {
  const s = await loadSettings();
  const p = s.provider || 'gemini';
  await saveSettings({ keys: { ...(s.keys || {}), [p]: e.target.value.trim() } });
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
  setBusy(true);
  setStatus('Working…');
  try {
    const win = await browser.windows.getCurrent();
    const r = await browser.runtime.sendMessage({ type: 'tidy', windowId: win.id });
    if (!r?.ok) return setStatus(r?.error || 'Failed', true);
    if (!r.groups) return setStatus(r.msg || 'No groups created');
    const t = r.timings;
    setStatus(
      `${r.groups} groups, ${r.tabs} tabs${r.dropped ? `, ${r.dropped} invalid IDs dropped` : ''}\n` +
      `sanitize ${t.sanitizeMs.toFixed(0)}ms · api ${t.apiMs.toFixed(0)}ms · apply ${t.applyMs.toFixed(0)}ms`
    );
  } catch (e) {
    setStatus(e.message || String(e), true);
  } finally {
    setBusy(false);
  }
});

$('undo').addEventListener('click', async () => {
  setBusy(true);
  try {
    const r = await browser.runtime.sendMessage({ type: 'undo' });
    if (!r?.ok) return setStatus(r?.error || r?.reason || 'Nothing to undo', true);
    setStatus(r.restored ? 'Restored previous layout' : (r.reason || 'Nothing to undo'), !r.restored);
  } catch (e) {
    setStatus(e.message || String(e), true);
  } finally {
    setBusy(false);
  }
});

refreshFields();
