// popup.js

/**
 * @fileoverview Manages the AI Prompt Manager popup UI, user interactions,
 * and orchestrates calls to storage and logging utilities.
 * Assumes 'logger.js' and 'storageManager.js' are loaded beforehand,
 * making 'logger', 'getAllPrompts', 'savePrompt', and 'deletePrompt' globally available.
 */

document.addEventListener('DOMContentLoaded', () => {
    // Keep track of the currently loaded prompts and selected prompt text
    let currentPrompts = []; // Local cache of prompts, populated by getAllPrompts()
    let selectedSystemPromptText = '';
    let currentEditingId = null; // Track ID being edited, null if adding new

    // Get references to the main view containers
    const promptListView = document.getElementById('prompt-list-view');
    const promptInputView = document.getElementById('prompt-input-view');
    const addEditView = document.getElementById('add-edit-view');

    // Get references to UI elements
    const addPromptButton = document.getElementById('add-prompt-btn');
    const backToListButton = document.getElementById('back-to-list-btn');
    const cancelAddEditButton = document.getElementById('cancel-add-edit-btn');
    const copyOutputButton = document.getElementById('copy-output-btn');
    const promptListElement = document.getElementById('prompt-list');
    const selectedPromptTitleElement = document.getElementById('selected-prompt-title');
    const userInputTextArea = document.getElementById('user-input');
    const savePromptButton = document.getElementById('save-prompt-btn');
    const addEditTitleElement = document.getElementById('add-edit-title');
    const promptTitleInput = document.getElementById('prompt-title-input');
    const promptTextInput = document.getElementById('prompt-text-input');


    // --- View Management ---
    const views = {
        LIST: 'prompt-list-view',
        INPUT: 'prompt-input-view',
        EDIT: 'add-edit-view'
    };

    function showView(viewId) {
        logger.log(`Popup: Switching view to: ${viewId}`);
        Object.values(views).forEach(id => {
            const viewElement = document.getElementById(id);
            if (viewElement) {
                viewElement.style.display = 'none';
            }
        });

        const viewToShow = document.getElementById(viewId);
        if (viewToShow) {
            viewToShow.style.display = 'block';
        } else {
            logger.error("Popup: View ID not found:", viewId, "Falling back to list view.");
            document.getElementById(views.LIST).style.display = 'block'; // Fallback
        }
    }

    // --- UI Rendering ---
    function renderPromptListUI() {
        logger.log('Popup: Rendering prompt list UI with', currentPrompts.length, 'prompts.');
        promptListElement.innerHTML = ''; // Clear current list

        if (currentPrompts.length === 0) {
            const noPromptsMessage = document.createElement('li');
            noPromptsMessage.classList.add('no-prompts-message'); // For potential specific styling
            noPromptsMessage.textContent = 'No prompts yet. Click (+) to add one!';
            promptListElement.appendChild(noPromptsMessage);
            return;
        }

        // Note: Sorting is handled by getAllPrompts in storageManager.js

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
            editIcon.textContent = '\u270F\uFE0F'; // Edit icon (pencil)
            editIcon.title = `Edit "${prompt.title}"`;
            editIcon.addEventListener('click', (event) => {
                event.stopPropagation(); // Prevent list item's main click handler
                handleEditPrompt(prompt.id);
            });
            iconsSpan.appendChild(editIcon);

            const deleteIcon = document.createElement('span');
            deleteIcon.classList.add('delete-icon');
            deleteIcon.setAttribute('data-prompt-id', prompt.id);
            deleteIcon.textContent = '\uD83D\uDDD1\uFE0F'; // Delete icon (wastebasket)
            deleteIcon.title = `Delete "${prompt.title}"`;
            deleteIcon.addEventListener('click', (event) => {
                event.stopPropagation();
                handleDeletePrompt(prompt.id, prompt.title);
            });
            iconsSpan.appendChild(deleteIcon);

            listItem.appendChild(iconsSpan);

            listItem.addEventListener('click', () => {
                 handleSelectPrompt(prompt.id);
            });

            promptListElement.appendChild(listItem);
        });
         logger.log('Popup: Prompt list UI rendering complete.');
    }

    // --- Data Loading and State Update ---
    async function loadAndRenderPrompts() {
        logger.log("Popup: Initiating prompt loading and rendering.");
        try {
            // getAllPrompts is now a global function from storageManager.js
            currentPrompts = await getAllPrompts();
            renderPromptListUI();
        } catch (error) {
            // Errors from storageManager.getAllPrompts will be logged there.
            // We log an additional message here indicating failure at the popup level.
            logger.error("Popup: Failed to load and render prompts.", error.message, error.stack ? error.stack : '');
            promptListElement.innerHTML = ''; // Clear previous content
            const errorMessageItem = document.createElement('li');
            errorMessageItem.classList.add('error-message'); // For potential specific styling
            errorMessageItem.textContent = 'Error loading prompts. Check console for details.';
            promptListElement.appendChild(errorMessageItem);
        }
    }


    // --- Event Handlers ---

    function handleAddPromptClick() {
        logger.log("Popup: Add prompt button clicked.");
        currentEditingId = null;
        addEditTitleElement.textContent = 'Add New Prompt';
        promptTitleInput.value = '';
        promptTextInput.value = '';
        showView(views.EDIT);
        promptTitleInput.focus();
    }

    function handleBackToListClick() {
         logger.log("Popup: Back to list button clicked from input view.");
         selectedSystemPromptText = '';
         userInputTextArea.value = '';
         copyOutputButton.disabled = true;
         copyOutputButton.textContent = 'Copy Output';
         showView(views.LIST);
    }

    function handleCancelAddEditClick() {
         logger.log("Popup: Cancel add/edit button clicked.");
         currentEditingId = null; // Clear any editing state
         promptTitleInput.value = ''; // Clear form fields
         promptTextInput.value = '';
         showView(views.LIST);
    }

    function handleUserInput() {
        copyOutputButton.disabled = !userInputTextArea.value.trim();
        if (copyOutputButton.textContent !== 'Copy Output') {
             copyOutputButton.textContent = 'Copy Output'; // Reset if changed by copy status
        }
    }

     function handleCopyOutputClick() {
        const userText = userInputTextArea.value.trim();
        if (!userText || !selectedSystemPromptText) {
             logger.warn("Popup: Copy attempt failed: Missing user text or system prompt.", { hasUserText: !!userText, hasSystemPrompt: !!selectedSystemPromptText });
            return;
        }

        const finalOutput = `[[[system prompt begin]]]\n\n${selectedSystemPromptText}\n\n[[[system prompt end]]]\n\n\n[[[user prompt begin]]]\n\n${userText}\n\n[[[user prompt end]]]`;
        logger.log("Popup: Attempting to copy combined output to clipboard.", { outputLength: finalOutput.length });

        navigator.clipboard.writeText(finalOutput)
            .then(() => {
                logger.log("Popup: Text copied successfully to clipboard.");
                copyOutputButton.textContent = 'Copied!';
                copyOutputButton.disabled = true;
                setTimeout(() => {
                    // Consider if closing the popup is always desired, or only on success from certain views.
                    // For now, consistent behavior of closing.
                    window.close();
                }, 800);
            })
            .catch(err => {
                logger.error('Popup: Failed to copy text to clipboard:', err.message, err.stack);
                copyOutputButton.textContent = 'Error!';
                // Re-enable button after showing error, only if there's still text
                setTimeout(() => {
                     copyOutputButton.textContent = 'Copy Output';
                     copyOutputButton.disabled = !userInputTextArea.value.trim(); // Re-evaluate disable state
                }, 2000);
            });
    }

    async function handleSavePromptClick() {
        const title = promptTitleInput.value.trim();
        const text = promptTextInput.value.trim();

        if (!title || !text) {
            logger.warn("Popup: Save attempt failed: Title or text is empty.");
            alert("Prompt title and text cannot be empty."); // User-friendly feedback
            return;
        }

        const mode = currentEditingId ? 'Update' : 'Add';
        logger.log(`Popup: Save button clicked. Mode: ${mode}. Title: "${title}"`);

        const promptId = currentEditingId || Date.now().toString();
        const promptToSave = { id: promptId, title, text };

        logger.log(`Popup: Preparing to ${mode.toLowerCase()} prompt with ID: ${promptId}`, promptToSave);

        try {
            // savePrompt is now a global function from storageManager.js
            await savePrompt(promptToSave);
            logger.log(`Popup: Prompt ${mode.toLowerCase()}d successfully (ID: ${promptToSave.id}). Refreshing list.`);

            currentEditingId = null; // Reset editing ID
            promptTitleInput.value = ''; // Clear form
            promptTextInput.value = '';

            await loadAndRenderPrompts(); // Refresh list from storage
            showView(views.LIST); // Return to list view

        } catch (error) {
            // Errors from storageManager.savePrompt will be logged there.
            // We log an additional message here and show an alert to the user.
            logger.error(`Popup: Error ${mode.toLowerCase()}ing prompt:`, error.message, error.stack ? error.stack : '');
            // Display specific errors (like chunk too large, quota exceeded) from storageManager.savePrompt
            alert(`Failed to save prompt: ${error.message}`); // Show error from storageManager to user
            // Do not switch view on error, allow user to correct or retry
        }
    }

    // --- Actions Triggered from List Items ---

    function handleSelectPrompt(promptId) {
         const selectedPrompt = currentPrompts.find(p => p.id === promptId);
         if (!selectedPrompt) {
             logger.error("Popup: Select failed: Clicked prompt not found in current list. ID:", promptId);
             alert("Error: Could not find the selected prompt. The list might be out of date.");
             return;
         }

         logger.log("Popup: Selected prompt ID:", promptId, " Title:", selectedPrompt.title);
         selectedSystemPromptText = selectedPrompt.text;
         selectedPromptTitleElement.textContent = selectedPrompt.title;
         userInputTextArea.value = '';
         copyOutputButton.disabled = true;
         copyOutputButton.textContent = 'Copy Output';
         showView(views.INPUT);
         userInputTextArea.focus();
    }

     function handleEditPrompt(promptId) {
         const promptToEdit = currentPrompts.find(p => p.id === promptId);
         if (!promptToEdit) {
             logger.error("Popup: Edit failed: Prompt to edit not found. ID:", promptId);
             alert("Error: Could not find the prompt to edit. The list might be out of date.");
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

         // Confirm with user before deleting
         if (confirm(`Are you sure you want to delete the prompt "${promptTitle}"?`)) {
             logger.log("Popup: User confirmed deletion for prompt ID:", promptId);
             try {
                 // deletePrompt is now a global function from storageManager.js
                 await deletePrompt(promptId);
                 logger.log(`Popup: Deletion successful for prompt ID: ${promptId}. Refreshing list.`);

                 await loadAndRenderPrompts(); // Refresh list from storage
                 // No view change needed if already on list view.
                 // If deletion happened from another view (not currently possible), this would be fine.
             } catch (error) {
                 // Errors from storageManager.deletePrompt will be logged there.
                 logger.error("Popup: Error deleting prompt:", error.message, error.stack ? error.stack : '');
                 alert(`Failed to delete prompt: ${error.message}`); // Show error from storageManager
             }
         } else {
              logger.log("Popup: User cancelled deletion for prompt ID:", promptId);
         }
     }


    // --- Initialization ---
    async function initializePopup() {
        logger.log("Popup: Initializing.");

        // Attach primary event listeners that don't depend on dynamic content
        addPromptButton.addEventListener('click', handleAddPromptClick);
        backToListButton.addEventListener('click', handleBackToListClick);
        cancelAddEditButton.addEventListener('click', handleCancelAddEditClick);
        copyOutputButton.addEventListener('click', handleCopyOutputClick);
        userInputTextArea.addEventListener('input', handleUserInput); // Handles enabling/disabling copy button
        savePromptButton.addEventListener('click', handleSavePromptClick);

        // List item click/edit/delete listeners are added dynamically in renderPromptListUI

        await loadAndRenderPrompts(); // Load data and render the initial list
        showView(views.LIST);        // Ensure the list view is shown first

        logger.log("Popup: Initialization complete.");
    }

    initializePopup(); // Start the application logic

}); // End of DOMContentLoaded