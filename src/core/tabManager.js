// Browser-side state machine: sanitized capture, atomic group application, FIFO snapshots, rollback.
// Requires the `browser` global (Firefox/Zen WebExtension APIs).
import { compressTabs, selectEligibleTabs } from './sanitize.js';

export const RING_SIZE = 10;
const SNAP_KEY = 'snapshots';

let chain = Promise.resolve();
// Serializes all mutating operations so overlapping popup clicks cannot interleave tab moves.
export function withLock(fn) {
  const run = chain.then(fn, fn);
  chain = run.catch(() => {});
  return run;
}

export async function captureSanitizedState(windowId) {
  const tabs = await browser.tabs.query({ windowId });
  const eligible = selectEligibleTabs(tabs);
  const groups = await browser.tabGroups.query({ windowId });
  return {
    windowId,
    tabs: eligible,
    compressed: compressTabs(eligible),
    existingGroups: groups.map((g) => ({ id: g.id, name: g.title || '', color: g.color })),
  };
}

async function readRing() {
  const { [SNAP_KEY]: ring = [] } = await browser.storage.local.get(SNAP_KEY);
  return ring;
}

async function writeRing(ring) {
  await browser.storage.local.set({ [SNAP_KEY]: ring.slice(-RING_SIZE) });
}

// Records window-wide layout: index, group membership, and group metadata.
export async function captureSnapshot(windowId) {
  const tabs = await browser.tabs.query({ windowId });
  const groups = await browser.tabGroups.query({ windowId });
  const snapshot = {
    ts: Date.now(),
    windowId,
    tabs: tabs.map((t) => ({ id: t.id, index: t.index, groupId: t.groupId ?? -1, pinned: t.pinned })),
    groups: groups.map((g) => ({ id: g.id, title: g.title || '', color: g.color, collapsed: g.collapsed })),
  };
  const ring = await readRing();
  ring.push(snapshot);
  await writeRing(ring);
  return snapshot;
}

export async function listSnapshots() {
  return (await readRing()).map((s) => ({ ts: s.ts, windowId: s.windowId, tabs: s.tabs.length }));
}

// Applies { groups: [{name, color, tabIds}] } to the window. Snapshot first; auto-restore on failure.
export async function applyGroupDiff(diff, windowId) {
  const snapshot = await captureSnapshot(windowId);
  const liveTabs = new Map((await browser.tabs.query({ windowId })).map((t) => [t.id, t]));
  const groupsNow = await browser.tabGroups.query({ windowId });
  const applied = [];
  try {
    for (const g of diff.groups) {
      // Re-validate against live state: tab may have closed, moved, or been grouped since capture.
      const tabIds = g.tabIds.filter((id) => {
        const t = liveTabs.get(id);
        return t && !t.pinned && (t.groupId === -1 || t.groupId == null);
      });
      if (tabIds.length < 2) continue;

      const existing = groupsNow.find((x) => (x.title || '').toLowerCase() === g.name.toLowerCase());
      const groupId = existing
        ? await browser.tabs.group({ tabIds, groupId: existing.id })
        : await browser.tabs.group({ tabIds, createProperties: { windowId } });
      await browser.tabGroups.update(groupId, { title: g.name, color: g.color, collapsed: false });
      if (!existing) groupsNow.push({ id: groupId, title: g.name });
      applied.push({ groupId, count: tabIds.length });
    }
    return { snapshotTs: snapshot.ts, applied };
  } catch (err) {
    await restoreSnapshot(snapshot).catch(() => {});
    throw err;
  }
}

async function restoreSnapshot(snap) {
  const liveTabs = await browser.tabs.query({ windowId: snap.windowId });
  const liveIds = new Set(liveTabs.map((t) => t.id));
  const liveGroupsById = new Set((await browser.tabGroups.query({ windowId: snap.windowId })).map((g) => g.id));
  const relevant = snap.tabs.filter((t) => liveIds.has(t.id));

  // 1. Ungroup tabs that were ungrouped at snapshot time but are grouped now.
  const toUngroup = relevant
    .filter((t) => t.groupId === -1)
    .map((t) => liveTabs.find((x) => x.id === t.id))
    .filter((t) => t && t.groupId !== -1 && typeof browser.tabs.ungroup === 'function')
    .map((t) => t.id);
  if (toUngroup.length) await browser.tabs.ungroup(toUngroup);

  // 2. Restore group membership and metadata per original group.
  const byGroup = new Map();
  for (const t of relevant) {
    if (t.groupId === -1) continue;
    if (!byGroup.has(t.groupId)) byGroup.set(t.groupId, []);
    byGroup.get(t.groupId).push(t.id);
  }
  for (const [origGroupId, ids] of byGroup) {
    const meta = snap.groups.find((g) => g.id === origGroupId) || {};
    const target = liveGroupsById.has(origGroupId)
      ? await browser.tabs.group({ tabIds: ids, groupId: origGroupId })
      : await browser.tabs.group({ tabIds: ids, createProperties: { windowId: snap.windowId } });
    await browser.tabGroups.update(target, { title: meta.title || '', color: meta.color, collapsed: !!meta.collapsed });
  }

  // 3. Restore indexes in ascending order (best-effort; closed/pinned edge cases skipped).
  for (const t of [...relevant].sort((a, b) => a.index - b.index)) {
    try {
      await browser.tabs.move(t.id, { index: t.index, windowId: snap.windowId });
    } catch {
      /* tab closed mid-restore or index constrained by pinned tabs */
    }
  }
}

// Pops newest snapshot and restores it. FIFO ring: restoring removes that entry.
export async function rollbackLastState() {
  const ring = await readRing();
  const snap = ring.pop();
  if (!snap) return { restored: false, reason: 'no snapshots' };
  await writeRing(ring);
  await restoreSnapshot(snap);
  return { restored: true, ts: snap.ts };
}
