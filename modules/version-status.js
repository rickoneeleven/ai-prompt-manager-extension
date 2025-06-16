import { checkForUpdates } from '../common/version-checker.js';

export async function initializeVersionStatus() {
    console.log('Checking if auto-check needed on popup open');
    
    const lastCheckTime = await getLastCheckTime();
    const CHECK_INTERVAL_MS = 1000 * 60 * 60 * 24; // 24 hours
    const now = Date.now();
    
    if ((now - lastCheckTime) >= CHECK_INTERVAL_MS) {
        console.log('Auto-triggering version check (>24 hours since last check)');
        await checkForUpdates(true);
    } else {
        console.log('Skipping auto-check (checked recently)');
    }
    
    const checkVersionBtn = document.getElementById('check-version-btn');
    if (checkVersionBtn) {
        checkVersionBtn.addEventListener('click', async () => {
            checkVersionBtn.disabled = true;
            checkVersionBtn.textContent = 'Checking...';
            
            await checkForUpdates(true);
            await updateVersionStatusDisplay();
            
            checkVersionBtn.disabled = false;
            checkVersionBtn.textContent = 'Check';
        });
    }
    
    await updateVersionStatusDisplay();
    setInterval(updateVersionStatusDisplay, 30000);
}

export async function updateVersionStatusDisplay() {
    const status = await getVersionStatus();
    
    const currentVersionEl = document.getElementById('current-version');
    if (currentVersionEl) currentVersionEl.textContent = status.currentVersion;
    
    const latestVersionEl = document.getElementById('latest-version');
    if (latestVersionEl) latestVersionEl.textContent = status.latestVersion;
    
    const lastCheckedEl = document.getElementById('last-checked');
    if (lastCheckedEl) lastCheckedEl.textContent = status.lastCheckedText;
    
    const statusBar = document.getElementById('version-status-bar');
    if (statusBar) {
        if (status.isOutdated) {
            statusBar.style.borderLeftColor = '#ff6b6b';
            statusBar.style.backgroundColor = '#ffe0e0';
        } else if (status.latestVersion !== 'Unknown') {
            statusBar.style.borderLeftColor = '#4CAF50';
            statusBar.style.backgroundColor = '#f0f8f0';
        } else {
            statusBar.style.borderLeftColor = '#ccc';
            statusBar.style.backgroundColor = '#f5f5f5';
        }
    }
}

async function getLastCheckTime() {
    const result = await chrome.storage.local.get(['lastVersionCheck']);
    return result.lastVersionCheck || 0;
}

async function getVersionStatus() {
    const manifest = chrome.runtime.getManifest();
    const currentVersion = manifest.version;
    
    const result = await chrome.storage.local.get([
        'lastVersionCheck',
        'latestVersion'
    ]);
    
    const lastCheckTime = result.lastVersionCheck;
    const latestVersion = result.latestVersion || 'Unknown';
    
    let lastCheckedText = 'Never';
    if (lastCheckTime) {
        const now = new Date();
        const checkTime = new Date(lastCheckTime);
        const diffMinutes = Math.floor((now - checkTime) / (1000 * 60));
        
        if (diffMinutes < 1) {
            lastCheckedText = 'Just now';
        } else if (diffMinutes < 60) {
            lastCheckedText = `${diffMinutes}m ago`;
        } else if (diffMinutes < 1440) {
            const hours = Math.floor(diffMinutes / 60);
            lastCheckedText = `${hours}h ago`;
        } else {
            const days = Math.floor(diffMinutes / 1440);
            lastCheckedText = `${days}d ago`;
        }
    }
    
    const isOutdated = latestVersion !== 'Unknown' && isVersionOutdated(currentVersion, latestVersion);
    
    return {
        currentVersion,
        latestVersion,
        lastCheckedText,
        isOutdated,
        lastCheckTime
    };
}

function isVersionOutdated(current, latest) {
    if (isTimestampVersion(current) || isTimestampVersion(latest)) {
        return current !== latest && latest > current;
    }
    
    const currentParts = current.split('.').map(Number);
    const latestParts = latest.split('.').map(Number);
    
    for (let i = 0; i < Math.max(currentParts.length, latestParts.length); i++) {
        const currentPart = currentParts[i] || 0;
        const latestPart = latestParts[i] || 0;
        
        if (latestPart > currentPart) return true;
        if (latestPart < currentPart) return false;
    }
    
    return false;
}

function isTimestampVersion(version) {
    return /^\d{2}\.\d{2}\.\d{2}\.\d{4}$/.test(version);
}
