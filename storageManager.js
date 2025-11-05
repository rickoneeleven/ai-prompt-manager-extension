// storageManager.js

/**
 * @fileoverview Manages all interactions with chrome.storage.sync for
 * storing, retrieving, and deleting AI prompts. Includes logic for
 * chunking large prompts to fit within Chrome's storage limitations.
 */

// This script assumes 'logger.js' is loaded first, making 'logger' globally available.
// If using ES6 modules (not typical for simple extension popup scripts without a build step),
// we would use: import { logger } from './logger.js';

// --- Storage Constants ---
const PROMPT_KEY_PREFIX = 'prompt_';
const CHUNK_KEY_SEPARATOR = '_chunk_';
// Set chunk size slightly below the 8KB QUOTA_BYTES_PER_ITEM limit to account for JSON encoding & key overhead.
// 8192 bytes is the limit per item. Let's aim for ~7KB string length for the value.
// String.length isn't a direct measure of bytes, especially with multi-byte UTF-8 characters.
// A more precise method would involve TextEncoder.encode(string).length for byte counting,
// but this complicates the splitting logic significantly.
// We'll use String.length for simplicity in splitting, and then do a byte check before actual save.
const MAX_CHUNK_LENGTH = 7000; // Max characters per chunk (approximate)

/**
 * Retrieves all prompts, reconstructing chunked prompts automatically.
 * @returns {Promise<Array<object>>} A promise resolving with the array of complete prompts.
 *                                    Each prompt object has {id, title, text}.
 *                                    Returns an empty array on error.
 */
async function getAllPrompts() {
    logger.log('StorageManager: Attempting to retrieve all prompts (including chunks).');
    try {
        const allItems = await chrome.storage.sync.get(null);
        const promptsMap = new Map(); // Use Map to organize prompts and their chunks

        // First pass: Identify metadata and chunks
        for (const key in allItems) {
            if (!key.startsWith(PROMPT_KEY_PREFIX)) continue; // Ignore unrelated keys

            if (key.includes(CHUNK_KEY_SEPARATOR)) {
                // This is a chunk key, e.g., "prompt_123_chunk_0"
                const [baseKeyWithPrefix, chunkIndexStr] = key.split(CHUNK_KEY_SEPARATOR);
                const baseKey = baseKeyWithPrefix; // baseKey still includes PROMPT_KEY_PREFIX
                const chunkIndex = parseInt(chunkIndexStr, 10);

                if (!isNaN(chunkIndex)) {
                    if (!promptsMap.has(baseKey)) {
                        // Initialize with an empty chunks array if metadata hasn't been processed yet.
                        // Metadata will be added when its key is encountered.
                        promptsMap.set(baseKey, { metadata: null, chunks: [] });
                    }
                    const promptEntry = promptsMap.get(baseKey);
                    promptEntry.chunks[chunkIndex] = allItems[key]; // Store chunk text
                } else {
                    logger.warn(`StorageManager: Invalid chunk index found in key: ${key}`);
                }
            } else {
                // This is potentially a metadata key or a non-chunked prompt key, e.g., "prompt_123"
                const promptData = allItems[key];
                if (promptData && typeof promptData === 'object' && promptData.id) {
                    if (!promptsMap.has(key)) {
                         // Initialize with metadata if chunks haven't been processed yet.
                        promptsMap.set(key, { metadata: promptData, chunks: [] });
                    } else {
                        // Chunks were processed first, now add metadata.
                        promptsMap.get(key).metadata = promptData;
                    }
                } else {
                     logger.warn(`StorageManager: Invalid prompt data or missing ID found for key: ${key}`, promptData);
                }
            }
        }

        // Second pass: Reconstruct prompts
        const finalPromptsArray = [];
        for (const [baseKey, data] of promptsMap.entries()) {
             if (!data.metadata) {
                 // This could happen if only chunks were found but no corresponding metadata item.
                 logger.warn(`StorageManager: Missing metadata for prompt with base key: ${baseKey}. Associated chunks will be ignored.`, data.chunks);
                 continue;
             }

            const { metadata, chunks } = data; // Destructure for clarity

            if (metadata.hasOwnProperty('chunkCount') && metadata.chunkCount > 0) {
                // Reconstruct chunked prompt
                logger.log(`StorageManager: Reconstructing chunked prompt ID: ${metadata.id}, expected chunks: ${metadata.chunkCount}`);
                let fullText = '';
                let missingChunk = false;
                for (let i = 0; i < metadata.chunkCount; i++) {
                    const chunkText = chunks[i]; // Access directly from the potentially sparse array
                    if (typeof chunkText === 'string') {
                        fullText += chunkText;
                    } else {
                        logger.error(`StorageManager: Missing or invalid chunk index ${i} for prompt ID: ${metadata.id} (key: ${baseKey})`);
                        missingChunk = true;
                        break;
                    }
                }

                if (!missingChunk) {
                    finalPromptsArray.push({
                        id: metadata.id,
                        title: metadata.title,
                        text: fullText
                    });
                    logger.log(`StorageManager: Successfully reconstructed prompt ID: ${metadata.id}`);
                } else {
                     logger.error(`StorageManager: Failed to reconstruct prompt ID: ${metadata.id} due to missing chunks.`);
                }

            } else if (metadata.hasOwnProperty('text')) {
                // This is a non-chunked prompt (metadata itself contains the full text)
                finalPromptsArray.push({
                    id: metadata.id,
                    title: metadata.title,
                    text: metadata.text
                });
                 logger.log(`StorageManager: Retrieved non-chunked prompt ID: ${metadata.id}`);
            } else {
                 logger.warn(`StorageManager: Metadata for key ${baseKey} (ID: ${metadata.id}) has neither 'text' nor 'chunkCount'. Skipping.`);
            }
        }

        logger.log(`StorageManager: Retrieved and processed ${finalPromptsArray.length} prompts.`);
        finalPromptsArray.sort((a, b) => a.title.localeCompare(b.title)); // Sort alphabetically by title
        return finalPromptsArray;

    } catch (error) {
        logger.error('StorageManager: Error retrieving/reconstructing prompts:', error.message, error.stack);
        return []; // Return empty array on error to prevent cascading failures
    }
}


/**
 * Saves a single prompt, automatically chunking if text exceeds MAX_CHUNK_LENGTH.
 * Handles cleaning up old data/chunks if the prompt existed before.
 * @param {object} promptObject The prompt object to save {id, title, text}.
 * @returns {Promise<void>} A promise resolving when saving is complete, or rejecting on error.
 * @throws {Error} If promptObject is invalid, or if saving/chunking fails.
 */
async function savePrompt(promptObject) {
    if (!promptObject || !promptObject.id || !promptObject.title || typeof promptObject.text !== 'string') {
        const errorMsg = 'StorageManager: Invalid prompt object provided for saving.';
        logger.error(errorMsg, promptObject);
        throw new Error(errorMsg); // Propagate error
    }

    const { id, title, text } = promptObject;
    const baseKey = `${PROMPT_KEY_PREFIX}${id}`;
    logger.log(`StorageManager: Attempting to save prompt ID: ${id}, Title: "${title}". Text length: ${text.length}.`);

    // --- Cleanup Strategy: Always remove potentially existing data first ---
    // This approach simplifies logic by not needing to know the *previous* chunk state.
    // 1. Find all keys related to this prompt ID (metadata + any old chunks).
    // 2. Remove them all.
    // 3. Save the new data (either single item or metadata + new chunks).
    try {
        const allItems = await chrome.storage.sync.get(null);
        const keysToRemove = [];
        for (const key in allItems) {
            // Matches baseKey (for metadata/non-chunked) or baseKey + _chunk_... (for chunks)
            if (key.startsWith(baseKey)) {
                keysToRemove.push(key);
            }
        }
        if (keysToRemove.length > 0) {
             logger.log(`StorageManager: Found existing data/chunks for prompt ID ${id}. Removing keys:`, keysToRemove);
             await chrome.storage.sync.remove(keysToRemove);
        } else {
             logger.log(`StorageManager: No existing data found for prompt ID ${id}. Proceeding with new save.`);
        }
    } catch (error) {
         logger.error(`StorageManager: Error during cleanup phase for prompt ID ${id}:`, error.message, error.stack);
         throw new Error(`Failed during cleanup before saving prompt "${title}". Error: ${error.message}`);
    }

    // --- Save Strategy: Check size and save accordingly ---
    try {
        // Estimate size based on string length (approximation for initial check)
        if (text.length <= MAX_CHUNK_LENGTH) {
            // Save as a single item
            const itemToSave = { id, title, text };
            const itemByteLength = new TextEncoder().encode(JSON.stringify(itemToSave)).length; // More accurate size of the storable object
            logger.log(`StorageManager: Prompt ID ${id} is small enough. Estimated object byte size: ${itemByteLength}. Saving as single item.`);

            if (itemByteLength >= 8192 - baseKey.length) { // Account for key length in QUOTA_BYTES_PER_ITEM
                logger.error(`StorageManager: CRITICAL: Calculated single item for prompt ID ${id} is too large (${itemByteLength} bytes for value, key: ${baseKey.length} bytes) even if text length is small. This might be due to very long title or ID. Aborting save.`);
                throw new Error(`Failed to save: The prompt "${title}" (even as a single item) is too large for storage. Try shortening the title or text. (Size: ${itemByteLength} bytes)`);
            }

            const dataToSave = { [baseKey]: itemToSave };
            await chrome.storage.sync.set(dataToSave);
            logger.log(`StorageManager: Prompt ID ${id} ("${title}") saved successfully as single item.`);

        } else {
            // Save as chunked item
            logger.log(`StorageManager: Prompt ID ${id} text length (${text.length}) exceeds MAX_CHUNK_LENGTH (${MAX_CHUNK_LENGTH}). Chunking necessary.`);
            const chunks = [];
            for (let i = 0; i * MAX_CHUNK_LENGTH < text.length; i++) {
                chunks.push(text.substring(i * MAX_CHUNK_LENGTH, (i + 1) * MAX_CHUNK_LENGTH));
            }
            const chunkCount = chunks.length;
            logger.log(`StorageManager: Split prompt ID ${id} ("${title}") into ${chunkCount} chunks.`);

            // Save metadata first (id, title, chunkCount)
            const metadata = { id, title, chunkCount }; // Does NOT include 'text'
            const metadataToSave = { [baseKey]: metadata };
            const metadataByteLength = new TextEncoder().encode(JSON.stringify(metadata)).length;
            if (metadataByteLength >= 8192 - baseKey.length) {
                logger.error(`StorageManager: CRITICAL: Metadata for chunked prompt ID ${id} is too large (${metadataByteLength} bytes). Aborting save.`);
                throw new Error(`Failed to save: Metadata for prompt "${title}" is too large. Try shortening the title. (Size: ${metadataByteLength} bytes)`);
            }
            logger.log(`StorageManager: Saving metadata for chunked prompt ID ${id}:`, metadata);
            await chrome.storage.sync.set(metadataToSave);

            // Save each chunk individually
            for (let i = 0; i < chunkCount; i++) {
                const chunkKey = `${baseKey}${CHUNK_KEY_SEPARATOR}${i}`;
                const chunkData = chunks[i]; // This is just the string part
                const chunkToSave = { [chunkKey]: chunkData }; // Store as { "prompt_xyz_chunk_0": "chunk text..." }

                // Check byte length of the string chunk before attempting to save
                const chunkValueByteLength = new TextEncoder().encode(chunkData).length;
                logger.log(`StorageManager: Preparing to save chunk ${i + 1}/${chunkCount} for prompt ID ${id}. Key: ${chunkKey}, Approx String Byte Size: ${chunkValueByteLength}`);

                if (chunkValueByteLength >= 8192 - chunkKey.length) {
                     logger.error(`StorageManager: CRITICAL: Calculated chunk ${i} for prompt ID ${id} ("${title}") is too large (${chunkValueByteLength} bytes for value, key: ${chunkKey.length} bytes) even after splitting by length! This can happen with text containing many multi-byte characters. Aborting save.`);
                     // Attempting cleanup of already saved metadata is complex. User needs to be alerted.
                     throw new Error(`Failed to save: A text chunk for "${title}" is too large (${chunkValueByteLength} bytes) even after splitting. The text may contain many multi-byte characters or there might be an issue with MAX_CHUNK_LENGTH. Try shortening the prompt text further.`);
                }

                try {
                    await chrome.storage.sync.set(chunkToSave);
                } catch (chunkSaveError) {
                    logger.error(`StorageManager: Error saving chunk ${i} for prompt ID ${id}:`, chunkSaveError.message, chunkSaveError.stack);
                    // If a chunk fails, the prompt is now in an inconsistent state in storage.
                    // Automatic rollback is complex and risky. Inform user loudly.
                    throw new Error(`Failed to save chunk ${i + 1} for prompt "${title}". Storage may be inconsistent. Error: ${chunkSaveError.message}`);
                }
            }
            logger.log(`StorageManager: All ${chunkCount} chunks saved successfully for prompt ID ${id} ("${title}").`);
        }
    } catch (error) {
        logger.error(`StorageManager: Error during save operation for prompt ID ${id} ("${title}"):`, error.message, error.stack);
        // Check for specific Chrome storage quota errors
        if (error.message && (error.message.includes('QUOTA_BYTES_PER_ITEM') || error.message.includes('QUOTA_BYTES'))) {
             logger.error(`StorageManager: Quota exceeded while saving prompt ID ${id}. Error: ${error.message}`);
             throw new Error(`Storage quota exceeded while saving "${title}". You may need to delete older or larger prompts. (Details: ${error.message})`);
        }
        // Re-throw specific errors from chunking logic or a generic error if not already specific
        throw error; // This will be caught by the caller in popup.js
    }
}


/**
 * Deletes a prompt and all its associated chunks (if any) from storage.
 * @param {string} promptId The ID of the prompt to delete.
 * @returns {Promise<void>} A promise resolving when deletion is complete, or rejecting on error.
 * @throws {Error} If promptId is invalid or deletion fails.
 */
async function deletePrompt(promptId) {
    if (!promptId || typeof promptId !== 'string' || promptId.trim() === '') {
        const errorMsg = 'StorageManager: Invalid prompt ID provided for deletion.';
        logger.error(errorMsg, `ID received: "${promptId}"`);
        throw new Error(errorMsg);
    }
    const baseKey = `${PROMPT_KEY_PREFIX}${promptId}`;
    logger.log(`StorageManager: Attempting to delete prompt ID: ${promptId} (base key: ${baseKey}) and any associated chunks.`);

    try {
        const allItems = await chrome.storage.sync.get(null);
        const keysToRemove = [];
        for (const key in allItems) {
            // Check if the key is the base key (metadata/non-chunked)
            // OR starts with the base key followed by the chunk separator (chunked data)
            if (key === baseKey || key.startsWith(`${baseKey}${CHUNK_KEY_SEPARATOR}`)) {
                keysToRemove.push(key);
            }
        }

        if (keysToRemove.length > 0) {
            logger.log(`StorageManager: Found keys to remove for prompt ID ${promptId}:`, keysToRemove);
            await chrome.storage.sync.remove(keysToRemove);
            logger.log(`StorageManager: Successfully removed data for prompt ID: ${promptId}.`);
        } else {
            logger.warn(`StorageManager: No data found in storage for prompt ID: ${promptId}. Deletion request effectively ignored.`);
            // Not an error, just means nothing to delete. Resolve successfully.
        }
    } catch (error) {
        logger.error(`StorageManager: Error deleting prompt ID ${promptId}:`, error.message, error.stack);
        throw new Error(`Failed to delete prompt data for ID "${promptId}". Error: ${error.message}`);
    }
}