// uiManager.js

/**
 * @fileoverview Manages UI elements, view switching, and UI rendering for the popup.
 * Assumes 'logger.js' is loaded globally.
 */

// Ensure logger is available or provide a fallback
const localLogger = typeof logger !== 'undefined' ? logger : {
    log: (...args) => console.log('[UIManager-FallbackLog]', ...args),
    error: (...args) => console.error('[UIManager-FallbackErr]', ...args),
    warn: (...args) => console.warn('[UIManager-FallbackWarn]', ...args)
};

const UIManager = (() => {
    localLogger.log("UIManager: Initializing...");

    // --- DOM Element Cache ---
    const elements = {
        // Views
        promptListView: null,
        promptInputView: null,
        addEditView: null,
        // Prompt List View
        promptList: null,
        addPromptButton: null,
        exportPromptsButton: null,
        importPromptsButton: null,
        importFileInput: null,
        // Prompt Input View
        selectedPromptTitle: null,
        userInput: null,
        copyOutputButton: null,
        backToListButton: null,
        // Add/Edit View
        addEditTitle: null,
        promptTitleInput: null,
        promptTextInput: null,
        savePromptButton: null,
        cancelAddEditButton: null,
    };

    const viewIds = {
        LIST: 'prompt-list-view',
        INPUT: 'prompt-input-view',
        EDIT: 'add-edit-view'
    };

    /**
     * Initializes the DOM element cache by querying the document.
     * Should be called once DOMContentLoaded.
     */
    function cacheDOMElements() {
        localLogger.log("UIManager: Caching DOM elements.");
        elements.promptListView = document.getElementById('prompt-list-view');
        elements.promptInputView = document.getElementById('prompt-input-view');
        elements.addEditView = document.getElementById('add-edit-view');

        elements.promptList = document.getElementById('prompt-list');
        elements.addPromptButton = document.getElementById('add-prompt-btn');
        elements.exportPromptsButton = document.getElementById('export-prompts-btn');
        elements.importPromptsButton = document.getElementById('import-prompts-btn');
        elements.importFileInput = document.getElementById('import-file-input');

        elements.selectedPromptTitle = document.getElementById('selected-prompt-title');
        elements.userInput = document.getElementById('user-input');
        elements.copyOutputButton = document.getElementById('copy-output-btn');
        elements.backToListButton = document.getElementById('back-to-list-btn');

        elements.addEditTitle = document.getElementById('add-edit-title');
        elements.promptTitleInput = document.getElementById('prompt-title-input');
        elements.promptTextInput = document.getElementById('prompt-text-input');
        elements.savePromptButton = document.getElementById('save-prompt-btn');
        elements.cancelAddEditButton = document.getElementById('cancel-add-edit-btn');

        // Basic validation
        for (const key in elements) {
            if (!elements[key]) {
                localLogger.warn(`UIManager: DOM element not found for key: ${key}. This might cause issues.`);
            }
        }
        localLogger.log("UIManager: DOM elements caching complete.");
    }

    /**
     * Shows a specific view and hides others.
     * @param {string} viewId - The ID of the view to show (e.g., UIManager.VIEWS.LIST).
     */
    function showView(viewId) {
        localLogger.log(`UIManager: Switching view to: ${viewId}`);
        Object.values(viewIds).forEach(id => {
            const viewElement = document.getElementById(id); // Direct get, elements cache might not be fully populated if called early
            if (viewElement) viewElement.style.display = 'none';
        });

        const viewToShow = document.getElementById(viewId);
        if (viewToShow) {
            viewToShow.style.display = 'block';
        } else {
            localLogger.error("UIManager: View ID not found for showView:", viewId, "Falling back to list view.");
            const fallbackList = document.getElementById(viewIds.LIST);
            if (fallbackList) fallbackList.style.display = 'block';
        }
    }

    /**
     * Renders the list of prompts in the UI.
     * @param {Array<object>} prompts - Array of prompt objects {id, title, text}.
     * @param {function} onSelectPrompt - Callback when a prompt is selected.
     * @param {function} onEditPrompt - Callback when edit icon is clicked.
     * @param {function} onDeletePrompt - Callback when delete icon is clicked.
     */
    function renderPromptList(prompts, onSelectPrompt, onEditPrompt, onDeletePrompt) {
        localLogger.log('UIManager: Rendering prompt list UI with', prompts.length, 'prompts.');
        if (!elements.promptList) {
            localLogger.error("UIManager: Prompt list element not cached. Cannot render.");
            return;
        }
        elements.promptList.innerHTML = ''; // Clear existing list

        if (prompts.length === 0) {
            const noPromptsMessage = document.createElement('li');
            noPromptsMessage.textContent = 'No prompts yet. Click (+) to add one or import!';
            noPromptsMessage.style.textAlign = 'center';
            noPromptsMessage.style.padding = '10px';
            elements.promptList.appendChild(noPromptsMessage);
            return;
        }

        prompts.forEach(prompt => {
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
            editIcon.textContent = '\u270F\uFE0F'; // Pencil emoji
            editIcon.title = `Edit "${prompt.title}"`;
            editIcon.addEventListener('click', (event) => {
                event.stopPropagation();
                onEditPrompt(prompt.id);
            });
            iconsSpan.appendChild(editIcon);

            const deleteIcon = document.createElement('span');
            deleteIcon.classList.add('delete-icon');
            deleteIcon.textContent = '\uD83D\uDDD1\uFE0F'; // Trash can emoji
            deleteIcon.title = `Delete "${prompt.title}"`;
            deleteIcon.addEventListener('click', (event) => {
                event.stopPropagation();
                onDeletePrompt(prompt.id, prompt.title);
            });
            iconsSpan.appendChild(deleteIcon);

            listItem.appendChild(iconsSpan);
            listItem.addEventListener('click', () => onSelectPrompt(prompt.id));
            elements.promptList.appendChild(listItem);
        });
        localLogger.log('UIManager: Prompt list UI rendering complete.');
    }

    /**
     * Resets the copy button to its default state.
     * @param {boolean} [disabled=true] - Whether the button should be disabled.
     */
    function resetCopyButtonToDefault(disabled = true) {
        if (elements.copyOutputButton) {
            elements.copyOutputButton.textContent = 'Copy Output';
            elements.copyOutputButton.disabled = disabled;
        } else {
            localLogger.warn("UIManager: Copy output button not found for resetCopyButtonToDefault.");
        }
    }
    
    /**
     * Clears the user input area and resets its placeholder.
     */
    function clearUserInputDisplay() {
        if (elements.userInput) {
            elements.userInput.innerHTML = '';
            // The aria-placeholder is handled by CSS :empty:before, so just clearing content is enough
            localLogger.log("UIManager: User input display cleared.");
        } else {
            localLogger.warn("UIManager: User input element not found for clearing.");
        }
    }

    /**
     * Updates the display of the selected prompt's title.
     * @param {string} title - The title of the selected prompt.
     */
    function setSelectedPromptTitle(title) {
        if (elements.selectedPromptTitle) {
            elements.selectedPromptTitle.textContent = title;
        } else {
            localLogger.warn("UIManager: Selected prompt title element not found.");
        }
    }

    /**
     * Sets the values for the prompt add/edit form.
     * @param {string} formTitle - The title for the form (e.g., "Add New Prompt").
     * @param {string} promptTitle - The value for the prompt title input.
     * @param {string} promptText - The value for the prompt text area.
     */
    function setAddEditFormValues(formTitle, promptTitle, promptText) {
        if (elements.addEditTitle) elements.addEditTitle.textContent = formTitle;
        else localLogger.warn("UIManager: Add/Edit title element not found.");

        if (elements.promptTitleInput) elements.promptTitleInput.value = promptTitle;
        else localLogger.warn("UIManager: Prompt title input element not found.");

        if (elements.promptTextInput) elements.promptTextInput.value = promptText;
        else localLogger.warn("UIManager: Prompt text input element not found.");
    }

    /**
     * Focuses on the prompt title input in the add/edit view.
     */
    function focusPromptTitleInput() {
        if (elements.promptTitleInput) {
            elements.promptTitleInput.focus();
        } else {
            localLogger.warn("UIManager: Prompt title input not found for focusing.");
        }
    }

    /**
     * Focuses on the user input element in the input view.
     */
    function focusUserInput() {
        if (elements.userInput) {
            elements.userInput.focus();
        } else {
            localLogger.warn("UIManager: User input element not found for focusing.");
        }
    }

    /**
     * Creates and displays a temporary "Copy Pending Image" button.
     * @param {object} pendingImageData - Data of the image to be copied.
     * @param {string} pendingImageData.associatedPromptTitle - Title associated with the image.
     * @param {function} onCopyPendingImage - Callback when the button is clicked.
     * @returns {HTMLElement|null} The created button element or null if creation failed.
     */
    function showPendingImageCopyButton(pendingImageData, onCopyPendingImage) {
        if (!elements.promptListView) {
            localLogger.error("UIManager: Prompt list view element not found for pending image button.");
            return null;
        }
        const existingButton = document.getElementById('copy-pending-image-btn');
        if (existingButton) existingButton.remove();

        const button = document.createElement('button');
        button.id = 'copy-pending-image-btn';
        button.textContent = `Copy Image for '${pendingImageData.associatedPromptTitle}'`;
        button.style.marginBottom = '10px';
        button.style.width = '100%';
        button.style.backgroundColor = '#e8f0fe';
        button.style.border = '1px solid #1a73e8';
        button.style.color = '#1a73e8';
        button.onclick = async () => {
            localLogger.log("UIManager: 'Copy Pending Image' button clicked via UIManager.");
            await onCopyPendingImage(button); // Pass button for UI updates
        };
        elements.promptListView.insertBefore(button, elements.promptListView.querySelector('#import-export-controls + ul, #import-export-controls + button, #prompt-list'));
        localLogger.log("UIManager: Pending image copy button displayed.");
        return button;
    }

    /**
     * Removes the "Copy Pending Image" button if it exists.
     */
    function removePendingImageCopyButton() {
        const button = document.getElementById('copy-pending-image-btn');
        if (button) {
            button.remove();
            localLogger.log("UIManager: Pending image copy button removed.");
        }
    }
    
    // Public API
    return {
        init: cacheDOMElements,
        getElements: () => elements, // Provides access to cached elements
        VIEWS: Object.freeze({...viewIds}), // Expose view constants
        showView,
        renderPromptList,
        resetCopyButtonToDefault,
        clearUserInputDisplay,
        setSelectedPromptTitle,
        setAddEditFormValues,
        focusPromptTitleInput,
        focusUserInput,
        showPendingImageCopyButton,
        removePendingImageCopyButton
    };
})();

// Initialize UIManager once the DOM is ready (important for element caching)
// This assumes popup.js will call UIManager.init() at the appropriate time (DOMContentLoaded)
// or we can do it here, but popup.js is the entry point.
// For now, popup.js will be responsible for calling UIManager.init().