// --- Storage Constants ---
const PROMPT_KEY_PREFIX = 'prompt_';
const CHUNK_KEY_SEPARATOR = '_chunk_';
// Set chunk size slightly below the 8KB limit to account for JSON encoding & key overhead
// 8192 bytes is the limit. Let's aim for ~7KB string length. UTF-8 chars can be > 1 byte.
// String.length isn't bytes, but provides a reasonable approximation for splitting.
// A more precise method uses TextEncoder, but complicates splitting logic significantly.
// We'll use String.length for simplicity, risking edge cases with mostly multi-byte chars.
const MAX_CHUNK_LENGTH = 7000; // Max characters per chunk (adjust if needed)

// --- Logging Utility ---
const logger = {
    log: (...args) => console.log('[PromptManager]', ...args),
    error: (...args) => console.error('[PromptManager]', ...args),
    warn: (...args) => console.warn('[PromptManager]', ...args),
};

// --- Storage Utility Functions ---

/**
 * Retrieves all prompts, reconstructing chunked prompts automatically.
 * @returns {Promise<Array<object>>} A promise resolving with the array of complete prompts.
 */
async function getAllPrompts() {
    logger.log('Attempting to retrieve all prompts (including chunks).');
    try {
        const allItems = await chrome.storage.sync.get(null);
        const promptsMap = new Map(); // Use Map to organize prompts and their chunks
        const chunkKeys = []; // Keep track of chunk keys to ignore later

        // First pass: Identify metadata and chunks
        for (const key in allItems) {
            if (!key.startsWith(PROMPT_KEY_PREFIX)) continue; // Ignore unrelated keys

            if (key.includes(CHUNK_KEY_SEPARATOR)) {
                // This is a chunk key, e.g., "prompt_123_chunk_0"
                chunkKeys.push(key);
                const [baseKey, chunkIndexStr] = key.split(CHUNK_KEY_SEPARATOR);
                const chunkIndex = parseInt(chunkIndexStr, 10);
                if (!isNaN(chunkIndex)) {
                    if (!promptsMap.has(baseKey)) {
                        promptsMap.set(baseKey, { chunks: [] }); // Initialize if metadata not seen yet
                    }
                    const promptData = promptsMap.get(baseKey);
                    // Store chunk text directly at the correct index (sparse array possible initially)
                    promptData.chunks[chunkIndex] = allItems[key];
                } else {
                    logger.warn(`Invalid chunk index found in key: ${key}`);
                }
            } else {
                // This is potentially a metadata key or a non-chunked prompt key, e.g., "prompt_123"
                const promptData = allItems[key];
                if (promptData && typeof promptData === 'object' && promptData.id) {
                    if (!promptsMap.has(key)) {
                        promptsMap.set(key, { metadata: promptData, chunks: [] }); // Initialize if chunks not seen yet
                    } else {
                        promptsMap.get(key).metadata = promptData; // Add metadata if chunks seen first
                    }
                } else {
                     logger.warn(`Invalid prompt data found for key: ${key}`, promptData);
                }
            }
        }

        // Second pass: Reconstruct prompts
        const finalPromptsArray = [];
        for (const [baseKey, data] of promptsMap.entries()) {
             if (!data.metadata) {
                 logger.warn(`Missing metadata for potential prompt with base key: ${baseKey}. Skipping.`);
                 continue;
             }

            const metadata = data.metadata;

            if (metadata.hasOwnProperty('chunkCount') && metadata.chunkCount > 0) {
                // Reconstruct chunked prompt
                logger.log(`Reconstructing chunked prompt ID: ${metadata.id}, expected chunks: ${metadata.chunkCount}`);
                let fullText = '';
                let missingChunk = false;
                for (let i = 0; i < metadata.chunkCount; i++) {
                    const chunkText = data.chunks[i];
                    if (typeof chunkText === 'string') {
                        fullText += chunkText;
                    } else {
                        logger.error(`Missing or invalid chunk index ${i} for prompt ID: ${metadata.id} (key: ${baseKey})`);
                        missingChunk = true;
                        break; // Stop reconstruction for this prompt
                    }
                }

                if (!missingChunk) {
                    finalPromptsArray.push({
                        id: metadata.id,
                        title: metadata.title,
                        text: fullText
                    });
                    logger.log(`Successfully reconstructed prompt ID: ${metadata.id}`);
                } else {
                    // Decide how to handle partially recovered prompts. Skip for now.
                     logger.error(`Failed to reconstruct prompt ID: ${metadata.id} due to missing chunks.`);
                     // Optional: Add a placeholder or error state prompt?
                }

            } else if (metadata.hasOwnProperty('text')) {
                // This is a non-chunked prompt
                finalPromptsArray.push(metadata); // Contains id, title, text
                 logger.log(`Retrieved non-chunked prompt ID: ${metadata.id}`);
            } else {
                 logger.warn(`Metadata for key ${baseKey} (ID: ${metadata.id}) has neither 'text' nor 'chunkCount'. Skipping.`);
            }
        }

        logger.log(`Retrieved and processed ${finalPromptsArray.length} prompts.`);
        finalPromptsArray.sort((a, b) => a.title.localeCompare(b.title));
        return finalPromptsArray;

    } catch (error) {
        logger.error('Error retrieving/reconstructing prompts:', error.message, error.stack);
        return []; // Return empty on error
    }
}


/**
 * Saves a single prompt, automatically chunking if text exceeds MAX_CHUNK_LENGTH.
 * Handles cleaning up old data/chunks if the prompt existed before.
 * @param {object} promptObject The prompt object to save {id, title, text}.
 * @returns {Promise<void>} A promise resolving when saving is complete, or rejecting on error.
 */
async function savePrompt(promptObject) {
    if (!promptObject || !promptObject.id || !promptObject.title || typeof promptObject.text !== 'string') {
        const errorMsg = 'Invalid prompt object provided for saving.';
        logger.error(errorMsg, promptObject);
        throw new Error(errorMsg);
    }

    const { id, title, text } = promptObject;
    const baseKey = `${PROMPT_KEY_PREFIX}${id}`;
    logger.log(`Attempting to save prompt ID: ${id}, Title: ${title}. Checking size.`);

    // --- Cleanup Strategy: Always remove potentially existing data first ---
    // This simplifies logic by not needing to know the *previous* chunk state.
    // 1. Find all keys related to this prompt ID (metadata + any old chunks).
    // 2. Remove them all.
    // 3. Save the new data (either single item or metadata + new chunks).
    try {
        const allItems = await chrome.storage.sync.get(null);
        const keysToRemove = [];
        for (const key in allItems) {
            if (key.startsWith(baseKey)) { // Matches baseKey or baseKey + _chunk_...
                keysToRemove.push(key);
            }
        }
        if (keysToRemove.length > 0) {
             logger.log(`Found existing data/chunks for prompt ID ${id}. Removing keys:`, keysToRemove);
             await chrome.storage.sync.remove(keysToRemove);
        } else {
             logger.log(`No existing data found for prompt ID ${id}. Proceeding with save.`);
        }
    } catch (error) {
         logger.error(`Error during cleanup phase for prompt ID ${id}:`, error.message, error.stack);
         throw new Error(`Failed during cleanup before saving prompt ${id}.`); // Abort save
    }

    // --- Save Strategy: Check size and save accordingly ---
    try {
        // Estimate size based on string length (approximation)
        if (text.length <= MAX_CHUNK_LENGTH) {
            // Save as a single item
            logger.log(`Prompt ID ${id} is small enough. Saving as single item.`);
            const dataToSave = { [baseKey]: { id, title, text } };
            await chrome.storage.sync.set(dataToSave);
            logger.log(`Prompt ID ${id} saved successfully as single item.`);

        } else {
            // Save as chunked item
            logger.log(`Prompt ID ${id} text length (${text.length}) exceeds MAX_CHUNK_LENGTH (${MAX_CHUNK_LENGTH}). Chunking necessary.`);
            const chunks = [];
            for (let i = 0; text.length > i * MAX_CHUNK_LENGTH; i++) {
                chunks.push(text.substring(i * MAX_CHUNK_LENGTH, (i + 1) * MAX_CHUNK_LENGTH));
            }
            const chunkCount = chunks.length;
             logger.log(`Split prompt ID ${id} into ${chunkCount} chunks.`);

            // Save metadata first
            const metadata = { id, title, chunkCount };
            const metadataToSave = { [baseKey]: metadata };
             logger.log(`Saving metadata for chunked prompt ID ${id}:`, metadata);
            await chrome.storage.sync.set(metadataToSave);

            // Save each chunk individually
            for (let i = 0; i < chunkCount; i++) {
                const chunkKey = `${baseKey}${CHUNK_KEY_SEPARATOR}${i}`;
                const chunkData = chunks[i];
                const chunkToSave = { [chunkKey]: chunkData };
                // Estimate chunk size before saving (more accurate check)
                 const chunkByteLength = new TextEncoder().encode(chunkData).length;
                 logger.log(`Saving chunk ${i}/${chunkCount-1} for prompt ID ${id}. Key: ${chunkKey}, Approx Byte Size: ${chunkByteLength}`);

                 if (chunkByteLength >= 8192) {
                     // This *shouldn't* happen with MAX_CHUNK_LENGTH=7000 if chars are mostly 1-byte,
                     // but possible with highly dense multi-byte chars.
                     logger.error(`CRITICAL: Calculated chunk ${i} for prompt ID ${id} is too large (${chunkByteLength} bytes) even after splitting by length! Aborting save.`);
                     // Attempt cleanup of already saved metadata/chunks? Risky. Best to alert user.
                     throw new Error(`Failed to save: A text chunk for "${title}" is still too large (${chunkByteLength} bytes) even after splitting. The text may contain many multi-byte characters. Try shortening it further.`);
                 }

                try {
                    await chrome.storage.sync.set(chunkToSave);
                } catch (chunkError) {
                    logger.error(`Error saving chunk ${i} for prompt ID ${id}:`, chunkError.message, chunkError.stack);
                    // If a chunk fails, the prompt is now in an inconsistent state.
                    // Attempting automatic rollback is complex. Inform user.
                    throw new Error(`Failed to save chunk ${i} for prompt "${title}". Storage may be inconsistent. Error: ${chunkError.message}`);
                }
            }
            logger.log(`All ${chunkCount} chunks saved successfully for prompt ID ${id}.`);
        }
    } catch (error) {
        logger.error(`Error during save phase for prompt ID ${id}:`, error.message, error.stack);
        // Check if it's a quota error (maybe total quota?)
         if (error.message.includes('QUOTA_BYTES')) { // Catch QUOTA_BYTES_PER_ITEM or overall QUOTA_BYTES
             logger.error(`Quota exceeded while saving prompt ID ${id}.`);
             throw new Error(`Storage quota exceeded while saving "${title}". You may need to delete older/larger prompts. Specific error: ${error.message}`);
         }
        // Re-throw specific errors from chunking or re-throw generic error
        throw error;
    }
}


/**
 * Deletes a prompt and all its associated chunks (if any).
 * @param {string} promptId The ID of the prompt to delete.
 * @returns {Promise<void>} A promise resolving when deletion is complete, or rejecting on error.
 */
async function deletePrompt(promptId) {
    if (!promptId) {
        const errorMsg = 'Invalid prompt ID provided for deletion.';
        logger.error(errorMsg);
        throw new Error(errorMsg);
    }
    const baseKey = `${PROMPT_KEY_PREFIX}${promptId}`;
    logger.log(`Attempting to delete prompt ID: ${promptId} (base key: ${baseKey}) and any associated chunks.`);

    // Find all keys related to this prompt ID to ensure complete removal
    try {
        const allItems = await chrome.storage.sync.get(null);
        const keysToRemove = [];
        for (const key in allItems) {
            // Check if the key is the base key OR starts with the base key + chunk separator
            if (key === baseKey || key.startsWith(`${baseKey}${CHUNK_KEY_SEPARATOR}`)) {
                keysToRemove.push(key);
            }
        }

        if (keysToRemove.length > 0) {
            logger.log(`Found keys to remove for prompt ID ${promptId}:`, keysToRemove);
            await chrome.storage.sync.remove(keysToRemove);
            logger.log(`Successfully removed data for prompt ID: ${promptId}.`);
        } else {
            logger.warn(`No data found in storage for prompt ID: ${promptId}. Deletion request ignored.`);
        }
    } catch (error) {
        logger.error(`Error deleting prompt ID ${promptId}:`, error.message, error.stack);
        throw new Error(`Failed to delete prompt data for ID ${promptId}. Error: ${error.message}`);
    }
}


// --- Main Popup Logic ---
// No changes needed below this line, as it interacts with the abstracted
// getAllPrompts, savePrompt, deletePrompt functions which now handle chunking internally.
// ... (rest of popup.js remains the same as in the previous refactoring step) ...

document.addEventListener('DOMContentLoaded', () => {
    // Keep track of the currently loaded prompts and selected prompt text
    let currentPrompts = []; // Local cache of prompts
    let selectedSystemPromptText = '';
    let currentEditingId = null; // Track ID being edited, null if adding new

    // Get references to the main view containers
    const promptListView = document.getElementById('prompt-list-view');
    const promptInputView = document.getElementById('prompt-input-view');
    const addEditView = document.getElementById('add-edit-view');

    // Get references to UI elements (using more descriptive names)
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
        logger.log(`Switching view to: ${viewId}`);
        // Hide all views first
        Object.values(views).forEach(id => {
            const viewElement = document.getElementById(id);
            if (viewElement) {
                viewElement.style.display = 'none';
            }
        });

        // Show the target view
        const viewToShow = document.getElementById(viewId);
        if (viewToShow) {
            viewToShow.style.display = 'block';
        } else {
            logger.error("View ID not found:", viewId, "Falling back to list view.");
            document.getElementById(views.LIST).style.display = 'block'; // Fallback
        }
    }

    // --- UI Rendering ---
    function renderPromptListUI() {
        logger.log('Rendering prompt list UI with', currentPrompts.length, 'prompts.');
        promptListElement.innerHTML = ''; // Clear current list

        if (currentPrompts.length === 0) {
            promptListElement.innerHTML = '<li class="no-prompts-message">No prompts yet. Click (+) to add one!</li>';
            return;
        }

        // Note: Sorting is now done in getAllPrompts

        currentPrompts.forEach(prompt => {
            const listItem = document.createElement('li');
            listItem.setAttribute('data-prompt-id', prompt.id);

            const titleSpan = document.createElement('span');
            titleSpan.classList.add('prompt-title');
            titleSpan.textContent = prompt.title;
            listItem.appendChild(titleSpan); // Add title first

             // Create icons container
            const iconsSpan = document.createElement('span');
            iconsSpan.classList.add('action-icons');

            // Edit Icon
            const editIcon = document.createElement('span');
            editIcon.classList.add('edit-icon');
            editIcon.setAttribute('data-prompt-id', prompt.id); // Redundant? ListItem has it. Keep for clarity.
            editIcon.textContent = '\u270F\uFE0F'; // Edit icon (pencil)
            editIcon.title = `Edit "${prompt.title}"`;
            editIcon.addEventListener('click', (event) => {
                event.stopPropagation(); // Prevent list item's main click handler
                handleEditPrompt(prompt.id);
            });
            iconsSpan.appendChild(editIcon);

            // Delete Icon
            const deleteIcon = document.createElement('span');
            deleteIcon.classList.add('delete-icon');
            deleteIcon.setAttribute('data-prompt-id', prompt.id);
            deleteIcon.textContent = '\uD83D\uDDD1\uFE0F'; // Delete icon (wastebasket)
            deleteIcon.title = `Delete "${prompt.title}"`;
             deleteIcon.addEventListener('click', (event) => {
                event.stopPropagation(); // Prevent list item's main click handler
                handleDeletePrompt(prompt.id, prompt.title);
            });
            iconsSpan.appendChild(deleteIcon);

            listItem.appendChild(iconsSpan); // Add icons container

            // Add main click handler for selection
             listItem.addEventListener('click', () => {
                 handleSelectPrompt(prompt.id);
             });

            promptListElement.appendChild(listItem);
        });
         logger.log('Prompt list UI rendering complete.');
    }

    // --- Data Loading and State Update ---
    async function loadAndRenderPrompts() {
        logger.log("Initiating prompt loading and rendering.");
        try {
            currentPrompts = await getAllPrompts(); // Fetch fresh data (handles chunking)
            renderPromptListUI(); // Update the UI
        } catch (error) {
            // Error is logged within getAllPrompts, potentially show UI feedback
            logger.error("Failed to load and render prompts.", error.message);
            promptListElement.innerHTML = '<li class="error-message">Error loading prompts. Check console.</li>';
        }
    }


    // --- Event Handlers ---

    function handleAddPromptClick() {
        logger.log("Add prompt button clicked.");
        currentEditingId = null; // Ensure we are in "add" mode
        addEditTitleElement.textContent = 'Add New Prompt';
        promptTitleInput.value = '';
        promptTextInput.value = '';
        promptTitleInput.focus();
        showView(views.EDIT);
    }

    function handleBackToListClick() {
         logger.log("Back to list button clicked.");
         selectedSystemPromptText = ''; // Clear selected prompt state
         userInputTextArea.value = '';
         copyOutputButton.disabled = true;
         copyOutputButton.textContent = 'Copy Output';
         showView(views.LIST);
    }

    function handleCancelAddEditClick() {
         logger.log("Cancel add/edit button clicked.");
         showView(views.LIST); // Simply return to list
         // Clear editing state just in case
         currentEditingId = null;
         promptTitleInput.value = '';
         promptTextInput.value = '';
    }

    function handleUserInput() {
        copyOutputButton.disabled = !userInputTextArea.value.trim();
        // Reset button text if user types after a copy/error
        if(copyOutputButton.textContent !== 'Copy Output') {
             copyOutputButton.textContent = 'Copy Output';
        }
    }

     function handleCopyOutputClick() {
        const userText = userInputTextArea.value.trim();
        if (!userText || !selectedSystemPromptText) {
             logger.warn("Copy attempt failed: Missing user text or system prompt.");
            return;
        }

        const finalOutput = `[[[system prompt begin]]]\n\n${selectedSystemPromptText}\n\n[[[system prompt end]]]\n\n\n[[[user prompt begin]]]\n\n${userText}\n\n[[[user prompt end]]]`;
        logger.log("Attempting to copy combined output to clipboard.", { length: finalOutput.length });

        navigator.clipboard.writeText(finalOutput)
            .then(() => {
                logger.log("Text copied successfully.");
                copyOutputButton.textContent = 'Copied!';
                copyOutputButton.disabled = true;
                // Close popup after a short delay
                setTimeout(() => window.close(), 800); // Slightly shorter delay
            })
            .catch(err => {
                logger.error('Failed to copy text:', err.message, err.stack);
                copyOutputButton.textContent = 'Error!';
                // Re-enable button after showing error, only if there's still text
                setTimeout(() => {
                     copyOutputButton.textContent = 'Copy Output';
                     copyOutputButton.disabled = !userInputTextArea.value.trim();
                }, 2000);
            });
    }

    async function handleSavePromptClick() {
        const title = promptTitleInput.value.trim();
        const text = promptTextInput.value.trim();

        // Basic Validation
        if (!title || !text) {
            logger.warn("Save attempt failed: Title or text is empty.");
            alert("Prompt title and text cannot be empty.");
            return;
        }

        logger.log(`Save button clicked. Mode: ${currentEditingId ? 'Update' : 'Add'}. Title: ${title}`);

        let promptToSave;
        const promptId = currentEditingId || Date.now().toString(); // Use existing ID or generate new one

        if (currentEditingId) {
             logger.log("Preparing to update prompt ID:", currentEditingId);
        } else {
             logger.log("Preparing to add new prompt with ID:", promptId);
        }
        promptToSave = { id: promptId, title, text }; // Construct the object to save


        try {
            await savePrompt(promptToSave); // Use the chunking-aware save function
            logger.log(`Prompt ${promptToSave.id} processed successfully.`);

            // Reload prompts from storage to ensure consistency and reflect changes
            await loadAndRenderPrompts();
            showView(views.LIST); // Go back to the list view

        } catch (error) {
            logger.error("Error saving prompt:", error.message, error.stack);
            // Display specific errors (like chunk too large, quota exceeded) from savePrompt
            alert(`Failed to save prompt: ${error.message}`); // Show specific error to user
            // Do not switch view on error, allow user to correct or retry
        } finally {
            // Clean up editing state only if it was an edit operation
            currentEditingId = null;
             // Clear form? Desirable after successful save, maybe not after error.
             // Let's clear it for now.
             promptTitleInput.value = '';
             promptTextInput.value = '';

        }
    }

    // --- Actions Triggered from List Items ---

    function handleSelectPrompt(promptId) {
         const selectedPrompt = currentPrompts.find(p => p.id === promptId);
         if (!selectedPrompt) {
             logger.error("Select failed: Clicked prompt not found in current list. ID:", promptId);
             alert("Error: Could not find the selected prompt.");
             return;
         }

         logger.log("Selected prompt ID:", promptId, " Title:", selectedPrompt.title);
         selectedSystemPromptText = selectedPrompt.text;
         selectedPromptTitleElement.textContent = selectedPrompt.title;
         userInputTextArea.value = ''; // Clear previous input
         copyOutputButton.disabled = true;
         copyOutputButton.textContent = 'Copy Output';
         showView(views.INPUT);
         userInputTextArea.focus();
    }

     function handleEditPrompt(promptId) {
         const promptToEdit = currentPrompts.find(p => p.id === promptId);
         if (!promptToEdit) {
             logger.error("Edit failed: Prompt to edit not found. ID:", promptId);
             alert("Error: Could not find the prompt to edit.");
             return;
         }

         logger.log("Edit icon clicked for prompt ID:", promptId);
         currentEditingId = promptId; // Set editing mode
         addEditTitleElement.textContent = 'Edit Prompt';
         promptTitleInput.value = promptToEdit.title;
         promptTextInput.value = promptToEdit.text; // Load full text (reconstructed by getAllPrompts)
         showView(views.EDIT);
         promptTitleInput.focus();
     }

     async function handleDeletePrompt(promptId, promptTitle) {
         logger.log("Delete icon clicked for prompt ID:", promptId, "Title:", promptTitle);
         // Use promptTitle in confirmation for better UX
         if (confirm(`Are you sure you want to delete the prompt "${promptTitle}"?`)) {
             logger.log("User confirmed deletion for prompt ID:", promptId);
             try {
                 await deletePrompt(promptId); // Use chunking-aware delete function
                 logger.log(`Deletion successful for prompt ID: ${promptId}. Refreshing list.`);
                 // Reload prompts from storage and re-render the list
                 await loadAndRenderPrompts();
                 // Optional: Add visual feedback for deletion? (e.g., temporary message)
             } catch (error) {
                 logger.error("Error deleting prompt:", error.message, error.stack);
                 alert("Failed to delete prompt. See console for details."); // User feedback
             }
         } else {
              logger.log("User cancelled deletion for prompt ID:", promptId);
         }
     }


    // --- Initialization ---
    async function initializePopup() {
        logger.log("Initializing popup.");
        await loadAndRenderPrompts(); // Load data and render the initial list
        showView(views.LIST);        // Ensure the list view is shown first

         // Attach primary event listeners
        addPromptButton.addEventListener('click', handleAddPromptClick);
        backToListButton.addEventListener('click', handleBackToListClick);
        cancelAddEditButton.addEventListener('click', handleCancelAddEditClick);
        copyOutputButton.addEventListener('click', handleCopyOutputClick);
        userInputTextArea.addEventListener('input', handleUserInput);
        savePromptButton.addEventListener('click', handleSavePromptClick);

        // Note: List item click/edit/delete listeners are added during renderPromptListUI

        logger.log("Popup initialization complete.");
    }

    initializePopup(); // Start the application logic

}); // End of DOMContentLoaded