export async function handleSelectPrompt(promptId, currentPrompts, selectedSystemPromptTextCallback, clearUserInputCallback, clearPendingImageCallback, UIManager) {
    const selectedPrompt = currentPrompts.find(p => p.id === promptId);
    if (!selectedPrompt) { 
        console.error("Selected prompt not found with ID:", promptId);
        alert("Error: Prompt not found."); 
        return; 
    }
    console.log("Selected prompt ID:", promptId, " Title:", selectedPrompt.title);
    selectedSystemPromptTextCallback(selectedPrompt.text);
    UIManager.setSelectedPromptTitle(selectedPrompt.title);
    await clearUserInputCallback();
    await clearPendingImageCallback(); 
    UIManager.showView(UIManager.VIEWS.INPUT);
    UIManager.focusUserInput();
}

export async function handleEditPrompt(promptId, currentPrompts, setCurrentEditingId, clearPendingImageCallback, resetLocallyStagedImageCallback, setCurrentPastedImageBase64Callback, UIManager) {
    const promptToEdit = currentPrompts.find(p => p.id === promptId);
    if (!promptToEdit) {
        console.error("Prompt to edit not found with ID:", promptId);
        alert("Error: Prompt to edit not found."); 
        return; 
    }
    console.log("Edit icon clicked for prompt ID:", promptId);
    setCurrentEditingId(promptId);
    UIManager.setAddEditFormValues('Edit Prompt', promptToEdit.title, promptToEdit.text);
    await clearPendingImageCallback(); 
    resetLocallyStagedImageCallback();
    setCurrentPastedImageBase64Callback(null); 
    UIManager.showView(UIManager.VIEWS.EDIT);
    UIManager.focusPromptTitleInput();
}

export async function handleDeletePrompt(promptId, promptTitle, deletePromptFn, clearPendingImageCallback, refreshCallback) {
    if (confirm(`Are you sure you want to delete the prompt "${promptTitle}"?`)) {
        console.log(`Deleting prompt ID: ${promptId}, Title: "${promptTitle}"`);
        try {
            await deletePromptFn(promptId);
            await clearPendingImageCallback(); 
            await refreshCallback();
        } catch (error) {
            console.error("Error deleting prompt:", error.message, error.stack);
            alert(`Failed to delete prompt: ${error.message}`);
        }
    }
}

export async function handleSavePrompt(elements, currentEditingId, savePromptFn, refreshCallback, UIManager) {
    const title = elements.promptTitleInput.value.trim();
    const text = elements.promptTextInput.value.trim();
    if (!title || !text) { 
        alert("Title and prompt text cannot be empty."); 
        return; 
    }
    const promptToSave = { id: currentEditingId || Date.now().toString(), title, text };
    console.log(`Saving prompt ID: ${promptToSave.id}, Title: "${title}"`);
    try {
        await savePromptFn(promptToSave);
        await refreshCallback();
        UIManager.showView(UIManager.VIEWS.LIST);
        return null;
    } catch (error) {
        console.error("Error saving prompt:", error.message, error.stack);
        alert(`Failed to save prompt: ${error.message}`);
        return currentEditingId;
    }
}

export async function handleExportPrompts(getAllPromptsFn) {
    console.log("Export prompts button clicked.");
    try {
        const promptsToExport = await getAllPromptsFn();
        if (promptsToExport.length === 0) {
            alert("No prompts to export.");
            console.log("No prompts available for export.");
            return;
        }

        const simplifiedPrompts = promptsToExport.map(p => ({ id: p.id, title: p.title, text: p.text }));

        const jsonData = JSON.stringify(simplifiedPrompts, null, 2);
        const blob = new Blob([jsonData], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        const timestamp = new Date().toISOString().slice(0, 19).replace(/:/g, '-');
        a.href = url;
        a.download = `ai-prompt-manager-backup-${timestamp}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        console.log(`Prompts successfully exported to ${a.download}. Count: ${simplifiedPrompts.length}`);
        alert(`${simplifiedPrompts.length} prompts exported successfully.`);
    } catch (error) {
        console.error("Error exporting prompts:", error.message, error.stack);
        alert(`Failed to export prompts: ${error.message}`);
    }
}

export function handleImportPrompts(elements) {
    console.log("Import prompts button clicked, triggering file input.");
    if (elements.importFileInput) {
        elements.importFileInput.click();
    } else {
        console.error("Import file input element not found.");
        alert("Error: Could not initiate import process. File input missing.");
    }
}

export async function handleFileImport(event, getAllPromptsFn, savePromptFn, refreshCallback, elements) {
    console.log("File selected for import.");
    const file = event.target.files[0];
    if (!file) {
        console.log("No file selected for import.");
        return;
    }
    if (file.type !== "application/json") {
        alert("Invalid file type. Please select a JSON file.");
        console.warn("Invalid file type selected for import:", file.type);
        elements.importFileInput.value = "";
        return;
    }

    const reader = new FileReader();
    reader.onload = async (e) => {
        try {
            const content = e.target.result;
            const importedData = JSON.parse(content);
            console.log("File content parsed as JSON.", { dataPreview: JSON.stringify(importedData).substring(0,100) + "..." });

            if (!Array.isArray(importedData)) {
                throw new Error("Imported JSON is not an array.");
            }

            const promptsToImport = [];
            for (const item of importedData) {
                if (item && typeof item.title === 'string' && typeof item.text === 'string') {
                    promptsToImport.push({
                        title: item.title.trim(),
                        text: item.text
                    });
                } else {
                    console.warn("Skipping invalid item in imported JSON:", item);
                }
            }

            if (promptsToImport.length === 0) {
                alert("No valid prompts found in the selected file.");
                console.log("No valid prompts to import from file.");
                elements.importFileInput.value = "";
                return;
            }

            console.log(`${promptsToImport.length} valid prompts parsed from file. Proceeding with import.`);
            
            const existingPrompts = await getAllPromptsFn();
            const existingTitles = existingPrompts.map(p => p.title);
            let importedCount = 0;
            let skippedCount = 0;

            for (const importedPrompt of promptsToImport) {
                let newTitle = importedPrompt.title;
                let titleSuffix = 2;
                while (existingTitles.includes(newTitle)) {
                    newTitle = `${importedPrompt.title} (${titleSuffix++})`;
                }

                const newId = Date.now().toString() + '-' + Math.random().toString(36).substring(2, 9);
                const promptToSave = {
                    id: newId,
                    title: newTitle,
                    text: importedPrompt.text
                };

                try {
                    console.log(`Attempting to save imported prompt: ID ${promptToSave.id}, Title "${promptToSave.title}"`);
                    await savePromptFn(promptToSave);
                    existingTitles.push(newTitle);
                    importedCount++;
                } catch (saveError) {
                    console.error(`Error saving imported prompt "${promptToSave.title}":`, saveError.message, saveError.stack);
                    skippedCount++;
                }
            }

            console.log(`Import process complete. Imported: ${importedCount}, Skipped/Failed: ${skippedCount}.`);
            alert(`Import complete!\nSuccessfully imported: ${importedCount}\nSkipped due to errors: ${skippedCount}`);
            
            await refreshCallback();
        } catch (error) {
            console.error("Error processing imported file:", error.message, error.stack);
            alert(`Failed to import prompts: ${error.message}`);
        } finally {
            elements.importFileInput.value = "";
        }
    };
    reader.onerror = (error) => {
        console.error("Error reading file for import:", error.message, error.stack);
        alert("Error reading the selected file.");
        elements.importFileInput.value = "";
    };
    reader.readAsText(file);
}
