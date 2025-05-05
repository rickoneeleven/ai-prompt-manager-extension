document.addEventListener('DOMContentLoaded', () => {
    // Get references to the main view containers
    const promptListView = document.getElementById('prompt-list-view');
    const promptInputView = document.getElementById('prompt-input-view');
    const addEditView = document.getElementById('add-edit-view');

    // Get references to navigation buttons
    const addPromptBtn = document.getElementById('add-prompt-btn');
    const backToListBtn = document.getElementById('back-to-list-btn');
    const cancelAddEditBtn = document.getElementById('cancel-add-edit-btn');

    // --- View Switching Logic ---

    // Helper function to show a specific view and hide others
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

    // --- Event Listeners for Navigation ---

    // When "+" button is clicked -> show Add/Edit view (in Add mode)
    addPromptBtn.addEventListener('click', () => {
        // TODO (Phase 3): Clear fields & set title for "Add New"
        console.log("Add prompt button clicked - showing add/edit view"); // Temporary log
        // Later we'll add logic here to prepare the form for adding
        document.getElementById('add-edit-title').textContent = 'Add New Prompt';
        document.getElementById('prompt-title-input').value = '';
        document.getElementById('prompt-text-input').value = '';
        // Remove editing state marker if present (for Phase 3)
        document.getElementById('save-prompt-btn').removeAttribute('data-editing-id');

        showView('add-edit-view');
    });

    // When "Back" button is clicked (from Input view) -> show List view
    backToListBtn.addEventListener('click', () => {
        console.log("Back to list button clicked - showing list view"); // Temporary log
        showView('prompt-list-view');
    });

    // When "Cancel" button is clicked (from Add/Edit view) -> show List view
    cancelAddEditBtn.addEventListener('click', () => {
        console.log("Cancel add/edit button clicked - showing list view"); // Temporary log
        showView('prompt-list-view');
    });

    // --- Initialization ---

    // Show the prompt list view by default when the popup opens
    console.log("Popup loaded - showing initial list view"); // Temporary log
    showView('prompt-list-view');

    // TODO (Phase 2): Add logic to fetch and display prompts here

}); // End of DOMContentLoaded