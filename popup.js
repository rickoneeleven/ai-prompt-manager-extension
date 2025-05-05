// --- Storage Constants ---
const STORAGE_KEY = 'userPrompts';

// --- Storage Utility Functions ---

/**
 * Retrieves prompts from chrome.storage.sync.
 * @returns {Promise<Array<object>>} A promise that resolves with the array of prompts, or an empty array if none are found or an error occurs.
 */
async function getPrompts() {
    try {
        const result = await chrome.storage.sync.get([STORAGE_KEY]);
        return Array.isArray(result[STORAGE_KEY]) ? result[STORAGE_KEY] : [];
    } catch (error) {
        console.error("Error retrieving prompts:", error);
        return [];
    }
}
// Make getPrompts accessible from console for debugging (optional)
window.getPrompts = getPrompts;

/**
 * Saves the provided array of prompts to chrome.storage.sync.
 * @param {Array<object>} promptsArray The array of prompt objects to save.
 * @returns {Promise<void>} A promise that resolves when saving is complete, or rejects on error.
 */
async function savePrompts(promptsArray) {
    try {
        await chrome.storage.sync.set({ [STORAGE_KEY]: promptsArray });
        console.log("Prompts saved successfully.");
    } catch (error) {
        console.error("Error saving prompts:", error);
        throw error;
    }
}
// Make savePrompts accessible from console for debugging
window.savePrompts = savePrompts;


// --- Main Popup Logic ---
document.addEventListener('DOMContentLoaded', () => {
    // Keep track of the currently loaded prompts and selected prompt text
    let currentPrompts = [];
    let selectedSystemPromptText = ''; // Variable to store the text of the selected prompt

    // Get references to the main view containers
    const promptListView = document.getElementById('prompt-list-view');
    const promptInputView = document.getElementById('prompt-input-view');
    const addEditView = document.getElementById('add-edit-view');

    // Get references to navigation/action buttons and interactive elements
    const addPromptBtn = document.getElementById('add-prompt-btn');
    const backToListBtn = document.getElementById('back-to-list-btn');
    const cancelAddEditBtn = document.getElementById('cancel-add-edit-btn');
    const copyOutputBtn = document.getElementById('copy-output-btn');
    const promptListUl = document.getElementById('prompt-list');
    const selectedPromptTitleSpan = document.getElementById('selected-prompt-title');
    const userInputTextarea = document.getElementById('user-input');
    const savePromptBtn = document.getElementById('save-prompt-btn'); // Ref for Add/Edit view
    const addEditTitle = document.getElementById('add-edit-title'); // Ref for Add/Edit view
    const promptTitleInput = document.getElementById('prompt-title-input'); // Ref for Add/Edit view
    const promptTextInput = document.getElementById('prompt-text-input'); // Ref for Add/Edit view


    // --- View Switching Logic ---
    /**
     * Shows a specific view (by ID) and hides all others.
     * @param {string} viewId The ID of the view container element to show.
     */
    function showView(viewId) {
        promptListView.style.display = 'none';
        promptInputView.style.display = 'none';
        addEditView.style.display = 'none';
        const viewToShow = document.getElementById(viewId);
        if (viewToShow) {
            viewToShow.style.display = 'block';
        } else {
            console.error("View with ID not found:", viewId);
            promptListView.style.display = 'block';
        }
    }

    // --- Prompt List Rendering ---
    /**
     * Fetches prompts from storage and renders them into the #prompt-list ul.
     */
    async function renderPromptList() {
        try {
            currentPrompts = await getPrompts();
            promptListUl.innerHTML = '';

            if (currentPrompts.length === 0) {
                promptListUl.innerHTML = '<li class="no-prompts-message">No prompts yet. Click (+) to add one!</li>';
                return;
            }

            currentPrompts.forEach(prompt => {
                const listItem = document.createElement('li');
                listItem.setAttribute('data-prompt-id', prompt.id);

                const titleSpan = document.createElement('span');
                titleSpan.classList.add('prompt-title');
                titleSpan.textContent = prompt.title;

                const iconsSpan = document.createElement('span');
                iconsSpan.classList.add('action-icons');

                const editIcon = document.createElement('span');
                editIcon.classList.add('edit-icon');
                editIcon.setAttribute('data-prompt-id', prompt.id);
                editIcon.textContent = '✏️';
                editIcon.title = "Edit prompt";

                const deleteIcon = document.createElement('span');
                deleteIcon.classList.add('delete-icon');
                deleteIcon.setAttribute('data-prompt-id', prompt.id);
                deleteIcon.textContent = '🗑️';
                deleteIcon.title = "Delete prompt";

                iconsSpan.appendChild(editIcon);
                iconsSpan.appendChild(deleteIcon);

                listItem.appendChild(titleSpan);
                listItem.appendChild(iconsSpan);

                promptListUl.appendChild(listItem);
            });
        } catch (error) {
            console.error("Failed to render prompt list:", error);
            promptListUl.innerHTML = '<li class="error-message">Error loading prompts.</li>';
        }
    }


    // --- Event Listeners for Navigation ---

    // Add New Prompt Button
    addPromptBtn.addEventListener('click', () => {
        addEditTitle.textContent = 'Add New Prompt';
        promptTitleInput.value = '';
        promptTextInput.value = '';
        savePromptBtn.removeAttribute('data-editing-id'); // Ensure not in edit mode
        showView('add-edit-view');
    });

    // Back to List Button (from Input View)
    backToListBtn.addEventListener('click', () => {
        selectedSystemPromptText = '';
        userInputTextarea.value = '';
        copyOutputBtn.disabled = true;
        copyOutputBtn.textContent = 'Copy Output'; // Reset button text in case it was 'Copied!' or 'Error!'
        showView('prompt-list-view');
    });

    // Cancel Add/Edit Button
    cancelAddEditBtn.addEventListener('click', () => {
        showView('prompt-list-view');
    });


    // --- Event Listener for Prompt List Clicks (Selection, Edit, Delete) ---
    promptListUl.addEventListener('click', (event) => {
        const targetElement = event.target;
        const listItem = targetElement.closest('li[data-prompt-id]');

        if (!listItem) return;

        const promptId = listItem.dataset.promptId;
        const clickedPrompt = currentPrompts.find(p => p.id === promptId);

        if (!clickedPrompt) {
            console.error("Clicked prompt not found in currentPrompts array. ID:", promptId);
            return;
        }

        if (targetElement.closest('.edit-icon')) {
            console.log("Edit icon clicked for prompt ID:", promptId);
            // TODO: Implement navigation to edit view (Stage 14)
        } else if (targetElement.closest('.delete-icon')) {
            console.log("Delete icon clicked for prompt ID:", promptId);
            // TODO: Implement deletion logic (Stage 16)
        } else {
            // --- Select Action ---
            console.log("Selected prompt ID:", promptId, " Title:", clickedPrompt.title);
            selectedSystemPromptText = clickedPrompt.text;
            selectedPromptTitleSpan.textContent = clickedPrompt.title;
            userInputTextarea.value = '';
            userInputTextarea.focus();
            copyOutputBtn.disabled = true;
            copyOutputBtn.textContent = 'Copy Output'; // Reset button text
            showView('prompt-input-view');
        }
    });


    // --- Event Listener for User Input Textarea ---
    userInputTextarea.addEventListener('input', () => {
        // Enable copy button only if textarea is not empty (after trimming whitespace)
        copyOutputBtn.disabled = !userInputTextarea.value.trim();
    });


    // --- Event Listener for Copy Output Button ---
    copyOutputBtn.addEventListener('click', () => {
        const userText = userInputTextarea.value.trim(); // Get trimmed user input

        if (!userText || !selectedSystemPromptText) {
            console.warn("Copy clicked but user text or system prompt is missing.");
            return; // Should not happen if button enabling logic is correct, but safe check
        }

        // Construct the final output string using the required format
        const finalOutput = `[[[system prompt begin]]]

${selectedSystemPromptText}

[[[system prompt end]]]


[[[user prompt begin]]]

${userText}

[[[user prompt end]]]`;

        // --- Clipboard API Integration ---
        navigator.clipboard.writeText(finalOutput)
            .then(() => {
                // Success! Provide feedback
                console.log("Text successfully copied to clipboard.");
                const originalButtonText = 'Copy Output'; // Define original text explicitly
                copyOutputBtn.textContent = 'Copied!';
                copyOutputBtn.disabled = true; // Briefly disable after copy

                // Optional: Close popup after a short delay
                setTimeout(() => {
                    window.close(); // Close the popup window
                }, 1000); // Close after 1 second

            })
            .catch(err => {
                // Failure! Log error and provide feedback
                console.error('Failed to copy text: ', err);
                const originalButtonText = 'Copy Output';
                copyOutputBtn.textContent = 'Error!';
                // Consider showing an error message element if needed
                setTimeout(() => {
                    copyOutputBtn.textContent = originalButtonText; // Revert button text
                    // Re-enable button only if there's still text
                    copyOutputBtn.disabled = !userInputTextarea.value.trim();
                }, 2000); // Show error for 2 seconds
            });
    });


    // --- Initialization ---
    /**
     * Initializes the popup by rendering the prompt list and showing the list view.
     */
    async function initializePopup() {
        await renderPromptList(); // Load and display prompts first
        showView('prompt-list-view'); // Then show the list view
    }

    initializePopup(); // Call the async initialization function

}); // End of DOMContentLoaded