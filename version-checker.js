// version-checker.js
// Shared version checking utility for Chrome extensions

class VersionChecker {
  constructor(extensionName) {
    this.extensionName = extensionName;
    this.registryUrl = 'https://raw.githubusercontent.com/rickoneeleven/extension-versions/main/versions.json';
    this.lastCheckKey = `lastVersionCheck_${extensionName}`;
    this.checkIntervalHours = 24; // Check once per day
  }

  async checkVersion() {
    try {
      // Get current version from manifest
      const manifest = chrome.runtime.getManifest();
      const currentVersion = manifest.version;
      
      // Check if we need to check (rate limiting)
      if (!await this.shouldCheck()) {
        console.log(`[VersionChecker] Skipping check for ${this.extensionName} - checked recently`);
        return;
      }

      console.log(`[VersionChecker] Checking version for ${this.extensionName}, current: ${currentVersion}`);
      
      // Fetch latest versions
      const response = await fetch(this.registryUrl);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      
      const versions = await response.json();
      const latestVersion = versions[this.extensionName];
      
      if (!latestVersion) {
        console.warn(`[VersionChecker] No version info found for ${this.extensionName}`);
        return;
      }

      // Store last check time
      await this.updateLastCheckTime();
      
      // Compare versions
      if (this.isOutdated(currentVersion, latestVersion)) {
        console.warn(`[VersionChecker] ${this.extensionName} is outdated! Current: ${currentVersion}, Latest: ${latestVersion}`);
        this.showUpdateNotification(currentVersion, latestVersion);
      } else {
        console.log(`[VersionChecker] ${this.extensionName} is up to date (${currentVersion})`);
      }
      
    } catch (error) {
      console.error(`[VersionChecker] Error checking version for ${this.extensionName}:`, error);
    }
  }

  async shouldCheck() {
    const result = await chrome.storage.local.get([this.lastCheckKey]);
    const lastCheck = result[this.lastCheckKey];
    
    if (!lastCheck) return true;
    
    const hoursSinceLastCheck = (Date.now() - lastCheck) / (1000 * 60 * 60);
    return hoursSinceLastCheck >= this.checkIntervalHours;
  }

  async updateLastCheckTime() {
    await chrome.storage.local.set({
      [this.lastCheckKey]: Date.now()
    });
  }

  isOutdated(current, latest) {
    // Simple version comparison (assumes semantic versioning)
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

  showUpdateNotification(currentVersion, latestVersion) {
    // Show badge on extension icon
    chrome.action.setBadgeText({ text: '!' });
    chrome.action.setBadgeBackgroundColor({ color: '#FF0000' });
    chrome.action.setTitle({ 
      title: `${this.extensionName} update available!\nCurrent: ${currentVersion}\nLatest: ${latestVersion}` 
    });
    
    // Could also show browser notification if you add notifications permission
    console.log(`🔄 UPDATE AVAILABLE for ${this.extensionName}: ${currentVersion} → ${latestVersion}`);
  }
}

// Export for use in other files
if (typeof module !== 'undefined' && module.exports) {
  module.exports = VersionChecker;
}