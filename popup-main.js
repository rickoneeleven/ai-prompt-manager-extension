import { 
    parseDataURI, 
    base64ToBlob, 
    convertFileToBase64, 
    clearPendingImageFromBackground, 
    resetLocallyStagedImage, 
    insertImageIntoEditor, 
    processPastedImage, 
    handlePendingImageCopy 
} from './modules/image-handler.js';

import { initializeVersionStatus, updateVersionStatusDisplay } from './modules/version-status.js';

import { 
    handleSelectPrompt, 
    handleEditPrompt, 
    handleDeletePrompt, 
    handleSavePrompt, 
    handleExportPrompts, 
    handleImportPrompts, 
    handleFileImport 
} from './modules/prompt-operations.js';

import { listBackups, backupToday, backupDailyIfMissing, restoreBackup } from './modules/backup-manager.js';

document.addEventListener('DOMContentLoaded', async () => {
    if (typeof UIManager === 'undefined' || typeof UIManager.init !== 'function') {
        console.error('CRITICAL: UIManager.js is not loaded or UIManager is not defined. Aborting initialization.');
        alert('Error: UI Manager failed to load. Extension cannot start.');
        return;
    }
    UIManager.init();

    await initializeVersionStatus();

    let currentPrompts = [];
    let selectedSystemPromptText = '';
    let currentEditingId = null;
    let currentPastedImageBase64 = null; 
    let locallyStagedImage = {
        dataURI: null,
        mimeType: null,
        blob: null
    };

    const elements = UIManager.getElements();

    function escapeHtml(unsafeText) {
        const div = document.createElement('div');
        div.innerText = unsafeText;
        return div.innerHTML;
    }

    function clearUserInputFullState() {
        UIManager.clearUserInputDisplay();
        currentPastedImageBase64 = null;
        resetLocallyStagedImage(locallyStagedImage);
        UIManager.resetCopyButtonToDefault(true);
        console.log("User input area and associated image states cleared.");
    }

    async function refreshPromptListAndDynamicButtons() {
        console.log("Refreshing prompt list and dynamic buttons.");
        try {
            currentPrompts = await getAllPrompts();
            UIManager.renderPromptList(currentPrompts, 
                (id) => handleSelectPrompt(id, currentPrompts, (text) => selectedSystemPromptText = text, clearUserInputFullState, clearPendingImageFromBackground, UIManager),
                (id) => handleEditPrompt(id, currentPrompts, (id) => currentEditingId = id, clearPendingImageFromBackground, () => resetLocallyStagedImage(locallyStagedImage), (val) => currentPastedImageBase64 = val, UIManager),
                (id, title) => handleDeletePrompt(id, title, deletePrompt, clearPendingImageFromBackground, refreshPromptListAndDynamicButtons)
            );
            await updatePendingImageCopyButtonVisibility();
        } catch (error) {
            console.error("Failed to load prompts for refresh.", error.message, error.stack);
            if (elements.promptList) elements.promptList.innerHTML = '<li>Error loading prompts.</li>';
        }
    }
    
    async function updatePendingImageCopyButtonVisibility() {
        UIManager.removePendingImageCopyButton();

        try {
            console.log("Requesting pending image data from background SW for button visibility.");
            const response = await chrome.runtime.sendMessage({ action: 'retrieveImageForCopy' });
            
            if (chrome.runtime.lastError) {
                 console.error("Error sending/receiving 'retrieveImageForCopy' message:", chrome.runtime.lastError.message);
                 return;
            }

            if (response && response.success && response.data) {
                const pendingData = response.data;
                console.log("Pending image data received for button.", {title: pendingData.associatedPromptTitle });
                UIManager.showPendingImageCopyButton(pendingData, handlePendingImageCopy);
            } else {
                console.log("No valid pending image data from background SW for button.", response);
            }
        } catch (error) {
            console.error("Exception retrieving image from background SW for button visibility:", error.message, error.stack);
            if (error.message.includes("Could not establish connection") || error.message.includes("Receiving end does not exist")) {
                 console.warn("Service worker might be inactive. 'Copy Pending Image' button will not appear.");
            }
        }
    }

    async function handlePasteOnUserInput(event) {
        const clipboardData = event.clipboardData || window.clipboardData;
    
        if (!clipboardData) {
            console.warn('ClipboardData not available. Allowing default browser paste action.');
            setTimeout(() => { 
                handleUserInputOnInput();
            }, 0);
            return;
        }
    
        let imageFile = null;
        const items = clipboardData.items;
        if (items && items.length > 0) {
            for (let i = 0; i < items.length; i++) {
                if (items[i].kind === 'file' && items[i].type.startsWith('image/')) {
                    imageFile = items[i].getAsFile();
                    break;
                }
            }
        }
    
        if (imageFile) {
            console.log('Image file detected. Preventing default and handling customly.');
            event.preventDefault();
            try {
                await clearPendingImageFromBackground(); 
                resetLocallyStagedImage(locallyStagedImage);            
                currentPastedImageBase64 = null;      
                
                const existingImgElement = elements.userInput.querySelector('img');
                if (existingImgElement) {
                    console.log("Removing existing visual image before pasting new image.");
                    existingImgElement.remove();
                }
                UIManager.resetCopyButtonToDefault(true);
    
                currentPastedImageBase64 = await processPastedImage(imageFile, elements.userInput, locallyStagedImage, {
                    onImageProcessed: (dataURI) => {
                        console.log('Image processed successfully');
                    }
                });
    
            } catch (error) {
                console.error('Error during custom image paste handling:', error.message, error.stack);
                alert("An error occurred during image paste. Check console.");
            } finally {
                handleUserInputOnInput();
            }
        } else {
            console.log('No image file detected. Allowing default browser paste for text/HTML.');
            await clearPendingImageFromBackground(); 
            
            const imageWasVisuallyPresent = elements.userInput.querySelector('img');
            if (imageWasVisuallyPresent && currentPastedImageBase64) { 
                 console.log('Processed visual image was present. Clearing its state.');
                 currentPastedImageBase64 = null;
                 resetLocallyStagedImage(locallyStagedImage);
            }
    
            setTimeout(() => {
                console.log('Updating UI/internal state after paste.');
                handleUserInputOnInput(); 
            }, 0);
        }
    }

    async function handleCopyOutputClick() {
        const userHtmlContent = elements.userInput.innerHTML; 
        const userTextContent = elements.userInput.innerText.trim();
        const hasText = userTextContent.length > 0;
        const imageIsVisuallyPresent = !!elements.userInput.querySelector('img');
        const canDoAdvancedImageCopy = !!currentPastedImageBase64 && !!locallyStagedImage.blob && !!locallyStagedImage.dataURI;

        if (!hasText && !imageIsVisuallyPresent) {
            console.warn("Copy failed. No content."); return;
        }
        if (!selectedSystemPromptText) {
            console.warn("Copy failed. No system prompt selected."); return;
        }

        console.log("Initiating copy (Step 1).", { canDoAdvancedImageCopy });
        const htmlOutput = `<div><p><strong>System Prompt:</strong></p><pre style="white-space: pre-wrap; word-wrap: break-word;">${escapeHtml(selectedSystemPromptText)}</pre><hr><p><strong>User Input:</strong></p><div>${userHtmlContent}</div></div>`;
        let plainTextOutput = `[[[system prompt begin]]]\n\n${selectedSystemPromptText}\n\n[[[system prompt end]]]`;
        if (hasText) {
            plainTextOutput += `\n\n\n[[[user input text begin]]]\n\n${userTextContent}\n\n[[[user input text end]]]`;
        }
        if (imageIsVisuallyPresent) {
            plainTextOutput += `\n\n\n[[[user input]]]\n\n[Image was present. ${canDoAdvancedImageCopy ? "User pasted an image, check artifacts" : "Image not fully processed for separate copy."}]\n\n[[[user input end]]]`;
        }

        const clipboardPayload = {
            'text/html': new Blob([htmlOutput], { type: 'text/html' }),
            'text/plain': new Blob([plainTextOutput], { type: 'text/plain' })
        };

        try {
            await navigator.clipboard.write([new ClipboardItem(clipboardPayload)]);
            console.log("Step 1 (Text + Embedded/Placeholder) copied.");
            let message = 'Text Copied!';

            if (canDoAdvancedImageCopy) {
                console.log("Storing image in background for 2-step copy.", { dataURI_length: locallyStagedImage.dataURI.length });
                try {
                    const response = await chrome.runtime.sendMessage({
                        action: 'storeImageForCopy',
                        dataURI: locallyStagedImage.dataURI,
                        mimeType: locallyStagedImage.mimeType,
                        associatedPromptTitle: elements.selectedPromptTitle.textContent || "Selected Prompt"
                    });

                    if (response && response.success) {
                        console.log("Image sent to background SW.");
                        message = 'Text Copied! (Reopen for image)';
                    } else {
                        console.error("Failed to store image in background SW.", response);
                        message = "Text Copied! (Error storing image)";
                        await clearPendingImageFromBackground(); 
                    }
                } catch (error) {
                    console.error("Error sending message to background SW to store image:", error.message, error.stack);
                    message = "Text Copied! (Error contacting background)";
                    await clearPendingImageFromBackground();
                }
            } else {
                 await clearPendingImageFromBackground();
            }
            
            elements.copyOutputButton.textContent = message;
            elements.copyOutputButton.disabled = true;
            setTimeout(() => window.close(), 1500);
        } catch (error) {
            console.error('Failed to copy (Step 1 - text/html content):', error.message, error.stack);
            elements.copyOutputButton.textContent = 'Error Copying Text!';
            setTimeout(() => UIManager.resetCopyButtonToDefault(!(hasText || imageIsVisuallyPresent)), 2000);
        }
    }

    async function handleAddPromptClick() {
        console.log("Add prompt button clicked.");
        currentEditingId = null;
        UIManager.setAddEditFormValues('Add New Prompt', '', '');
        await clearPendingImageFromBackground();
        resetLocallyStagedImage(locallyStagedImage);
        currentPastedImageBase64 = null;
        UIManager.showView(UIManager.VIEWS.EDIT);
        UIManager.focusPromptTitleInput();
    }

    async function handleBackToListClick() {
        console.log("Back to list button clicked from input view.");
        selectedSystemPromptText = '';
        clearUserInputFullState();
        await clearPendingImageFromBackground();
        UIManager.showView(UIManager.VIEWS.LIST);
        await updatePendingImageCopyButtonVisibility();
    }

    async function handleCancelAddEditClick() {
        console.log("Cancel add/edit button clicked.");
        currentEditingId = null;
        await clearPendingImageFromBackground();
        resetLocallyStagedImage(locallyStagedImage);
        currentPastedImageBase64 = null;
        UIManager.showView(UIManager.VIEWS.LIST);
        await updatePendingImageCopyButtonVisibility();
    }

    function handleUserInputOnInput() {
        const editorText = elements.userInput.innerText;
        const hasText = editorText.trim().length > 0;
        const imageElementInEditor = elements.userInput.querySelector('img');

        if (!imageElementInEditor && currentPastedImageBase64) {
            console.log('Image element visually removed from editor. Clearing associated advanced copy data.');
            currentPastedImageBase64 = null;
            resetLocallyStagedImage(locallyStagedImage);
        }
        UIManager.resetCopyButtonToDefault(!(hasText || imageElementInEditor));
    }

    async function initializePopup() {
        console.log("Initializing.");

        if (elements.addPromptButton) elements.addPromptButton.addEventListener('click', handleAddPromptClick);
        if (elements.backToListButton) elements.backToListButton.addEventListener('click', handleBackToListClick);
        if (elements.cancelAddEditButton) elements.cancelAddEditButton.addEventListener('click', handleCancelAddEditClick);
        if (elements.copyOutputButton) elements.copyOutputButton.addEventListener('click', handleCopyOutputClick);
        if (elements.userInput) {
            elements.userInput.addEventListener('input', handleUserInputOnInput);
            elements.userInput.addEventListener('paste', handlePasteOnUserInput);
        }
        if (elements.savePromptButton) elements.savePromptButton.addEventListener('click', async () => {
            currentEditingId = await handleSavePrompt(elements, currentEditingId, savePrompt, refreshPromptListAndDynamicButtons, UIManager);
            try {
                await backupToday(currentPrompts);
                console.log('Local backup updated for today after save.');
            } catch (err) {
                console.warn('Failed to create local backup after save:', err);
            }
        });
        
        if (elements.exportPromptsButton) elements.exportPromptsButton.addEventListener('click', () => handleExportPrompts(getAllPrompts));
        if (elements.importPromptsButton) elements.importPromptsButton.addEventListener('click', () => handleImportPrompts(elements));
        if (elements.importFileInput) elements.importFileInput.addEventListener('change', (event) => handleFileImport(event, getAllPrompts, savePrompt, refreshPromptListAndDynamicButtons, elements));

        if (elements.backupNowButton) elements.backupNowButton.addEventListener('click', async () => {
            try {
                const res = await backupToday(currentPrompts);
                alert(`Backup saved (${res.count} prompts).`);
            } catch (e) {
                console.error('Backup failed:', e);
                alert(`Backup failed: ${e.message}`);
            }
        });

        if (elements.restoreBackupButton) elements.restoreBackupButton.addEventListener('click', async () => {
            try {
                const backups = await listBackups();
                if (!backups.length) { alert('No local backups found.'); return; }
                const lines = backups.map((b, i) => {
                    const date = b.key.replace('prompt_backup_', '');
                    return `${i + 1}. ${date} — ${b.count} prompts`;
                }).join('\n');
                const input = prompt(`Select a backup to restore by number:\n\n${lines}`);
                if (!input) return;
                const index = parseInt(input, 10) - 1;
                if (!(index >= 0 && index < backups.length)) { alert('Invalid selection.'); return; }
                const chosen = backups[index];
                const result = await restoreBackup(chosen.key);
                if (result && result.cancelled) return;
                await refreshPromptListAndDynamicButtons();
                alert(`Restore complete. Saved: ${result.saved}, Failed: ${result.failed}`);
            } catch (e) {
                console.error('Restore failed:', e);
                alert(`Restore failed: ${e.message}`);
            }
        });

        // Clean up any inconsistent storage left from past quota failures
        if (typeof autoCleanupInconsistentStorage === 'function') {
            try { await autoCleanupInconsistentStorage(); } catch (e) { console.warn('Auto-cleanup failed at init:', e); }
        }

        await refreshPromptListAndDynamicButtons();
        try {
            await backupDailyIfMissing(currentPrompts);
        } catch (e) {
            console.warn('Daily backup check failed:', e);
        }
        UIManager.showView(UIManager.VIEWS.LIST);
        console.log("Initialization complete.");
    }

    initializePopup().catch(err => {
        console.error("Uncaught error during initialization:", err.message, err.stack);
        alert("A critical error occurred during popup initialization. Please check the console.");
    });
});
