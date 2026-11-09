// Pure ESM, no browser globals (shared with bench/).

const AFFIX = /\s[-|–—·•:]\s(?:[^-|–—·•:]{1,40})$/;
const MAX_TITLE = 80;

export function cleanDomain(url) {
  try {
    const u = new URL(url);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return u.protocol.replace(':', '');
    return u.hostname.replace(/^(www\d?|m|mobile|amp)\./, '');
  } catch {
    return 'local';
  }
}

export function cleanTitle(title, domain) {
  let t = (title || '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
  // Drop trailing " - Site Name" affixes when the affix is the site itself.
  const base = domain.split('.')[0].toLowerCase();
  for (let i = 0; i < 2; i++) {
    const m = t.match(AFFIX);
    if (!m) break;
    const tail = m[0].slice(3).toLowerCase();
    if (tail.includes(base) || tail.length <= 14) t = t.slice(0, m.index).trim();
    else break;
  }
  if (t.length > MAX_TITLE) t = t.slice(0, MAX_TITLE - 1) + '…';
  return t || domain;
}

// Converts browser tab objects into the dense prompt representation: [ID | domain | title]
export function compressTabs(tabs) {
  return tabs.map((t) => {
    const domain = cleanDomain(t.url);
    return { id: t.id, domain, title: cleanTitle(t.title, domain) };
  });
}

export function toPromptLines(compressed) {
  return compressed.map((t) => `[${t.id} | ${t.domain} | ${t.title}]`).join('\n');
}

// Eligible: not pinned, not hidden, not in a non-default container, not already grouped (unless includeGrouped).
export function selectEligibleTabs(tabs, { includeGrouped = false } = {}) {
  return tabs.filter((t) =>
    !t.pinned &&
    !t.hidden &&
    (!t.cookieStoreId || t.cookieStoreId === 'firefox-default') &&
    (t.url && /^(https?:|file:)/.test(t.url)) &&
    (includeGrouped || t.groupId === -1 || t.groupId == null)
  );
}
