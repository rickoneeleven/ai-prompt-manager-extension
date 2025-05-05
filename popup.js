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
        // If result.userPrompts exists and is an array, return it, otherwise return empty array
        return Array.isArray(result[STORAGE_KEY]) ? result[STORAGE_KEY] : [];
    } catch (error) {
        console.error("Error retrieving prompts:", error);
        return []; // Return empty array on error
    }
}

/**
 * Saves the provided array of prompts to chrome.storage.sync.
 * @param {Array<object>} promptsArray The array of prompt objects to save.
 * @returns {Promise<void>} A promise that resolves when saving is complete, or rejects on error.
 */
async function savePrompts(promptsArray) {
    try {
        await chrome.storage.sync.set({ [STORAGE_KEY]: promptsArray });
        console.log("Prompts saved successfully."); // Optional: for debugging
    } catch (error) {
        console.error("Error saving prompts:", error);
        // Re-throw the error if you want calling functions to handle it
        throw error;
    }
}


// --- Main Popup Logic ---
document.addEventListener('DOMContentLoaded', () => {
    // Keep track of the currently loaded prompts and selected prompt text
    let currentPrompts = [];
    let selectedSystemPromptText = ''; // Variable to store the text of the selected prompt

    // Get references to the main view containers
    const promptListView = document.getElementById('prompt-list-view');
    const promptInputView = document.getElementById('prompt-input-view');
    const addEditView = document.getElementById('add-edit-view');

    // Get references to navigation/action buttons
    const addPromptBtn = document.getElementById('add-prompt-btn');
    const backToListBtn = document.getElementById('back-to-list-btn');
    const cancelAddEditBtn = document.getElementById('cancel-add-edit-btn');
    const copyOutputBtn = document.getElementById('copy-output-btn'); // Added reference

    // Get references to list and input view elements
    const promptListUl = document.getElementById('prompt-list');
    const selectedPromptTitleSpan = document.getElementById('selected-prompt-title'); // Added reference
    const userInputTextarea = document.getElementById('user-input'); // Added reference

    // --- View Switching Logic ---
    /**
     * Shows a specific view (by ID) and hides all others.
     * @param {string} viewId The ID of the view container element to show.
     */
    function showView(viewId) {
        // Hide all views first
        promptListView.style.display = 'none';
        promptInputView.style.display = 'none';
        addEditView.style.display = 'none';

        // Show the requested view
        const viewToShow = document.getElementById(viewId);
        if (viewToShow) {
            viewToShow.style.display = 'block'; // Or 'flex' etc. if you change CSS later
        } else {
            console.error("View with ID not found:", viewId);
            // Fallback to default view if error
            promptListView.style.display = 'block';
        }
    }

    // --- Prompt List Rendering ---
    /**
     * Fetches prompts from storage and renders them into the #prompt-list ul.
     */
    async function renderPromptList() {
        try {
            currentPrompts = await getPrompts(); // Fetch and store prompts locally
            promptListUl.innerHTML = ''; // Clear existing list items

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
        document.getElementById('add-edit-title').textContent = 'Add New Prompt';
        document.getElementById('prompt-title-input').value = '';
        document.getElementById('prompt-text-input').value = '';
        document.getElementById('save-prompt-btn').removeAttribute('data-editing-id');
        showView('add-edit-view');
    });

    // Back to List Button (from Input View)
    backToListBtn.addEventListener('click', () => {
        selectedSystemPromptText = ''; // Clear selected prompt text when going back
        userInputTextarea.value = ''; // Clear textarea when going back
        copyOutputBtn.disabled = true; // Disable copy button
        showView('prompt-list-view');
    });

    // Cancel Add/Edit Button
    cancelAddEditBtn.addEventListener('click', () => {
        // No data changed, just switch view
        showView('prompt-list-view');
    });


    // --- Event Listener for Prompt List Clicks (Selection, Edit, Delete) ---
    promptListUl.addEventListener('click', (event) => {
        const targetElement = event.target;
        // Find the closest ancestor LI element with the data-prompt-id attribute
        const listItem = targetElement.closest('li[data-prompt-id]');

        if (!listItem) return; // Exit if click wasn't inside a relevant list item

        const promptId = listItem.dataset.promptId;
        // Find the corresponding prompt object from our cached array
        const clickedPrompt = currentPrompts.find(p => p.id === promptId);

        if (!clickedPrompt) {
            console.error("Clicked prompt not found in currentPrompts array. ID:", promptId);
            return; // Exit if prompt data inconsistency
        }

        // Check if an action icon was clicked within the list item
        if (targetElement.closest('.edit-icon')) {
            // --- Edit Action (Phase 3) ---
            console.log("Edit icon clicked for prompt ID:", promptId);
            // TODO: Implement navigation to edit view (Stage 14)
            // Will involve:
            // - Setting add/edit view title to "Edit Prompt"
            // - Populating title/text inputs with clickedPrompt.title/text
            // - Storing promptId (e.g., on save button) to know we are editing
            // - Calling showView('add-edit-view')

        } else if (targetElement.closest('.delete-icon')) {
            // --- Delete Action (Phase 3) ---
            console.log("Delete icon clicked for prompt ID:", promptId);
            // TODO: Implement deletion logic (Stage 16)
            // Will involve:
            // - Showing a confirmation dialog (confirm())
            // - If confirmed:
            //    - Filtering currentPrompts to remove the one with promptId
            //    - Calling savePrompts() with the filtered array
            //    - Calling renderPromptList() to update the UI

        } else {
            // --- Select Action (Assume click on title or li background) ---
            console.log("Selected prompt ID:", promptId, " Title:", clickedPrompt.title);

            // Store the system prompt text for later use in copying
            selectedSystemPromptText = clickedPrompt.text;

            // Update the UI in the input view
            selectedPromptTitleSpan.textContent = clickedPrompt.title;
            userInputTextarea.value = ''; // Clear any previous user input
            userInputTextarea.focus(); // Focus the textarea for immediate typing
            copyOutputBtn.disabled = true; // Disable copy button initially (until user types)

            // Switch to the input view
            showView('prompt-input-view');
        }
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