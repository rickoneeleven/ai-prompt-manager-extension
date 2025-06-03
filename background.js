// Import version checker
importScripts('version-checker.js');

// Initialize version checker
const versionChecker = new VersionChecker('ai-prompt-manager');
console.log('[BackgroundSW DEBUG] Version checker initialized');

// Check version on startup/install
chrome.runtime.onStartup.addListener(() => {
  console.log('[BackgroundSW] Service worker started (onStartup).');
  console.log('[BackgroundSW DEBUG] Triggering version check from onStartup');
  versionChecker.forceCheckVersion();
});

chrome.runtime.onInstalled.addListener((details) => {
  console.log('[BackgroundSW] Service worker installed or updated:', details.reason);
  console.log('[BackgroundSW DEBUG] Triggering version check from onInstalled');
  versionChecker.forceCheckVersion();
});

let pendingImageForCopy = null;

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  console.log('[BackgroundSW] Received message:', request.action);

  if (request.action === 'storeImageForCopy') {
    pendingImageForCopy = {
      dataURI: request.dataURI,
      mimeType: request.mimeType,
      associatedPromptTitle: request.associatedPromptTitle,
      timestamp: Date.now() // Optional: for potential future cleanup logic
    };
    console.log('[BackgroundSW] Image stored:', { title: pendingImageForCopy.associatedPromptTitle, dataURI_length: pendingImageForCopy.dataURI.length });
    sendResponse({ success: true, message: 'Image stored in background.' });
    return true; // Indicates you wish to send a response asynchronously (or synchronously)
  } 
  
  else if (request.action === 'retrieveImageForCopy') {
    if (pendingImageForCopy) {
      console.log('[BackgroundSW] Retrieving stored image:', { title: pendingImageForCopy.associatedPromptTitle });
      sendResponse({ success: true, data: pendingImageForCopy });
    } else {
      console.log('[BackgroundSW] No image found to retrieve.');
      sendResponse({ success: false, message: 'No image stored.' });
    }
    return true; 
  } 
  
  else if (request.action === 'clearStoredImage') {
    pendingImageForCopy = null;
    console.log('[BackgroundSW] Stored image cleared.');
    sendResponse({ success: true, message: 'Stored image cleared.' });
    return true;
  }
  
  // Fallback for unknown actions
  sendResponse({ success: false, message: 'Unknown action.' });
  return true; 
});