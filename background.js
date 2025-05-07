// background.js
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

// Optional: Log when the service worker starts (e.g., on install/update or wake)
chrome.runtime.onStartup.addListener(() => {
  console.log('[BackgroundSW] Service worker started (onStartup).');
});

chrome.runtime.onInstalled.addListener((details) => {
  console.log('[BackgroundSW] Service worker installed or updated:', details.reason);
});