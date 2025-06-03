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
      
      console.log(`[VersionChecker DEBUG] Starting version check for ${this.extensionName}`);
      console.log(`[VersionChecker DEBUG] Current version: ${currentVersion}`);
      console.log(`[VersionChecker DEBUG] Registry URL: ${this.registryUrl}`);
      
      // Check if we need to check (rate limiting)
      if (!await this.shouldCheck()) {
        console.log(`[VersionChecker] Skipping check for ${this.extensionName} - checked recently`);
        return;
      }

      console.log(`[VersionChecker] Checking version for ${this.extensionName}, current: ${currentVersion}`);
      console.log(`[VersionChecker DEBUG] About to fetch from: ${this.registryUrl}`);
      
      // Fetch latest versions
      const response = await fetch(this.registryUrl);
      console.log(`[VersionChecker DEBUG] Fetch response status: ${response.status}`);
      console.log(`[VersionChecker DEBUG] Fetch response ok: ${response.ok}`);
      console.log(`[VersionChecker DEBUG] Fetch response headers:`, [...response.headers.entries()]);
      
      if (!response.ok) {
        console.error(`[VersionChecker DEBUG] Response not ok. Status: ${response.status}, StatusText: ${response.statusText}`);
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      
      const responseText = await response.text();
      console.log(`[VersionChecker DEBUG] Raw response text: "${responseText}"`);
      
      const versions = JSON.parse(responseText);
      console.log(`[VersionChecker DEBUG] Parsed versions object:`, versions);
      
      const latestVersion = versions[this.extensionName];
      console.log(`[VersionChecker DEBUG] Latest version for ${this.extensionName}: ${latestVersion}`);
      
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
      console.error(`[VersionChecker DEBUG] Error type: ${error.constructor.name}`);
      console.error(`[VersionChecker DEBUG] Error message: ${error.message}`);
      console.error(`[VersionChecker DEBUG] Error stack:`, error.stack);
      
      // Additional debugging for fetch errors
      if (error.name === 'TypeError' && error.message.includes('fetch')) {
        console.error(`[VersionChecker DEBUG] This looks like a network/CORS/permissions error`);
        console.error(`[VersionChecker DEBUG] Check that host_permissions includes: https://raw.githubusercontent.com/*`);
      }
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

  // Manual trigger for testing (bypasses rate limiting)
  async forceCheckVersion() {
    console.log(`[VersionChecker DEBUG] FORCE CHECK triggered for ${this.extensionName}`);
    const originalCheckInterval = this.checkIntervalHours;
    this.checkIntervalHours = 0; // Bypass rate limiting
    await this.checkVersion();
    this.checkIntervalHours = originalCheckInterval; // Restore original interval
  }
}

// Export for use in other files
if (typeof module !== 'undefined' && module.exports) {
  module.exports = VersionChecker;
}

// Global test function for console debugging
window.testVersionChecker = function() {
  console.log('[DEBUG] Manual version check triggered from console');
  const versionChecker = new VersionChecker('ai-prompt-manager');
  versionChecker.forceCheckVersion();
};