import { initVersionChecker, checkForUpdates } from './common/version-checker.js';

console.log('Background service worker starting...');

initVersionChecker().then(() => {
    console.log('Version checker initialized');
}).catch(error => {
    console.error('Failed to initialize version checker:', error);
});

chrome.runtime.onInstalled.addListener((details) => {
    console.log('Extension installed/updated', details);
});

chrome.runtime.onStartup.addListener(() => {
    console.log('Browser started');
});

let pendingImageForCopy = null;

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    console.log('Background received message:', request.action);

    if (request.action === 'storeImageForCopy') {
        pendingImageForCopy = {
            dataURI: request.dataURI,
            mimeType: request.mimeType,
            associatedPromptTitle: request.associatedPromptTitle,
            timestamp: Date.now()
        };
        console.log('Image stored:', { title: pendingImageForCopy.associatedPromptTitle, dataURI_length: pendingImageForCopy.dataURI.length });
        sendResponse({ success: true, message: 'Image stored in background.' });
        return true;
    } 
    
    else if (request.action === 'retrieveImageForCopy') {
        if (pendingImageForCopy) {
            console.log('Retrieving stored image:', { title: pendingImageForCopy.associatedPromptTitle });
            sendResponse({ success: true, data: pendingImageForCopy });
        } else {
            console.log('No image found to retrieve.');
            sendResponse({ success: false, message: 'No image stored.' });
        }
        return true; 
    } 
    
    else if (request.action === 'clearStoredImage') {
        pendingImageForCopy = null;
        console.log('Stored image cleared.');
        sendResponse({ success: true, message: 'Stored image cleared.' });
        return true;
    }
    
    else if (request.action === 'forceVersionCheck') {
        checkForUpdates(true).then(() => {
            console.log('Forced version check completed');
            sendResponse({ success: true });
        }).catch(error => {
            console.error('Forced version check failed:', error);
            sendResponse({ success: false, error: error.message });
        });
        return true;
    }
    
    sendResponse({ success: false, message: 'Unknown action.' });
    return true; 
});
