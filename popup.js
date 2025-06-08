// popup.js
document.addEventListener('DOMContentLoaded', async () => {
    // Ensure UIManager is available and initialized
    if (typeof UIManager === 'undefined' || typeof UIManager.init !== 'function') {
        console.error('[Popup] CRITICAL: UIManager.js is not loaded or UIManager is not defined. Aborting initialization.');
        alert('Error: UI Manager failed to load. Extension cannot start.');
        return;
    }
    UIManager.init(); // Initialize UIManager to cache DOM elements

    // Initialize version status display
    await initializeVersionStatus();

    // Local state variables
    let currentPrompts = [];
    let selectedSystemPromptText = '';
    let currentEditingId = null;
    
    let currentPastedImageBase64 = null; 
    let locallyStagedImage = {
        dataURI: null,
        mimeType: null,
        blob: null
    };

    // Get cached DOM elements from UIManager
    const elements = UIManager.getElements();

    // --- Utility Functions (can be further modularized later if needed) ---

    function parseDataURI(dataURI) {
        if (!dataURI || !dataURI.startsWith('data:')) {
            logger.warn('Popup: Invalid data URI for parsing.', dataURI ? dataURI.substring(0, 40) + '...' : 'undefined');
            return null;
        }
        const commaIndex = dataURI.indexOf(',');
        if (commaIndex === -1) {
            logger.warn('Popup: Malformed data URI, missing comma.', dataURI.substring(0, 40) + '...');
            return null;
        }
        const header = dataURI.substring(0, commaIndex);
        const base64Data = dataURI.substring(commaIndex + 1);
        const mimeMatch = header.match(/:(.*?);/);
        if (!mimeMatch || !mimeMatch[1]) {
            logger.warn('Popup: Could not extract MIME type from data URI header.', header);
            return null;
        }
        return { mimeType: mimeMatch[1], base64Data };
    }

    function base64ToBlob(base64, type = 'application/octet-stream') {
        try {
            const byteCharacters = atob(base64);
            const byteNumbers = new Array(byteCharacters.length);
            for (let i = 0; i < byteCharacters.length; i++) {
                byteNumbers[i] = byteCharacters.charCodeAt(i);
            }
            const byteArray = new Uint8Array(byteNumbers);
            return new Blob([byteArray], { type });
        } catch (e) {
            logger.error("Popup: Error converting base64 to Blob:", e.message, e.stack);
            return null;
        }
    }

    async function convertFileToBase64(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.onerror = error => reject(error);
            reader.readAsDataURL(file);
        });
    }
    
    function escapeHtml(unsafeText) {
        const div = document.createElement('div');
        div.innerText = unsafeText;
        return div.innerHTML;
    }

    // --- State Management Functions ---

    async function clearPendingImageFromBackground() {
        logger.log("Popup: Requesting background SW to clear any pending image data.");
        try {
            const response = await chrome.runtime.sendMessage({ action: 'clearStoredImage' });
            if (response && response.success) {
                logger.log("Popup: Background SW confirmed pending image cleared.");
            } else {
                logger.warn("Popup: Background SW did not confirm pending image cleared or responded with failure.", response);
            }
        } catch (error) {
            logger.error("Popup: Error sending 'clearStoredImage' message to background SW:", error.message, error.stack);
            if (error.message.includes("Could not establish connection") || error.message.includes("Receiving end does not exist")) {
                 logger.warn("Popup: Service worker might be inactive. This is sometimes okay for a clear operation.");
            }
        }
    }

    function resetLocallyStagedImage() {
        logger.log("Popup: Resetting locally staged image data.");
        locallyStagedImage.dataURI = null;
        locallyStagedImage.mimeType = null;
        locallyStagedImage.blob = null;
    }
    
    function clearUserInputFullState() {
        UIManager.clearUserInputDisplay();
        currentPastedImageBase64 = null;
        resetLocallyStagedImage();
        UIManager.resetCopyButtonToDefault(true);
        logger.log("Popup: User input area and associated image states cleared.");
    }

    // --- UI Rendering Callbacks & Dynamic UI ---

    async function refreshPromptListAndDynamicButtons() {
        logger.log("Popup: Refreshing prompt list and dynamic buttons.");
        try {
            currentPrompts = await getAllPrompts();
            UIManager.renderPromptList(currentPrompts, handleSelectPrompt, handleEditPrompt, handleDeletePrompt);
            await updatePendingImageCopyButtonVisibility(); // Check and show/hide pending image button
        } catch (error) {
            logger.error("Popup: Failed to load prompts for refresh.", error.message, error.stack);
            if (elements.promptList) elements.promptList.innerHTML = '<li>Error loading prompts.</li>';
        }
    }
    
    async function updatePendingImageCopyButtonVisibility() {
        UIManager.removePendingImageCopyButton(); // Clear any existing one first

        try {
            logger.log("Popup: Requesting pending image data from background SW for button visibility.");
            const response = await chrome.runtime.sendMessage({ action: 'retrieveImageForCopy' });
            
            if (chrome.runtime.lastError) {
                 logger.error("Popup: Error sending/receiving 'retrieveImageForCopy' message:", chrome.runtime.lastError.message);
                 return;
            }

            if (response && response.success && response.data) {
                const pendingData = response.data;
                logger.log("Popup: Pending image data received for button.", {title: pendingData.associatedPromptTitle });
                UIManager.showPendingImageCopyButton(pendingData, handlePendingImageCopy);
            } else {
                logger.log("Popup: No valid pending image data from background SW for button.", response);
            }
        } catch (error) {
            logger.error("Popup: Exception retrieving image from background SW for button visibility:", error.message, error.stack);
            if (error.message.includes("Could not establish connection") || error.message.includes("Receiving end does not exist")) {
                 logger.warn("Popup: Service worker might be inactive. 'Copy Pending Image' button will not appear.");
            }
        }
    }

    async function handlePendingImageCopy(buttonElement) { // Receives the button from UIManager
        logger.log("Popup: 'Copy Pending Image' button clicked (handler in popup.js).");
        // Retrieve data again, just in case, though UIManager got it for button creation
        const response = await chrome.runtime.sendMessage({ action: 'retrieveImageForCopy' });
        if (!(response && response.success && response.data)) {
            logger.error("Popup: Could not retrieve pending image data again for actual copy.");
            if(buttonElement) buttonElement.textContent = 'Error: Image data lost!';
            return;
        }
        const pendingData = response.data;
        const parsed = parseDataURI(pendingData.dataURI);

        if (parsed) {
            const blob = base64ToBlob(parsed.base64Data, parsed.mimeType);
            if (blob) {
                try {
                    await navigator.clipboard.write([new ClipboardItem({ [parsed.mimeType]: blob })]);
                    logger.log("Popup: Pending image blob copied successfully to clipboard.");
                    if(buttonElement) {
                        buttonElement.textContent = 'Image Copied!';
                        buttonElement.disabled = true;
                    }
                    await clearPendingImageFromBackground(); 
                    setTimeout(() => { 
                        try { if(buttonElement) buttonElement.remove(); } catch(e){/* no-op */}
                    }, 2000);
                } catch (error) {
                    logger.error("Popup: Error copying pending image blob:", error.message, error.stack);
                    if(buttonElement) buttonElement.textContent = 'Error Copying Image!';
                }
            } else {
                if(buttonElement) buttonElement.textContent = 'Error Processing Image!';
                logger.error("Popup: Failed to create blob for pending image from background data.");
            }
        } else {
            if(buttonElement) buttonElement.textContent = 'Error Parsing Image Data!';
            logger.error("Popup: Failed to parse dataURI for pending image from background data.");
        }
    }


    // --- Core Logic / Event Handlers ---

    async function handleAddPromptClick() {
        logger.log("Popup: Add prompt button clicked.");
        currentEditingId = null;
        UIManager.setAddEditFormValues('Add New Prompt', '', '');
        await clearPendingImageFromBackground();
        resetLocallyStagedImage();
        currentPastedImageBase64 = null;
        UIManager.showView(UIManager.VIEWS.EDIT);
        UIManager.focusPromptTitleInput();
    }

    async function handleBackToListClick() {
        logger.log("Popup: Back to list button clicked from input view.");
        selectedSystemPromptText = '';
        clearUserInputFullState();
        await clearPendingImageFromBackground();
        UIManager.showView(UIManager.VIEWS.LIST);
        await updatePendingImageCopyButtonVisibility();
    }

    async function handleCancelAddEditClick() {
        logger.log("Popup: Cancel add/edit button clicked.");
        currentEditingId = null;
        await clearPendingImageFromBackground();
        resetLocallyStagedImage();
        currentPastedImageBase64 = null;
        UIManager.showView(UIManager.VIEWS.LIST);
        await updatePendingImageCopyButtonVisibility();
    }

    function handleUserInputOnInput() { // Renamed from handleUserInput for clarity on event type
        const editorText = elements.userInput.innerText;
        const hasText = editorText.trim().length > 0;
        const imageElementInEditor = elements.userInput.querySelector('img');

        if (!imageElementInEditor && currentPastedImageBase64) {
            logger.log('Popup: Image element visually removed from editor. Clearing associated advanced copy data.');
            currentPastedImageBase64 = null;
            resetLocallyStagedImage();
        }
        UIManager.resetCopyButtonToDefault(!(hasText || imageElementInEditor));
    }
    
    function insertImageIntoEditor(imgElement) {
        elements.userInput.focus(); 
        const selection = window.getSelection();
        if (selection.rangeCount > 0) {
            const range = selection.getRangeAt(0);
            if (elements.userInput.contains(range.commonAncestorContainer) || elements.userInput === range.commonAncestorContainer) {
                range.deleteContents(); 
                range.insertNode(imgElement);
                // Place cursor after the image
                range.setStartAfter(imgElement);
                range.collapse(true);
                selection.removeAllRanges();
                selection.addRange(range);
                return;
            }
        }
        logger.warn("Popup: Could not determine selection/range within editor for image insertion. Appending image.");
        elements.userInput.appendChild(imgElement);
    }

    async function processPastedImage(imageFile) {
        logger.log('Popup: Image file found in paste, starting processing...', { name: imageFile.name, type: imageFile.type });
        let dataURI = null;
        try {
            dataURI = await convertFileToBase64(imageFile);
            if (!dataURI || !dataURI.startsWith('data:')) {
                logger.warn('Popup: convertFileToBase64 returned invalid dataURI. Cannot display.', { preview: dataURI ? dataURI.substring(0,50) : 'undefined' });
                alert('Pasted image data appears invalid. Could not display.');
                return;
            }
            logger.log('Popup: Image dataURI obtained, attempting to display.', { dataURI_length: dataURI.length });
            const img = document.createElement('img');
            img.src = dataURI;
            insertImageIntoEditor(img); // Uses UIManager's cached userInput element
            logger.log('Popup: Image displayed in user input area.');

            const parsed = parseDataURI(dataURI);
            if (parsed) {
                const blob = base64ToBlob(parsed.base64Data, parsed.mimeType);
                if (blob) {
                    locallyStagedImage = { dataURI, mimeType: parsed.mimeType, blob };
                    currentPastedImageBase64 = dataURI; // Mark that we have a processed image
                    logger.log('Popup: Image fully processed and staged for advanced copy.', { mime: parsed.mimeType });
                } else {
                    logger.warn('Popup: Failed to create blob for displayed image. Advanced copy features might be limited.');
                }
            } else {
                logger.warn('Popup: Failed to parse data URI for displayed image. Advanced copy features might be limited.');
            }
        } catch (error) {
            logger.error('Popup: General error processing pasted image file:', error.message, error.stack, { dataURIPresent: !!dataURI });
            alert('An error occurred processing the pasted image.');
            currentPastedImageBase64 = null;
            resetLocallyStagedImage();
        }
    }
    
    async function handlePasteOnUserInput(event) {
        logger.log('Popup: Paste event detected on user input.');
        const clipboardData = event.clipboardData || window.clipboardData;
    
        if (!clipboardData) {
            logger.warn('Popup: ClipboardData not available. Allowing default browser paste action.');
            setTimeout(() => { 
                handleUserInputOnInput(); // Update state after default paste
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
            logger.log('Popup: Image file detected. Preventing default and handling customly.');
            event.preventDefault();
            try {
                await clearPendingImageFromBackground(); 
                resetLocallyStagedImage();            
                currentPastedImageBase64 = null;      
                
                const existingImgElement = elements.userInput.querySelector('img');
                if (existingImgElement) {
                    logger.log("Popup: Removing existing visual image before pasting new image.");
                    existingImgElement.remove();
                }
                UIManager.resetCopyButtonToDefault(true);
    
                await processPastedImage(imageFile); 
    
            } catch (error) {
                logger.error('Popup: Error during custom image paste handling:', error.message, error.stack);
                alert("An error occurred during image paste. Check console.");
            } finally {
                handleUserInputOnInput(); // Update button state etc.
            }
        } else {
            logger.log('Popup: No image file detected. Allowing default browser paste for text/HTML.');
            await clearPendingImageFromBackground(); 
            
            const imageWasVisuallyPresent = elements.userInput.querySelector('img');
            if (imageWasVisuallyPresent && currentPastedImageBase64) { 
                 logger.log('Popup (before native non-image paste): Processed visual image was present. Clearing its state.');
                 currentPastedImageBase64 = null;
                 resetLocallyStagedImage();
            }
    
            setTimeout(() => {
                logger.log('Popup (after native non-image paste): Updating UI/internal state.');
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
            logger.warn("Popup: Copy failed. No content."); return;
        }
        if (!selectedSystemPromptText) {
            logger.warn("Popup: Copy failed. No system prompt selected."); return;
        }

        logger.log("Popup: Initiating copy (Step 1).", { canDoAdvancedImageCopy });
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
            logger.log("Popup: Step 1 (Text + Embedded/Placeholder) copied.");
            let message = 'Text Copied!';

            if (canDoAdvancedImageCopy) {
                logger.log("Popup: Storing image in background for 2-step copy.", { dataURI_length: locallyStagedImage.dataURI.length });
                try {
                    const response = await chrome.runtime.sendMessage({
                        action: 'storeImageForCopy',
                        dataURI: locallyStagedImage.dataURI,
                        mimeType: locallyStagedImage.mimeType,
                        associatedPromptTitle: elements.selectedPromptTitle.textContent || "Selected Prompt"
                    });

                    if (response && response.success) {
                        logger.log("Popup: Image sent to background SW.");
                        message = 'Text Copied! (Reopen for image)';
                    } else {
                        logger.error("Popup: Failed to store image in background SW.", response);
                        message = "Text Copied! (Error storing image)";
                        await clearPendingImageFromBackground(); 
                    }
                } catch (error) {
                    logger.error("Popup: Error sending message to background SW to store image:", error.message, error.stack);
                    message = "Text Copied! (Error contacting background)";
                    await clearPendingImageFromBackground();
                }
            } else {
                 await clearPendingImageFromBackground(); // Clear any stale background data if no advanced copy
            }
            
            elements.copyOutputButton.textContent = message;
            elements.copyOutputButton.disabled = true;
            setTimeout(() => window.close(), 1500);
        } catch (error) {
            logger.error('Popup: Failed to copy (Step 1 - text/html content):', error.message, error.stack);
            elements.copyOutputButton.textContent = 'Error Copying Text!';
            setTimeout(() => UIManager.resetCopyButtonToDefault(!(hasText || imageIsVisuallyPresent)), 2000);
        }
    }
    
    async function handleSavePromptClick() {
        const title = elements.promptTitleInput.value.trim();
        const text = elements.promptTextInput.value.trim();
        if (!title || !text) { 
            alert("Title and prompt text cannot be empty."); 
            return; 
        }
        const promptToSave = { id: currentEditingId || Date.now().toString(), title, text };
        logger.log(`Popup: Saving prompt ID: ${promptToSave.id}, Title: "${title}"`);
        try {
            await savePrompt(promptToSave);
            currentEditingId = null;
            await refreshPromptListAndDynamicButtons();
            UIManager.showView(UIManager.VIEWS.LIST);
        } catch (error) {
            logger.error("Popup: Error saving prompt:", error.message, error.stack);
            alert(`Failed to save prompt: ${error.message}`);
        }
    }

    async function handleSelectPrompt(promptId) {
        const selectedPrompt = currentPrompts.find(p => p.id === promptId);
        if (!selectedPrompt) { 
            logger.error("Popup: Selected prompt not found with ID:", promptId);
            alert("Error: Prompt not found."); 
            return; 
        }
        logger.log("Popup: Selected prompt ID:", promptId, " Title:", selectedPrompt.title);
        selectedSystemPromptText = selectedPrompt.text;
        UIManager.setSelectedPromptTitle(selectedPrompt.title);
        clearUserInputFullState(); // Clears display and internal image state
        await clearPendingImageFromBackground(); 
        UIManager.showView(UIManager.VIEWS.INPUT);
        UIManager.focusUserInput();
    }

    async function handleEditPrompt(promptId) {
        const promptToEdit = currentPrompts.find(p => p.id === promptId);
        if (!promptToEdit) {
            logger.error("Popup: Prompt to edit not found with ID:", promptId);
            alert("Error: Prompt to edit not found."); 
            return; 
        }
        logger.log("Popup: Edit icon clicked for prompt ID:", promptId);
        currentEditingId = promptId;
        UIManager.setAddEditFormValues('Edit Prompt', promptToEdit.title, promptToEdit.text);
        await clearPendingImageFromBackground(); 
        resetLocallyStagedImage();
        currentPastedImageBase64 = null; 
        UIManager.showView(UIManager.VIEWS.EDIT);
        UIManager.focusPromptTitleInput();
    }

    async function handleDeletePrompt(promptId, promptTitle) {
        if (confirm(`Are you sure you want to delete the prompt "${promptTitle}"?`)) {
            logger.log(`Popup: Deleting prompt ID: ${promptId}, Title: "${promptTitle}"`);
            try {
                await deletePrompt(promptId);
                await clearPendingImageFromBackground(); 
                await refreshPromptListAndDynamicButtons(); // This will re-render list and update pending image button
                // No explicit view change needed if already on list view
            } catch (error) {
                logger.error("Popup: Error deleting prompt:", error.message, error.stack);
                alert(`Failed to delete prompt: ${error.message}`);
            }
        }
    }

    // --- Import/Export Functionality ---
    async function handleExportPromptsClick() {
        logger.log("Popup: Export prompts button clicked.");
        try {
            const promptsToExport = await getAllPrompts();
            if (promptsToExport.length === 0) {
                alert("No prompts to export.");
                logger.log("Popup: No prompts available for export.");
                return;
            }

            // We only need id, title, text for export/import.
            const simplifiedPrompts = promptsToExport.map(p => ({ id: p.id, title: p.title, text: p.text }));

            const jsonData = JSON.stringify(simplifiedPrompts, null, 2);
            const blob = new Blob([jsonData], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            const timestamp = new Date().toISOString().slice(0, 19).replace(/:/g, '-');
            a.href = url;
            a.download = `ai-prompt-manager-backup-${timestamp}.json`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
            logger.log(`Popup: Prompts successfully exported to ${a.download}. Count: ${simplifiedPrompts.length}`);
            alert(`${simplifiedPrompts.length} prompts exported successfully.`);
        } catch (error) {
            logger.error("Popup: Error exporting prompts:", error.message, error.stack);
            alert(`Failed to export prompts: ${error.message}`);
        }
    }

    function handleImportPromptsClick() {
        logger.log("Popup: Import prompts button clicked, triggering file input.");
        if (elements.importFileInput) {
            elements.importFileInput.click();
        } else {
            logger.error("Popup: Import file input element not found.");
            alert("Error: Could not initiate import process. File input missing.");
        }
    }

    async function handleFileImport(event) {
        logger.log("Popup: File selected for import.");
        const file = event.target.files[0];
        if (!file) {
            logger.log("Popup: No file selected for import.");
            return;
        }
        if (file.type !== "application/json") {
            alert("Invalid file type. Please select a JSON file.");
            logger.warn("Popup: Invalid file type selected for import:", file.type);
            elements.importFileInput.value = ""; // Reset file input
            return;
        }

        const reader = new FileReader();
        reader.onload = async (e) => {
            try {
                const content = e.target.result;
                const importedData = JSON.parse(content);
                logger.log("Popup: File content parsed as JSON.", { dataPreview: JSON.stringify(importedData).substring(0,100) + "..." });

                if (!Array.isArray(importedData)) {
                    throw new Error("Imported JSON is not an array.");
                }

                const promptsToImport = [];
                for (const item of importedData) {
                    if (item && typeof item.title === 'string' && typeof item.text === 'string') {
                        promptsToImport.push({
                            // id will be generated anew, original id is ignored to prevent conflicts
                            title: item.title.trim(),
                            text: item.text // Keep original text, trimming only title.
                        });
                    } else {
                        logger.warn("Popup: Skipping invalid item in imported JSON:", item);
                    }
                }

                if (promptsToImport.length === 0) {
                    alert("No valid prompts found in the selected file.");
                    logger.log("Popup: No valid prompts to import from file.");
                    elements.importFileInput.value = ""; // Reset file input
                    return;
                }

                logger.log(`Popup: ${promptsToImport.length} valid prompts parsed from file. Proceeding with import.`);
                
                // Fetch current prompts to check for title conflicts
                const existingPrompts = await getAllPrompts();
                const existingTitles = existingPrompts.map(p => p.title);
                let importedCount = 0;
                let skippedCount = 0;

                for (const importedPrompt of promptsToImport) {
                    let newTitle = importedPrompt.title;
                    let titleSuffix = 2;
                    while (existingTitles.includes(newTitle)) {
                        newTitle = `${importedPrompt.title} (${titleSuffix++})`;
                    }

                    const newId = Date.now().toString() + '-' + Math.random().toString(36).substring(2, 9); // Ensure unique ID
                    const promptToSave = {
                        id: newId,
                        title: newTitle,
                        text: importedPrompt.text
                    };

                    try {
                        logger.log(`Popup: Attempting to save imported prompt: ID ${promptToSave.id}, Title "${promptToSave.title}"`);
                        await savePrompt(promptToSave);
                        existingTitles.push(newTitle); // Add to current titles to avoid re-checking in same batch
                        importedCount++;
                    } catch (saveError) {
                        logger.error(`Popup: Error saving imported prompt "${promptToSave.title}":`, saveError.message, saveError.stack);
                        skippedCount++;
                        // Optionally, alert user per failed prompt or collect errors for a summary
                    }
                }

                logger.log(`Popup: Import process complete. Imported: ${importedCount}, Skipped/Failed: ${skippedCount}.`);
                alert(`Import complete!\nSuccessfully imported: ${importedCount}\nSkipped due to errors: ${skippedCount}`);
                
                await refreshPromptListAndDynamicButtons(); // Refresh UI to show new prompts
                UIManager.showView(UIManager.VIEWS.LIST); // Ensure list view is active

            } catch (error) {
                logger.error("Popup: Error processing imported file:", error.message, error.stack);
                alert(`Failed to import prompts: ${error.message}`);
            } finally {
                elements.importFileInput.value = ""; // Reset file input regardless of outcome
            }
        };
        reader.onerror = (error) => {
            logger.error("Popup: Error reading file for import:", error.message, error.stack);
            alert("Error reading the selected file.");
            elements.importFileInput.value = ""; // Reset file input
        };
        reader.readAsText(file);
    }


    async function initializePopup() {
        logger.log("Popup: Initializing.");

        // Attach event listeners using elements from UIManager
        if (elements.addPromptButton) elements.addPromptButton.addEventListener('click', handleAddPromptClick);
        if (elements.backToListButton) elements.backToListButton.addEventListener('click', handleBackToListClick);
        if (elements.cancelAddEditButton) elements.cancelAddEditButton.addEventListener('click', handleCancelAddEditClick);
        if (elements.copyOutputButton) elements.copyOutputButton.addEventListener('click', handleCopyOutputClick);
        if (elements.userInput) {
            elements.userInput.addEventListener('input', handleUserInputOnInput);
            elements.userInput.addEventListener('paste', handlePasteOnUserInput);
        }
        if (elements.savePromptButton) elements.savePromptButton.addEventListener('click', handleSavePromptClick);
        
        // Import/Export listeners
        if (elements.exportPromptsButton) elements.exportPromptsButton.addEventListener('click', handleExportPromptsClick);
        if (elements.importPromptsButton) elements.importPromptsButton.addEventListener('click', handleImportPromptsClick);
        if (elements.importFileInput) elements.importFileInput.addEventListener('change', handleFileImport);

        await refreshPromptListAndDynamicButtons();
        UIManager.showView(UIManager.VIEWS.LIST);
        logger.log("Popup: Initialization complete.");
    }

    // Version status functions
    async function initializeVersionStatus() {
        const versionChecker = new VersionChecker('ai-prompt-manager');
        
        // Auto-check if it's been >24 hours since last check
        console.log('[Popup DEBUG] Checking if auto-check needed on popup open');
        if (await versionChecker.shouldCheck()) {
            console.log('[Popup DEBUG] Auto-triggering version check (>24 hours since last check)');
            await versionChecker.checkVersion();
        } else {
            console.log('[Popup DEBUG] Skipping auto-check (checked recently)');
        }
        
        // Set up check now button
        const checkVersionBtn = document.getElementById('check-version-btn');
        if (checkVersionBtn) {
            checkVersionBtn.addEventListener('click', async () => {
                checkVersionBtn.disabled = true;
                checkVersionBtn.textContent = 'Checking...';
                
                await versionChecker.forceCheckVersion();
                await updateVersionStatusDisplay();
                
                checkVersionBtn.disabled = false;
                checkVersionBtn.textContent = 'Check';
            });
        }
        
        // Initial display update
        await updateVersionStatusDisplay();
        
        // Update display every 30 seconds to refresh "X minutes ago" text
        setInterval(updateVersionStatusDisplay, 30000);
    }
    
    async function updateVersionStatusDisplay() {
        const versionChecker = new VersionChecker('ai-prompt-manager');
        const status = await versionChecker.getVersionStatus();
        
        // Update current version
        const currentVersionEl = document.getElementById('current-version');
        if (currentVersionEl) currentVersionEl.textContent = status.currentVersion;
        
        // Update latest version
        const latestVersionEl = document.getElementById('latest-version');
        if (latestVersionEl) latestVersionEl.textContent = status.latestVersion;
        
        // Update last checked time
        const lastCheckedEl = document.getElementById('last-checked');
        if (lastCheckedEl) lastCheckedEl.textContent = status.lastCheckedText;
        
        // Update status bar color based on update availability
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

    // Start the popup
    initializePopup().catch(err => {
        logger.error("Popup: Uncaught error during initialization:", err.message, err.stack);
        alert("A critical error occurred during popup initialization. Please check the console.");
    });
});/ /   T e s t   a u t o m a t i o n   w i t h   t i m e s t a m p   v e r s i o n i n g  
 