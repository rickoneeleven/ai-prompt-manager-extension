document.addEventListener('DOMContentLoaded', () => {
    let currentPrompts = [];
    let selectedSystemPromptText = '';
    let currentEditingId = null;
    let currentPastedImageBase64 = null;

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

    function showView(viewId) {
        logger.log(`Popup: Switching view to: ${viewId}`);
        Object.values(views).forEach(id => {
            const viewElement = document.getElementById(id);
            if (viewElement) viewElement.style.display = 'none';
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
            editIcon.setAttribute('data-prompt-id', prompt.id);
            editIcon.textContent = '\u270F\uFE0F';
            editIcon.title = `Edit "${prompt.title}"`;
            editIcon.addEventListener('click', (event) => {
                event.stopPropagation();
                handleEditPrompt(prompt.id);
            });
            iconsSpan.appendChild(editIcon);
            const deleteIcon = document.createElement('span');
            deleteIcon.classList.add('delete-icon');
            deleteIcon.setAttribute('data-prompt-id', prompt.id);
            deleteIcon.textContent = '\uD83D\uDDD1\uFE0F';
            deleteIcon.title = `Delete "${prompt.title}"`;
            deleteIcon.addEventListener('click', (event) => {
                event.stopPropagation();
                handleDeletePrompt(prompt.id, prompt.title);
            });
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
            logger.error("Popup: Failed to load and render prompts.", error.message, error.stack || '');
            promptListElement.innerHTML = '';
            const errorMessageItem = document.createElement('li');
            errorMessageItem.textContent = 'Error loading prompts. Check console for details.';
            promptListElement.appendChild(errorMessageItem);
        }
    }

    function handleAddPromptClick() {
        logger.log("Popup: Add prompt button clicked.");
        currentEditingId = null;
        addEditTitleElement.textContent = 'Add New Prompt';
        promptTitleInput.value = '';
        promptTextInput.value = '';
        showView(views.EDIT);
        promptTitleInput.focus();
    }

    function clearUserInputState() {
        userInputElement.innerHTML = '';
        currentPastedImageBase64 = null;
        copyOutputButton.disabled = true;
        copyOutputButton.textContent = 'Copy Output';
    }

    function handleBackToListClick() {
        logger.log("Popup: Back to list button clicked from input view.");
        selectedSystemPromptText = '';
        clearUserInputState();
        showView(views.LIST);
    }

    function handleCancelAddEditClick() {
        logger.log("Popup: Cancel add/edit button clicked.");
        currentEditingId = null;
        promptTitleInput.value = '';
        promptTextInput.value = '';
        showView(views.LIST);
    }

    function handleUserInput() {
        const hasText = userInputElement.innerText.trim().length > 0;
        const imageElementInEditor = userInputElement.querySelector('img');

        if (!imageElementInEditor && currentPastedImageBase64) {
            logger.log('Popup: Image element visually removed from editor. Clearing stored image data.');
            currentPastedImageBase64 = null;
        }
        copyOutputButton.disabled = !(hasText || currentPastedImageBase64);
        if (copyOutputButton.textContent !== 'Copy Output') {
            copyOutputButton.textContent = 'Copy Output';
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

    async function handlePasteOnUserInput(event) {
        logger.log('Popup: Paste event detected on user input.');
        event.preventDefault();
        const items = (event.clipboardData || window.clipboardData).items;
        let imageFile = null;

        for (let i = 0; i < items.length; i++) {
            if (items[i].type.indexOf('image') !== -1) {
                imageFile = items[i].getAsFile();
                break;
            }
        }

        if (imageFile) {
            logger.log('Popup: Image file found in pasted items.', { name: imageFile.name, type: imageFile.type, size: imageFile.size });
            try {
                const base64String = await convertFileToBase64(imageFile);
                currentPastedImageBase64 = base64String;
                logger.log('Popup: Image converted to base64.', { length: base64String.length });

                const existingImageElement = userInputElement.querySelector('img');
                if (existingImageElement) existingImageElement.remove();

                const img = document.createElement('img');
                img.src = base64String;

                const selection = window.getSelection();
                if (selection.rangeCount > 0) {
                    const range = selection.getRangeAt(0);
                    if (userInputElement.contains(range.commonAncestorContainer)) {
                        range.deleteContents();
                        range.insertNode(img);
                        range.setStartAfter(img);
                        range.collapse(true);
                        selection.removeAllRanges();
                        selection.addRange(range);
                    } else {
                        userInputElement.appendChild(img);
                    }
                } else {
                    userInputElement.appendChild(img);
                }
                logger.log('Popup: Image displayed in user input area.');
            } catch (error) {
                logger.error('Popup: Error processing pasted image:', error.message, error.stack || '');
                alert('Failed to process pasted image.');
                currentPastedImageBase64 = null;
            }
        } else {
            const textData = (event.clipboardData || window.clipboardData).getData('text/plain');
            if (textData) {
                document.execCommand('insertText', false, textData);
                logger.log('Popup: Text data pasted into user input.');
            } else {
                logger.log('Popup: No image or plain text found in pasted items.');
            }
        }
        handleUserInput();
    }

    function escapeHtml(unsafeText) {
        const div = document.createElement('div');
        div.innerText = unsafeText;
        return div.innerHTML;
    }

    async function handleCopyOutputClick() {
        const userHtmlContent = userInputElement.innerHTML;
        const userTextContent = userInputElement.innerText.trim();
        const hasContentToCopy = userTextContent || currentPastedImageBase64;

        if (!hasContentToCopy || !selectedSystemPromptText) {
            logger.warn("Popup: Copy attempt failed. Conditions not met.", {
                hasUserContent: hasContentToCopy,
                hasSystemPrompt: !!selectedSystemPromptText
            });
            return;
        }

        const htmlOutputString = `
            <div>
                <p><strong>System Prompt:</strong></p>
                <pre style="white-space: pre-wrap; word-wrap: break-word;">${escapeHtml(selectedSystemPromptText)}</pre>
                <hr>
                <p><strong>User Input:</strong></p>
                <div>${userHtmlContent}</div>
            </div>`;

        let plainTextOutputString = `[[[system prompt begin]]]\n\n${selectedSystemPromptText}\n\n[[[system prompt end]]]`;
        if (userTextContent) {
            plainTextOutputString += `\n\n\n[[[user input text begin]]]\n\n${userTextContent}\n\n[[[user input text end]]]`;
        }
        if (currentPastedImageBase64) {
            plainTextOutputString += `\n\n\n[[[user input image begin]]]\n\n${currentPastedImageBase64}\n\n[[[user input image end]]]`;
        }

        logger.log("Popup: Attempting to copy HTML & Plain Text output to clipboard.", {
            htmlLength: htmlOutputString.length,
            plainTextLength: plainTextOutputString.length,
            hasImage: !!currentPastedImageBase64
        });

        try {
            const clipboardItem = new ClipboardItem({
                'text/html': new Blob([htmlOutputString], { type: 'text/html' }),
                'text/plain': new Blob([plainTextOutputString], { type: 'text/plain' })
                // DELIBERATELY OMITTING direct image/* blob here.
                // The image is embedded in text/html via <img> data: URL,
                // and as base64 in text/plain.
            });
            await navigator.clipboard.write([clipboardItem]);

            logger.log("Popup: HTML and Plain Text content copied successfully to clipboard.");
            copyOutputButton.textContent = 'Copied!';
            copyOutputButton.disabled = true;
            setTimeout(() => window.close(), 800);

        } catch (error) {
            logger.error('Popup: Failed to copy content to clipboard:', error.message, error.stack || '');
            copyOutputButton.textContent = 'Error!';
            setTimeout(() => {
                copyOutputButton.textContent = 'Copy Output';
                handleUserInput();
            }, 2000);
        }
    }

    async function handleSavePromptClick() {
        const title = promptTitleInput.value.trim();
        const text = promptTextInput.value.trim();
        if (!title || !text) {
            logger.warn("Popup: Save attempt failed: Title or text is empty.");
            alert("Prompt title and text cannot be empty.");
            return;
        }
        const mode = currentEditingId ? 'Update' : 'Add';
        logger.log(`Popup: Save button clicked. Mode: ${mode}. Title: "${title}"`);
        const promptId = currentEditingId || Date.now().toString();
        const promptToSave = { id: promptId, title, text };
        logger.log(`Popup: Preparing to ${mode.toLowerCase()} prompt with ID: ${promptId}`, promptToSave);
        try {
            await savePrompt(promptToSave);
            logger.log(`Popup: Prompt ${mode.toLowerCase()}d successfully (ID: ${promptToSave.id}). Refreshing list.`);
            currentEditingId = null;
            promptTitleInput.value = '';
            promptTextInput.value = '';
            await loadAndRenderPrompts();
            showView(views.LIST);
        } catch (error) {
            logger.error(`Popup: Error ${mode.toLowerCase()}ing prompt:`, error.message, error.stack || '');
            alert(`Failed to save prompt: ${error.message}`);
        }
    }

    function handleSelectPrompt(promptId) {
        const selectedPrompt = currentPrompts.find(p => p.id === promptId);
        if (!selectedPrompt) {
            logger.error("Popup: Select failed: Clicked prompt not found. ID:", promptId);
            alert("Error: Could not find the selected prompt.");
            return;
        }
        logger.log("Popup: Selected prompt ID:", promptId, " Title:", selectedPrompt.title);
        selectedSystemPromptText = selectedPrompt.text;
        selectedPromptTitleElement.textContent = selectedPrompt.title;
        clearUserInputState();
        showView(views.INPUT);
        userInputElement.focus();
    }

    function handleEditPrompt(promptId) {
        const promptToEdit = currentPrompts.find(p => p.id === promptId);
        if (!promptToEdit) {
            logger.error("Popup: Edit failed: Prompt to edit not found. ID:", promptId);
            alert("Error: Could not find the prompt to edit.");
            return;
        }
        logger.log("Popup: Edit icon clicked for prompt ID:", promptId);
        currentEditingId = promptId;
        addEditTitleElement.textContent = 'Edit Prompt';
        promptTitleInput.value = promptToEdit.title;
        promptTextInput.value = promptToEdit.text;
        showView(views.EDIT);
        promptTitleInput.focus();
    }

    async function handleDeletePrompt(promptId, promptTitle) {
        logger.log("Popup: Delete icon clicked for prompt ID:", promptId, "Title:", promptTitle);
        if (confirm(`Are you sure you want to delete the prompt "${promptTitle}"?`)) {
            logger.log("Popup: User confirmed deletion for prompt ID:", promptId);
            try {
                await deletePrompt(promptId);
                logger.log(`Popup: Deletion successful for prompt ID: ${promptId}. Refreshing list.`);
                await loadAndRenderPrompts();
            } catch (error) {
                logger.error("Popup: Error deleting prompt:", error.message, error.stack || '');
                alert(`Failed to delete prompt: ${error.message}`);
            }
        } else {
            logger.log("Popup: User cancelled deletion for prompt ID:", promptId);
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
        showView(views.LIST);
        logger.log("Popup: Initialization complete.");
    }

    initializePopup();
});