// popup.js
document.addEventListener('DOMContentLoaded', async () => {
    let currentPrompts = [];
    let selectedSystemPromptText = '';
    let currentEditingId = null;
    
    let currentPastedImageBase64 = null; 
    let locallyStagedImage = {
        dataURI: null,
        mimeType: null,
        blob: null
    };

    // PENDING_IMAGE_STORAGE_KEY is no longer used for chrome.storage.session for image data
    // const PENDING_IMAGE_STORAGE_KEY = 'promptManagerPendingImage'; // Keep for potential other uses or remove if only for image

    // DOM Element Getters
    const promptListView = document.getElementById('prompt-list-view');
    const promptInputView = document.getElementById('prompt-input-view');
    const addEditView = document.getElementById('add-edit-view');
    const addPromptButton = document.getElementById('add-prompt-btn');
    const backToListButton = document.getElementById('back-to-list-btn');
    const cancelAddEditButton = document.getElementById('cancel-add-edit-btn');
    const copyOutputButton = document.getElementById('copy-output-btn');
    const promptListElement = document.getElementById('prompt-list');
    const selectedPromptTitleElement = document.getElementById('selected-prompt-title');
    const userInputElement = document.getElementById('user-input');
    const savePromptButton = document.getElementById('save-prompt-btn');
    const addEditTitleElement = document.getElementById('add-edit-title');
    const promptTitleInput = document.getElementById('prompt-title-input');
    const promptTextInput = document.getElementById('prompt-text-input');

    const views = {
        LIST: 'prompt-list-view',
        INPUT: 'prompt-input-view',
        EDIT: 'add-edit-view'
    };

    // --- Utility Functions ---

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
        logger.log("Popup: Resetting locally staged image data (current image's advanced copy features).");
        locallyStagedImage.dataURI = null;
        locallyStagedImage.mimeType = null;
        locallyStagedImage.blob = null;
    }
    
    function clearUserInputFullState() {
        userInputElement.innerHTML = '';
        currentPastedImageBase64 = null;
        resetLocallyStagedImage();
        resetCopyButtonToDefault(true);
        logger.log("Popup: User input area and associated image states cleared.");
    }

    function resetCopyButtonToDefault(disabled = true) {
        copyOutputButton.textContent = 'Copy Output';
        copyOutputButton.disabled = disabled;
    }

    // --- View Management ---

    function showView(viewId) {
        logger.log(`Popup: Switching view to: ${viewId}`);
        Object.values(views).forEach(id => {
            const viewElement = document.getElementById(id);
            if(viewElement) viewElement.style.display = 'none';
        });
        const viewToShow = document.getElementById(viewId);
        if (viewToShow) {
            viewToShow.style.display = 'block';
        } else {
            logger.error("Popup: View ID not found:", viewId, "Falling back to list view.");
            document.getElementById(views.LIST).style.display = 'block';
        }
    }

    // --- UI Rendering ---

    function renderPromptListUI() {
        logger.log('Popup: Rendering prompt list UI with', currentPrompts.length, 'prompts.');
        promptListElement.innerHTML = '';
        if (currentPrompts.length === 0) {
            const noPromptsMessage = document.createElement('li');
            noPromptsMessage.textContent = 'No prompts yet. Click (+) to add one!';
            promptListElement.appendChild(noPromptsMessage);
            return;
        }
        currentPrompts.forEach(prompt => {
            const listItem = document.createElement('li');
            listItem.setAttribute('data-prompt-id', prompt.id);
            const titleSpan = document.createElement('span');
            titleSpan.classList.add('prompt-title');
            titleSpan.textContent = prompt.title;
            listItem.appendChild(titleSpan);
            const iconsSpan = document.createElement('span');
            iconsSpan.classList.add('action-icons');
            const editIcon = document.createElement('span');
            editIcon.classList.add('edit-icon');
            editIcon.textContent = '\u270F\uFE0F';
            editIcon.title = `Edit "${prompt.title}"`;
            editIcon.addEventListener('click', (event) => { event.stopPropagation(); handleEditPrompt(prompt.id); });
            iconsSpan.appendChild(editIcon);
            const deleteIcon = document.createElement('span');
            deleteIcon.classList.add('delete-icon');
            deleteIcon.textContent = '\uD83D\uDDD1\uFE0F';
            deleteIcon.title = `Delete "${prompt.title}"`;
            deleteIcon.addEventListener('click', (event) => { event.stopPropagation(); handleDeletePrompt(prompt.id, prompt.title); });
            iconsSpan.appendChild(deleteIcon);
            listItem.appendChild(iconsSpan);
            listItem.addEventListener('click', () => handleSelectPrompt(prompt.id));
            promptListElement.appendChild(listItem);
        });
        logger.log('Popup: Prompt list UI rendering complete.');
    }

    // --- Core Logic / Event Handlers ---

    async function loadAndRenderPrompts() {
        logger.log("Popup: Initiating prompt loading and rendering.");
        try {
            currentPrompts = await getAllPrompts();
            renderPromptListUI();
        } catch (error) {
            logger.error("Popup: Failed to load prompts.", error.message, error.stack);
            promptListElement.innerHTML = '<li>Error loading prompts.</li>';
        }
    }

    async function handleAddPromptClick() {
        logger.log("Popup: Add prompt button clicked.");
        currentEditingId = null;
        addEditTitleElement.textContent = 'Add New Prompt';
        promptTitleInput.value = '';
        promptTextInput.value = '';
        await clearPendingImageFromBackground();
        resetLocallyStagedImage();
        currentPastedImageBase64 = null;
        showView(views.EDIT);
        promptTitleInput.focus();
    }

    async function handleBackToListClick() {
        logger.log("Popup: Back to list button clicked from input view.");
        selectedSystemPromptText = '';
        clearUserInputFullState();
        await clearPendingImageFromBackground();
        showView(views.LIST);
        await setupPendingImageCopyButton();
    }

    async function handleCancelAddEditClick() {
        logger.log("Popup: Cancel add/edit button clicked.");
        currentEditingId = null;
        await clearPendingImageFromBackground();
        resetLocallyStagedImage();
        currentPastedImageBase64 = null;
        showView(views.LIST);
        await setupPendingImageCopyButton();
    }

    function handleUserInput() {
        const editorText = userInputElement.innerText;
        const hasText = editorText.trim().length > 0;
        const imageElementInEditor = userInputElement.querySelector('img');

        if (!imageElementInEditor && currentPastedImageBase64) {
            logger.log('Popup: Image element visually removed from editor (e.g., by typing/backspace). Clearing associated advanced copy data.');
            currentPastedImageBase64 = null;
            resetLocallyStagedImage();
        }
        resetCopyButtonToDefault(!(hasText || imageElementInEditor));
    }

    function insertImageIntoEditor(imgElement) {
        userInputElement.focus(); 
        const selection = window.getSelection();
        if (selection.rangeCount > 0) {
            const range = selection.getRangeAt(0);
            if (userInputElement.contains(range.commonAncestorContainer) || userInputElement === range.commonAncestorContainer) {
                range.deleteContents(); 
                range.insertNode(imgElement);
                range.setStartAfter(imgElement);
                range.collapse(true);
                selection.removeAllRanges();
                selection.addRange(range);
                return;
            }
        }
        logger.warn("Popup: Could not determine selection/range within editor for image insertion. Appending image.");
        userInputElement.appendChild(imgElement);
    }

    async function processPastedImage(imageFile) {
        logger.log('Popup: Image file found in paste, starting processing...', { name: imageFile.name, type: imageFile.type });
        let dataURI = null;
        try {
            dataURI = await convertFileToBase64(imageFile);
            if (!dataURI || !dataURI.startsWith('data:')) {
                logger.warn('Popup: convertFileToBase64 returned invalid or non-dataURI string. Cannot display image.');
                alert('Pasted image data appears to be invalid. Could not display.');
                return;
            }
            logger.log('Popup: Image dataURI obtained, attempting to display.', { dataURI_length: dataURI.length, preview: dataURI.substring(0,50) + "..."});
            const img = document.createElement('img');
            img.src = dataURI;
            insertImageIntoEditor(img);
            logger.log('Popup: Image displayed in user input area.');

            const parsed = parseDataURI(dataURI);
            if (parsed) {
                const blob = base64ToBlob(parsed.base64Data, parsed.mimeType);
                if (blob) {
                    locallyStagedImage = { dataURI, mimeType: parsed.mimeType, blob };
                    currentPastedImageBase64 = dataURI;
                    logger.log('Popup: Image fully processed and staged for advanced copy.', { mime: parsed.mimeType });
                } else {
                    logger.warn('Popup: Failed to create blob for displayed image. Advanced copy features for this image might be limited.');
                    alert('Image displayed, but error preparing for advanced copy (blob conversion failed).');
                }
            } else {
                logger.warn('Popup: Failed to parse data URI for displayed image. Advanced copy features for this image might be limited.');
                alert('Image displayed, but error preparing for advanced copy (data URI parsing failed).');
            }
        } catch (error) {
            logger.error('Popup: General error processing pasted image file:', error.message, error.stack, { dataURIPresent: !!dataURI });
            alert('An error occurred while processing the pasted image. If displayed, its advanced copy features might be unavailable.');
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
                const imageElementInEditor = userInputElement.querySelector('img');
                if (!imageElementInEditor && currentPastedImageBase64) {
                    logger.log('Popup (after presumed native paste): Visual image gone. Clearing advanced copy state.');
                    currentPastedImageBase64 = null;
                    resetLocallyStagedImage();
                }
                handleUserInput();
            }, 0);
            return;
        }
    
        let imageFile = null;
        const items = clipboardData.items;
        if (items && items.length > 0) {
            for (let i = 0; i < items.length; i++) {
                if (items[i].kind === 'file' && items[i].type.startsWith('image/')) {
                    imageFile = items[i].getAsFile();
                    if (imageFile) {
                        logger.log('Popup: Image file retrieved from clipboard item.', { name: imageFile.name, type: imageFile.type });
                    } else {
                        logger.warn('Popup: Clipboard item indicated image file, but getAsFile() returned null.');
                    }
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
                
                const existingImgElement = userInputElement.querySelector('img');
                if (existingImgElement) {
                    logger.log("Popup: Removing existing visual image before pasting new image.");
                    existingImgElement.remove();
                }
                resetCopyButtonToDefault(true);
    
                await processPastedImage(imageFile); 
    
            } catch (error) {
                logger.error('Popup: Error during custom image paste handling:', error.message, error.stack);
                alert("An error occurred during image paste. Check console.");
            } finally {
                handleUserInput();
            }
        } else {
            logger.log('Popup: No image file detected. Allowing default browser paste for text/HTML.');
            await clearPendingImageFromBackground(); 
            
            const imageWasVisuallyPresent = userInputElement.querySelector('img');
            if (imageWasVisuallyPresent && currentPastedImageBase64) { 
                 logger.log('Popup (before native non-image paste): Processed visual image was present. Clearing its advanced copy state.');
                 currentPastedImageBase64 = null;
                 resetLocallyStagedImage();
            }
    
            setTimeout(() => {
                logger.log('Popup (after native non-image paste): Native paste should have completed. Updating UI/internal state.');
                const imageIsNowPresent = userInputElement.querySelector('img');
                if (imageIsNowPresent) {
                    if (!currentPastedImageBase64) { 
                        logger.log('Popup (after native non-image paste): A visual image is present but not processed by us for advanced copy.');
                    }
                } else { 
                    if (currentPastedImageBase64) {
                        logger.log('Popup (after native non-image paste): Visual image removed by paste. Clearing advanced copy state.');
                        currentPastedImageBase64 = null;
                        resetLocallyStagedImage();
                    }
                }
                handleUserInput(); 
            }, 0);
        }
    }

    async function handleCopyOutputClick() {
        const userHtmlContent = userInputElement.innerHTML; 
        const userTextContent = userInputElement.innerText.trim();
        const hasText = userTextContent.length > 0;
        const imageIsVisuallyPresent = !!userInputElement.querySelector('img');
        const canDoAdvancedImageCopy = !!currentPastedImageBase64 && !!locallyStagedImage.blob && !!locallyStagedImage.dataURI;

        if (!hasText && !imageIsVisuallyPresent) {
            logger.warn("Popup: Copy failed. No content (text or visual image)."); return;
        }
        if (!selectedSystemPromptText) {
            logger.warn("Popup: Copy failed. No system prompt selected."); return;
        }

        logger.log("Popup: Initiating copy (Step 1: Text + Embedded Image/Placeholder).", { canDoAdvancedImageCopy });
        const htmlOutput = `<div><p><strong>System Prompt:</strong></p><pre style="white-space: pre-wrap; word-wrap: break-word;">${escapeHtml(selectedSystemPromptText)}</pre><hr><p><strong>User Input:</strong></p><div>${userHtmlContent}</div></div>`;
        let plainTextOutput = `[[[system prompt begin]]]\n\n${selectedSystemPromptText}\n\n[[[system prompt end]]]`;
        if (hasText) {
            plainTextOutput += `\n\n\n[[[user input text begin]]]\n\n${userTextContent}\n\n[[[user input text end]]]`;
        }
        if (imageIsVisuallyPresent) {
            plainTextOutput += `\n\n\n[[[user input]]]\n\n[Image was present. ${canDoAdvancedImageCopy ? "User pasted an image, check your assets/artifacts" : "Image could not be fully processed for separate copy."}]\n\n[[[user input end]]]`;
        }

        const clipboardPayload = {
            'text/html': new Blob([htmlOutput], { type: 'text/html' }),
            'text/plain': new Blob([plainTextOutput], { type: 'text/plain' })
        };

        try {
            await navigator.clipboard.write([new ClipboardItem(clipboardPayload)]);
            logger.log("Popup: Step 1 (Text + Embedded/Placeholder) copied to clipboard.");
            let message = 'Text Copied!';

            if (canDoAdvancedImageCopy) {
                logger.log("Popup: Attempting to store image in background for 2-step copy.", { dataURI_length: locallyStagedImage.dataURI.length });
                try {
                    const response = await chrome.runtime.sendMessage({
                        action: 'storeImageForCopy',
                        dataURI: locallyStagedImage.dataURI,
                        mimeType: locallyStagedImage.mimeType,
                        associatedPromptTitle: selectedPromptTitleElement.textContent || "Selected Prompt"
                    });

                    if (response && response.success) {
                        logger.log("Popup: Image successfully sent to background SW for storage.");
                        message = 'Text Copied! (Reopen for image)';
                    } else {
                        logger.error("Popup: Failed to store image in background SW.", response);
                        message = "Text Copied! (Error storing image for 2-step)";
                        await clearPendingImageFromBackground(); // Ensure it's cleared if storage failed
                    }
                } catch (error) {
                    logger.error("Popup: Error sending message to background SW to store image:", error.message, error.stack);
                    message = "Text Copied! (Error contacting background for 2-step image)";
                    await clearPendingImageFromBackground();
                }
            } else if (imageIsVisuallyPresent) {
                 message = 'Text Copied! (Image not fully processed for 2-step)';
                 await clearPendingImageFromBackground(); // No advanced copy, so clear any stale background data
            } else {
                 await clearPendingImageFromBackground(); // No image at all, clear background
            }
            
            copyOutputButton.textContent = message;
            copyOutputButton.disabled = true;
            setTimeout(() => window.close(), 1500);
        } catch (error) {
            logger.error('Popup: Failed to copy (Step 1 - text/html content):', error.message, error.stack);
            copyOutputButton.textContent = 'Error Copying Text!';
            setTimeout(() => resetCopyButtonToDefault(!(hasText || imageIsVisuallyPresent)), 2000);
        }
    }
    
    async function setupPendingImageCopyButton() {
        const existingButton = document.getElementById('copy-pending-image-btn');
        if (existingButton) existingButton.remove();

        try {
            logger.log("Popup: Requesting pending image data from background SW.");
            const response = await chrome.runtime.sendMessage({ action: 'retrieveImageForCopy' });
            
            if (chrome.runtime.lastError) {
                 logger.error("Popup: Error sending/receiving 'retrieveImageForCopy' message:", chrome.runtime.lastError.message);
                 return;
            }

            if (response && response.success && response.data) {
                const pendingData = response.data;
                logger.log("Popup: Pending image data received from background SW.", {title: pendingData.associatedPromptTitle, dataURI_preview: pendingData.dataURI.substring(0,50) + "..."});
                
                const button = document.createElement('button');
                button.id = 'copy-pending-image-btn';
                button.textContent = `Copy Image for '${pendingData.associatedPromptTitle}'`;
                button.style.marginBottom = '10px';
                button.style.width = '100%';
                button.style.backgroundColor = '#e8f0fe';
                button.style.border = '1px solid #1a73e8';
                button.style.color = '#1a73e8';

                button.onclick = async () => {
                    logger.log("Popup: 'Copy Pending Image' button clicked.");
                    const parsed = parseDataURI(pendingData.dataURI);
                    if (parsed) {
                        const blob = base64ToBlob(parsed.base64Data, parsed.mimeType);
                        if (blob) {
                            try {
                                await navigator.clipboard.write([new ClipboardItem({ [parsed.mimeType]: blob })]);
                                logger.log("Popup: Pending image blob copied successfully to clipboard.");
                                button.textContent = 'Image Copied to Clipboard!';
                                button.disabled = true;
                                await clearPendingImageFromBackground(); // Crucial: clear after successful copy
                                setTimeout(() => { try {button.remove();} catch(e){/* no-op */} }, 2000);
                            } catch (error) {
                                logger.error("Popup: Error copying pending image blob:", error.message, error.stack);
                                button.textContent = 'Error Copying Image!';
                            }
                        } else {
                            button.textContent = 'Error Processing Stored Image!';
                            logger.error("Popup: Failed to create blob for pending image from background data.");
                        }
                    } else {
                        button.textContent = 'Error Parsing Stored Image Data!';
                        logger.error("Popup: Failed to parse dataURI for pending image from background data.");
                    }
                };
                promptListView.insertBefore(button, promptListView.firstChild);
            } else {
                logger.log("Popup: No valid pending image data received from background SW or retrieval failed.", response);
            }
        } catch (error) {
            logger.error("Popup: Exception trying to retrieve image from background SW:", error.message, error.stack);
            if (error.message.includes("Could not establish connection") || error.message.includes("Receiving end does not exist")) {
                 logger.warn("Popup: Service worker might be inactive. The 'Copy Pending Image' button will not appear.");
            }
        }
    }

    async function handleSavePromptClick() {
        const title = promptTitleInput.value.trim();
        const text = promptTextInput.value.trim();
        if (!title || !text) { 
            alert("Title and prompt text cannot be empty."); 
            return; 
        }
        const promptToSave = { id: currentEditingId || Date.now().toString(), title, text };
        logger.log(`Popup: Saving prompt ID: ${promptToSave.id}, Title: "${title}"`);
        try {
            await savePrompt(promptToSave);
            currentEditingId = null;
            await loadAndRenderPrompts();
            showView(views.LIST);
            await setupPendingImageCopyButton();
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
        selectedPromptTitleElement.textContent = selectedPrompt.title;
        clearUserInputFullState();
        await clearPendingImageFromBackground(); 
        showView(views.INPUT);
        userInputElement.focus();
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
        addEditTitleElement.textContent = 'Edit Prompt';
        promptTitleInput.value = promptToEdit.title;
        promptTextInput.value = promptToEdit.text;
        await clearPendingImageFromBackground(); 
        resetLocallyStagedImage();
        currentPastedImageBase64 = null; 
        showView(views.EDIT);
        promptTitleInput.focus();
    }

    async function handleDeletePrompt(promptId, promptTitle) {
        if (confirm(`Are you sure you want to delete the prompt "${promptTitle}"?`)) {
            logger.log(`Popup: Deleting prompt ID: ${promptId}, Title: "${promptTitle}"`);
            try {
                await deletePrompt(promptId);
                await clearPendingImageFromBackground(); 
                await loadAndRenderPrompts();
                await setupPendingImageCopyButton();
            } catch (error) {
                logger.error("Popup: Error deleting prompt:", error.message, error.stack);
                alert(`Failed to delete prompt: ${error.message}`);
            }
        }
    }

    async function initializePopup() {
        logger.log("Popup: Initializing.");
        addPromptButton.addEventListener('click', handleAddPromptClick);
        backToListButton.addEventListener('click', handleBackToListClick);
        cancelAddEditButton.addEventListener('click', handleCancelAddEditClick);
        copyOutputButton.addEventListener('click', handleCopyOutputClick);
        userInputElement.addEventListener('input', handleUserInput);
        userInputElement.addEventListener('paste', handlePasteOnUserInput);
        savePromptButton.addEventListener('click', handleSavePromptClick);
        
        await loadAndRenderPrompts();
        await setupPendingImageCopyButton(); 
        
        showView(views.LIST);
        logger.log("Popup: Initialization complete.");
    }

    initializePopup();
});