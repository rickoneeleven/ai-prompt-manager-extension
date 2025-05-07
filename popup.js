document.addEventListener('DOMContentLoaded', async () => {
    let currentPrompts = [];
    let selectedSystemPromptText = '';
    let currentEditingId = null;
    let currentPastedImageBase64 = null; // Full data URI string of the image visually in the editor AND fully processed for copy

    // Holds the image data (base64 URI, mimeType, blob) currently processed from paste
    let locallyStagedImage = {
        dataURI: null,
        mimeType: null,
        blob: null
    };

    const PENDING_IMAGE_STORAGE_KEY = 'promptManagerPendingImage';

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

    async function clearPendingImageFromSession() {
        logger.log("Popup: Clearing pending image data from session storage.");
        try {
            await chrome.storage.session.remove(PENDING_IMAGE_STORAGE_KEY);
        } catch (error) {
            logger.error("Popup: Error clearing pending image from session storage:", error.message, error.stack);
        }
    }

    function resetLocallyStagedImage() {
        logger.log("Popup: Clearing locally staged image data.");
        locallyStagedImage.dataURI = null;
        locallyStagedImage.mimeType = null;
        locallyStagedImage.blob = null;
    }

    function resetCopyButtonToDefault(disabled = true) {
        copyOutputButton.textContent = 'Copy Output';
        copyOutputButton.disabled = disabled;
    }

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
        await clearPendingImageFromSession();
        resetLocallyStagedImage();
        currentPastedImageBase64 = null;
        showView(views.EDIT);
        promptTitleInput.focus();
    }

    function clearUserInputState() {
        userInputElement.innerHTML = '';
        currentPastedImageBase64 = null;
        resetLocallyStagedImage();
        resetCopyButtonToDefault(true);
    }

    async function handleBackToListClick() {
        logger.log("Popup: Back to list button clicked from input view.");
        selectedSystemPromptText = '';
        clearUserInputState();
        await clearPendingImageFromSession();
        showView(views.LIST);
        await setupPendingImageCopyButton();
    }

    async function handleCancelAddEditClick() {
        logger.log("Popup: Cancel add/edit button clicked.");
        currentEditingId = null;
        await clearPendingImageFromSession();
        resetLocallyStagedImage();
        currentPastedImageBase64 = null;
        showView(views.LIST);
        await setupPendingImageCopyButton();
    }

    function handleUserInput() {
        const hasText = userInputElement.innerText.trim().length > 0;
        const imageElementInEditor = userInputElement.querySelector('img');

        if (!imageElementInEditor && currentPastedImageBase64) {
            logger.log('Popup: Image element visually removed from editor by user. Clearing associated data.');
            currentPastedImageBase64 = null;
            resetLocallyStagedImage();
            // Do not clear session pending image here automatically.
            // User might be editing text with an image already staged for copy via session.
            // The session image will be cleared if they perform a new copy operation with a different/no image.
        }
        resetCopyButtonToDefault(!(hasText || imageElementInEditor)); // Enable if text OR a visual image is present
    }

    async function convertFileToBase64(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result); // reader.result is the data URI
            reader.onerror = error => reject(error);
            reader.readAsDataURL(file);
        });
    }

    async function handlePasteOnUserInput(event) {
        logger.log('Popup: Paste event detected on user input.');
        event.preventDefault();
        
        // Clear previous states before processing new paste
        await clearPendingImageFromSession();
        resetLocallyStagedImage();
        currentPastedImageBase64 = null; // Crucial reset
        const existingImgElement = userInputElement.querySelector('img');
        if (existingImgElement) existingImgElement.remove(); // Remove any old visual image first
        resetCopyButtonToDefault(true);

        const items = (event.clipboardData || window.clipboardData).items;
        let imageFile = null;
        for (let i = 0; i < items.length; i++) {
            if (items[i].type.indexOf('image') !== -1) {
                imageFile = items[i].getAsFile();
                break;
            }
        }

        if (imageFile) {
            logger.log('Popup: Image file found in paste.', { name: imageFile.name, type: imageFile.type });
            let dataURI = null;
            try {
                dataURI = await convertFileToBase64(imageFile);

                if (!dataURI || !dataURI.startsWith('data:')) {
                    logger.warn('Popup: convertFileToBase64 returned invalid data URI.');
                    alert('Pasted image data appears to be invalid.');
                    handleUserInput(); // Update button state
                    return;
                }

                logger.log('Popup: Image dataURI obtained, attempting to display.', { length: dataURI.length });
                const img = document.createElement('img');
                img.src = dataURI;

                // Insert the image into the contenteditable div
                const selection = window.getSelection();
                if (selection.rangeCount > 0) {
                    const range = selection.getRangeAt(0);
                    if (userInputElement.contains(range.commonAncestorContainer)) {
                        range.deleteContents();
                        range.insertNode(img);
                        // Move cursor after the image
                        range.setStartAfter(img);
                        range.collapse(true);
                        selection.removeAllRanges();
                        selection.addRange(range);
                    } else {
                        userInputElement.appendChild(img); // Fallback if selection is weird
                    }
                } else {
                    userInputElement.appendChild(img); // Fallback if no selection
                }
                logger.log('Popup: Image displayed in user input area.');

                // Now, try to process for advanced copying (blob, etc.)
                const parsed = parseDataURI(dataURI);
                if (parsed) {
                    const blob = base64ToBlob(parsed.base64Data, parsed.mimeType);
                    if (blob) {
                        locallyStagedImage = { dataURI, mimeType: parsed.mimeType, blob };
                        currentPastedImageBase64 = dataURI; // Mark that image is fully processed for copy
                        logger.log('Popup: Image fully processed and staged for copy.', { mime: parsed.mimeType });
                    } else {
                        logger.warn('Popup: Failed to create blob for image. Copy features might be limited.');
                        alert('Image displayed, but an error occurred preparing it for advanced copy (blob).');
                        // currentPastedImageBase64 remains null, locallyStagedImage is not fully set
                    }
                } else {
                    logger.warn('Popup: Failed to parse data URI for image. Copy features might be limited.');
                    alert('Image displayed, but an error occurred preparing it for advanced copy (URI parse).');
                    // currentPastedImageBase64 remains null, locallyStagedImage is not fully set
                }
            } catch (error) {
                logger.error('Popup: General error processing pasted image:', error.message, error.stack);
                alert('An error occurred while processing the pasted image.');
                // Ensure states are reset if error occurs after display but before full processing
                currentPastedImageBase64 = null;
                resetLocallyStagedImage();
                // Remove the img if it was added but processing failed catastrophically
                const potentiallyAddedImg = userInputElement.querySelector('img');
                if (potentiallyAddedImg && potentiallyAddedImg.src === dataURI) {
                    potentiallyAddedImg.remove();
                }
            }
        } else { // Not an image file
            const textData = (event.clipboardData || window.clipboardData).getData('text/plain');
            if (textData) {
                document.execCommand('insertText', false, textData);
                logger.log('Popup: Text data pasted into user input.');
            } else {
                logger.log('Popup: No image or plain text found in pasted items.');
            }
        }
        handleUserInput(); // Update button state based on content
    }

    function escapeHtml(unsafeText) {
        const div = document.createElement('div');
        div.innerText = unsafeText;
        return div.innerHTML;
    }

    async function handleCopyOutputClick() {
        const userHtmlContent = userInputElement.innerHTML; // Includes <img src="data:..."> if image is displayed
        const userTextContent = userInputElement.innerText.trim();
        const hasText = userTextContent.length > 0;
        const imageIsVisuallyPresent = !!userInputElement.querySelector('img');
        // currentPastedImageBase64 is only true if image is VISUAL AND FULLY PROCESSED (blob created)
        const canDoAdvancedImageCopy = !!currentPastedImageBase64 && !!locallyStagedImage.blob;

        if (!hasText && !imageIsVisuallyPresent) {
            logger.warn("Popup: Copy failed. No content (text or visual image)."); return;
        }
        if (!selectedSystemPromptText) {
            logger.warn("Popup: Copy failed. No system prompt selected."); return;
        }

        logger.log("Popup: Initiating copy (Step 1: Text + Embedded Image/Placeholder).");
        const htmlOutput = `<div><p><strong>System Prompt:</strong></p><pre style="white-space: pre-wrap; word-wrap: break-word;">${escapeHtml(selectedSystemPromptText)}</pre><hr><p><strong>User Input:</strong></p><div>${userHtmlContent}</div></div>`;
        let plainTextOutput = `[[[system prompt begin]]]\n\n${selectedSystemPromptText}\n\n[[[system prompt end]]]`;
        if (hasText) {
            plainTextOutput += `\n\n\n[[[user input text begin]]]\n\n${userTextContent}\n\n[[[user input text end]]]`;
        }
        if (imageIsVisuallyPresent) {
            plainTextOutput += `\n\n\n[[[user input image placeholder]]]\n\n[Image was present. ${canDoAdvancedImageCopy ? "Re-open extension to copy image separately." : "Image could not be fully processed for separate copy."}]\n\n[[[user input image placeholder end]]]`;
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
                const pendingImageData = {
                    dataURI: locallyStagedImage.dataURI,
                    mimeType: locallyStagedImage.mimeType,
                    associatedPromptTitle: selectedPromptTitleElement.textContent || "Selected Prompt"
                };
                const estimatedSize = JSON.stringify(pendingImageData).length; // Approx
                if (estimatedSize > 7500) { // Check against typical 8KB limit for item in chrome.storage
                    logger.warn(`Popup: Pending image data too large for session storage (${estimatedSize} bytes). Separate image copy will not be available.`);
                    message = "Text Copied! (Image too large for session store)";
                } else {
                    await chrome.storage.session.set({ [PENDING_IMAGE_STORAGE_KEY]: pendingImageData });
                    if (chrome.runtime.lastError) {
                        logger.error("Popup: Error saving pending image to session:", chrome.runtime.lastError.message);
                        message = "Text Copied! (Error saving image for 2nd step)";
                    } else {
                        logger.log("Popup: Image data saved to session for potential Step 2 copy.");
                        message = 'Text Copied! (Reopen for image)';
                    }
                }
            } else if (imageIsVisuallyPresent) {
                 message = 'Text Copied! (Image not fully processed for 2nd step)';
            }
            
            copyOutputButton.textContent = message;
            copyOutputButton.disabled = true;
            setTimeout(() => window.close(), 1500); // Longer timeout to read message
        } catch (error) {
            logger.error('Popup: Failed to copy (Step 1):', error.message, error.stack);
            copyOutputButton.textContent = 'Error Copying Text!';
            setTimeout(() => resetCopyButtonToDefault(!(hasText || imageIsVisuallyPresent)), 2000);
        }
    }
    
    async function setupPendingImageCopyButton() {
        const existingButton = document.getElementById('copy-pending-image-btn');
        if (existingButton) existingButton.remove();

        try {
            const result = await chrome.storage.session.get(PENDING_IMAGE_STORAGE_KEY);
            const pendingData = result[PENDING_IMAGE_STORAGE_KEY];

            if (pendingData && pendingData.dataURI && pendingData.mimeType) {
                logger.log("Popup: Pending image data found in session.", pendingData.associatedPromptTitle);
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
                                logger.log("Popup: Pending image blob copied successfully.");
                                button.textContent = 'Image Copied to Clipboard!';
                                button.disabled = true;
                                await clearPendingImageFromSession();
                                setTimeout(() => { try {button.remove();} catch(e){/* already gone */} }, 2000);
                            } catch (error) {
                                logger.error("Popup: Error copying pending image blob:", error.message, error.stack);
                                button.textContent = 'Error Copying Image!';
                            }
                        } else {
                            button.textContent = 'Error Processing Stored Image!';
                            logger.error("Popup: Failed to create blob for pending image.");
                        }
                    } else {
                        button.textContent = 'Error Parsing Stored Image Data!';
                        logger.error("Popup: Failed to parse dataURI for pending image.");
                    }
                };
                promptListView.insertBefore(button, promptListView.firstChild);
            } else {
                logger.log("Popup: No pending image data found in session or data invalid.");
            }
        } catch (error) {
            logger.error("Popup: Error accessing session storage for pending image:", error.message, error.stack);
        }
    }

    async function handleSavePromptClick() {
        const title = promptTitleInput.value.trim();
        const text = promptTextInput.value.trim();
        if (!title || !text) { alert("Title and text cannot be empty."); return; }
        currentEditingId = currentEditingId || Date.now().toString(); // Ensure ID if new
        try {
            await savePrompt({ id: currentEditingId, title, text });
            currentEditingId = null; // Reset after save
            await loadAndRenderPrompts();
            showView(views.LIST);
            await setupPendingImageCopyButton();
        } catch (error) {
            logger.error("Popup: Error saving prompt:", error.message, error.stack);
            alert(`Failed to save prompt: ${error.message}`);
        }
    }

    async function handleSelectPrompt(promptId) {
        const selected = currentPrompts.find(p => p.id === promptId);
        if (!selected) { alert("Error: Prompt not found."); return; }
        logger.log("Popup: Selected prompt ID:", promptId, " Title:", selected.title);
        selectedSystemPromptText = selected.text;
        selectedPromptTitleElement.textContent = selected.title;
        
        clearUserInputState(); 
        await clearPendingImageFromSession(); 

        showView(views.INPUT);
        userInputElement.focus();
    }

    async function handleEditPrompt(promptId) {
        const promptToEdit = currentPrompts.find(p => p.id === promptId);
        if (!promptToEdit) { alert("Error: Prompt to edit not found."); return; }
        logger.log("Popup: Edit icon clicked for prompt ID:", promptId);
        currentEditingId = promptId;
        addEditTitleElement.textContent = 'Edit Prompt';
        promptTitleInput.value = promptToEdit.title;
        promptTextInput.value = promptToEdit.text;
        
        await clearPendingImageFromSession();
        resetLocallyStagedImage();
        currentPastedImageBase64 = null; 

        showView(views.EDIT);
        promptTitleInput.focus();
    }

    async function handleDeletePrompt(promptId, promptTitle) {
        if (confirm(`Are you sure you want to delete the prompt "${promptTitle}"?`)) {
            try {
                await deletePrompt(promptId);
                await clearPendingImageFromSession(); // Clear if a delete happens
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