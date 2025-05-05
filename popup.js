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
    let selectedSystemPromptText = '';

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
    const savePromptBtn = document.getElementById('save-prompt-btn');
    const addEditTitle = document.getElementById('add-edit-title');
    const promptTitleInput = document.getElementById('prompt-title-input');
    const promptTextInput = document.getElementById('prompt-text-input');


    // --- View Switching Logic ---
    function showView(viewId) {
        promptListView.style.display = 'none';
        promptInputView.style.display = 'none';
        addEditView.style.display = 'none';
        const viewToShow = document.getElementById(viewId);
        if (viewToShow) {
            viewToShow.style.display = 'block';
        } else {
            console.error("View with ID not found:", viewId);
            promptListView.style.display = 'block'; // Fallback
        }
    }

    // --- Prompt List Rendering ---
    async function renderPromptList() {
        try {
            currentPrompts = await getPrompts(); // Update local cache
            promptListUl.innerHTML = ''; // Clear current list

            if (currentPrompts.length === 0) {
                promptListUl.innerHTML = '<li class="no-prompts-message">No prompts yet. Click (+) to add one!</li>';
                return;
            }

            // Sort prompts alphabetically by title for consistency
            currentPrompts.sort((a, b) => a.title.localeCompare(b.title));

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


    // --- Navigation Event Listeners ---

    // Add New Prompt Button
    addPromptBtn.addEventListener('click', () => {
        addEditTitle.textContent = 'Add New Prompt';
        promptTitleInput.value = ''; // Clear fields
        promptTextInput.value = '';
        savePromptBtn.removeAttribute('data-editing-id'); // Ensure not in edit mode
        promptTitleInput.focus(); // Focus title input
        showView('add-edit-view');
    });

    // Back to List Button (from Input View)
    backToListBtn.addEventListener('click', () => {
        selectedSystemPromptText = '';
        userInputTextarea.value = '';
        copyOutputBtn.disabled = true;
        copyOutputBtn.textContent = 'Copy Output';
        showView('prompt-list-view');
    });

    // Cancel Add/Edit Button
    cancelAddEditBtn.addEventListener('click', () => {
        showView('prompt-list-view'); // Simply return to list
    });


    // --- Core Action Event Listeners ---

    // Prompt List Clicks (Selection, Edit, Delete)
    promptListUl.addEventListener('click', async (event) => { // Made async for delete
        const targetElement = event.target;
        const listItem = targetElement.closest('li[data-prompt-id]');
        if (!listItem) return;

        const promptId = listItem.dataset.promptId;
        const clickedPrompt = currentPrompts.find(p => p.id === promptId);
        if (!clickedPrompt) {
            console.error("Clicked prompt not found. ID:", promptId);
            return;
        }

        // --- EDIT ACTION ---
        if (targetElement.closest('.edit-icon')) {
            console.log("Edit icon clicked for prompt ID:", promptId);
            addEditTitle.textContent = 'Edit Prompt';
            promptTitleInput.value = clickedPrompt.title; // Populate form
            promptTextInput.value = clickedPrompt.text;
            savePromptBtn.setAttribute('data-editing-id', promptId); // Set mode to Edit
            promptTitleInput.focus(); // Focus title input
            showView('add-edit-view');

        // --- DELETE ACTION ---
        } else if (targetElement.closest('.delete-icon')) {
            console.log("Delete icon clicked for prompt ID:", promptId);
            if (confirm(`Are you sure you want to delete the prompt "${clickedPrompt.title}"?`)) {
                try {
                    const updatedPrompts = currentPrompts.filter(p => p.id !== promptId);
                    await savePrompts(updatedPrompts); // Save the filtered array
                    await renderPromptList(); // Refresh the list display
                    console.log("Prompt deleted successfully.");
                    // Optional: Add visual feedback for deletion
                } catch (error) {
                    console.error("Error deleting prompt:", error);
                    alert("Failed to delete prompt. See console for details."); // User feedback
                }
            }

        // --- SELECT ACTION ---
        } else {
            console.log("Selected prompt ID:", promptId, " Title:", clickedPrompt.title);
            selectedSystemPromptText = clickedPrompt.text;
            selectedPromptTitleSpan.textContent = clickedPrompt.title;
            userInputTextarea.value = '';
            userInputTextarea.focus();
            copyOutputBtn.disabled = true;
            copyOutputBtn.textContent = 'Copy Output';
            showView('prompt-input-view');
        }
    });

    // User Input Textarea (for enabling copy button)
    userInputTextarea.addEventListener('input', () => {
        copyOutputBtn.disabled = !userInputTextarea.value.trim();
    });

    // Copy Output Button
    copyOutputBtn.addEventListener('click', () => {
        const userText = userInputTextarea.value.trim();
        if (!userText || !selectedSystemPromptText) return;

        const finalOutput = `[[[system prompt begin]]]\n\n${selectedSystemPromptText}\n\n[[[system prompt end]]]\n\n\n[[[user prompt begin]]]\n\n${userText}\n\n[[[user prompt end]]]`;

        navigator.clipboard.writeText(finalOutput)
            .then(() => {
                copyOutputBtn.textContent = 'Copied!';
                copyOutputBtn.disabled = true;
                setTimeout(() => window.close(), 1000);
            })
            .catch(err => {
                console.error('Failed to copy text: ', err);
                copyOutputBtn.textContent = 'Error!';
                setTimeout(() => {
                     copyOutputBtn.textContent = 'Copy Output';
                     copyOutputBtn.disabled = !userInputTextarea.value.trim(); // Re-enable if there's text
                }, 2000);
            });
    });

    // Save Prompt Button (Handles BOTH Add New and Update Existing)
    savePromptBtn.addEventListener('click', async () => {
        const title = promptTitleInput.value.trim();
        const text = promptTextInput.value.trim();
        const editingId = savePromptBtn.getAttribute('data-editing-id');

        // Basic Validation
        if (!title || !text) {
            alert("Prompt title and text cannot be empty.");
            return;
        }

        try {
            let updatedPrompts = await getPrompts(); // Get current prompts

            if (editingId) {
                // --- UPDATE existing prompt ---
                const promptIndex = updatedPrompts.findIndex(p => p.id === editingId);
                if (promptIndex > -1) {
                    updatedPrompts[promptIndex] = { ...updatedPrompts[promptIndex], title, text };
                    console.log("Updating prompt ID:", editingId);
                } else {
                     throw new Error("Prompt to update not found."); // Should not happen
                }
            } else {
                // --- ADD new prompt ---
                const newPrompt = {
                    id: Date.now().toString(), // Simple timestamp ID
                    title: title,
                    text: text
                };
                updatedPrompts.push(newPrompt);
                console.log("Adding new prompt:", newPrompt.title);
            }

            await savePrompts(updatedPrompts); // Save the modified array
            await renderPromptList(); // Refresh the list view
            showView('prompt-list-view'); // Go back to the list view

        } catch (error) {
            console.error("Error saving prompt:", error);
            alert("Failed to save prompt. See console for details."); // User feedback
        } finally {
            // Clean up editing state regardless of success/failure
            savePromptBtn.removeAttribute('data-editing-id');
        }
    });


    // --- Initialization ---
    async function initializePopup() {
        await renderPromptList(); // Load and display prompts first
        showView('prompt-list-view'); // Show the list view
    }

    initializePopup(); // Run initialization

}); // End of DOMContentLoaded