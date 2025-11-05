// modules/backup-manager.js

/**
 * Local backup manager for prompts using chrome.storage.local.
 * - Keeps up to MAX_BACKUPS daily snapshots (rolling window)
 * - Stores simplified prompt objects: {id, title, text}
 */

const BACKUP_INDEX_KEY = 'prompt_backups_index';
const BACKUP_PREFIX = 'prompt_backup_'; // e.g., prompt_backup_2025-11-05
const MAX_BACKUPS = 7; // keep last 7 days

function todayKey() {
    const d = new Date();
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${BACKUP_PREFIX}${yyyy}-${mm}-${dd}`;
}

async function readIndex() {
    const { [BACKUP_INDEX_KEY]: idx } = await chrome.storage.local.get([BACKUP_INDEX_KEY]);
    return Array.isArray(idx) ? idx : [];
}

async function writeIndex(index) {
    await chrome.storage.local.set({ [BACKUP_INDEX_KEY]: index });
}

function simplifyPrompts(prompts) {
    return (Array.isArray(prompts) ? prompts : []).map(p => ({ id: p.id, title: p.title, text: p.text }));
}

async function pruneOldBackups(index) {
    const sorted = [...index].sort((a, b) => b.timestamp - a.timestamp);
    if (sorted.length <= MAX_BACKUPS) return index; // nothing to prune

    const keep = sorted.slice(0, MAX_BACKUPS);
    const remove = sorted.slice(MAX_BACKUPS);
    const keysToRemove = remove.map(r => r.key);
    if (keysToRemove.length) {
        await chrome.storage.local.remove(keysToRemove);
    }
    return keep.sort((a, b) => a.timestamp - b.timestamp); // normalized ascending by time
}

export async function listBackups() {
    const index = await readIndex();
    // return newest first for UI
    return index.slice().sort((a, b) => b.timestamp - a.timestamp);
}

export async function backupToday(prompts) {
    const key = todayKey();
    const snapshot = simplifyPrompts(prompts);
    const timestamp = Date.now();

    // Write the snapshot first
    await chrome.storage.local.set({ [key]: snapshot });

    // Update index
    let index = await readIndex();
    const existing = index.find(e => e.key === key);
    if (existing) {
        existing.timestamp = timestamp;
        existing.count = snapshot.length;
    } else {
        index.push({ key, timestamp, count: snapshot.length });
    }
    index = await pruneOldBackups(index);
    await writeIndex(index);

    return { key, count: snapshot.length };
}

export async function backupDailyIfMissing(prompts) {
    const key = todayKey();
    const index = await readIndex();
    if (index.some(e => e.key === key)) return { skipped: true };
    return backupToday(prompts);
}

export async function restoreBackup(key, { onProgress } = {}) {
    const data = await chrome.storage.local.get([key]);
    const snapshot = Array.isArray(data[key]) ? data[key] : null;
    if (!snapshot) throw new Error('Selected backup not found.');

    // Fetch current prompts to remove
    const current = (typeof getAllPrompts === 'function') ? await getAllPrompts() : [];

    // Confirm destructive action
    const proceed = confirm(`Restore ${snapshot.length} prompts from backup? This will replace your current ${current.length} prompts.`);
    if (!proceed) return { cancelled: true };

    // Delete existing prompts
    for (const p of current) {
        try {
            if (typeof deletePrompt === 'function') {
                await deletePrompt(p.id);
            }
        } catch (e) {
            console.error('Failed to delete prompt during restore:', p.title, e);
        }
    }

    // Save backed up prompts
    let saved = 0; let failed = 0;
    for (const p of snapshot) {
        try {
            if (typeof savePrompt === 'function') {
                await savePrompt(p);
                saved++;
                if (onProgress) onProgress(saved, snapshot.length);
            }
        } catch (e) {
            console.error('Failed to restore prompt:', p.title, e);
            failed++;
        }
    }

    return { saved, failed, total: snapshot.length };
}

