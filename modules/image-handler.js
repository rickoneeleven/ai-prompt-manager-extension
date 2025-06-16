export function parseDataURI(dataURI) {
    if (!dataURI || !dataURI.startsWith('data:')) {
        console.warn('Invalid data URI for parsing.', dataURI ? dataURI.substring(0, 40) + '...' : 'undefined');
        return null;
    }
    const commaIndex = dataURI.indexOf(',');
    if (commaIndex === -1) {
        console.warn('Malformed data URI, missing comma.', dataURI.substring(0, 40) + '...');
        return null;
    }
    const header = dataURI.substring(0, commaIndex);
    const base64Data = dataURI.substring(commaIndex + 1);
    const mimeMatch = header.match(/:(.*?);/);
    if (!mimeMatch || !mimeMatch[1]) {
        console.warn('Could not extract MIME type from data URI header.', header);
        return null;
    }
    return { mimeType: mimeMatch[1], base64Data };
}

export function base64ToBlob(base64, type = 'application/octet-stream') {
    try {
        const byteCharacters = atob(base64);
        const byteNumbers = new Array(byteCharacters.length);
        for (let i = 0; i < byteCharacters.length; i++) {
            byteNumbers[i] = byteCharacters.charCodeAt(i);
        }
        const byteArray = new Uint8Array(byteNumbers);
        return new Blob([byteArray], { type });
    } catch (e) {
        console.error("Error converting base64 to Blob:", e.message, e.stack);
        return null;
    }
}

export async function convertFileToBase64(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = error => reject(error);
        reader.readAsDataURL(file);
    });
}

export async function clearPendingImageFromBackground() {
    console.log("Requesting background SW to clear any pending image data.");
    try {
        const response = await chrome.runtime.sendMessage({ action: 'clearStoredImage' });
        if (response && response.success) {
            console.log("Background SW confirmed pending image cleared.");
        } else {
            console.warn("Background SW did not confirm pending image cleared or responded with failure.", response);
        }
    } catch (error) {
        console.error("Error sending 'clearStoredImage' message to background SW:", error.message, error.stack);
        if (error.message.includes("Could not establish connection") || error.message.includes("Receiving end does not exist")) {
             console.warn("Service worker might be inactive. This is sometimes okay for a clear operation.");
        }
    }
}

export function resetLocallyStagedImage(locallyStagedImage) {
    console.log("Resetting locally staged image data.");
    locallyStagedImage.dataURI = null;
    locallyStagedImage.mimeType = null;
    locallyStagedImage.blob = null;
}

export function insertImageIntoEditor(imgElement, userInputElement) {
    userInputElement.focus(); 
    const selection = window.getSelection();
    if (selection.rangeCount > 0) {
        const range = selection.getRangeAt(0);
        if (userInputElement.contains(range.commonAncestorContainer) || userInputElement === range.commonAncestorContainer) {
            range.deleteContents(); 
            range.insertNode(imgElement);
            range.setStartAfter(imgElement);
            range.collapse(true);
            selection.removeAllRanges();
            selection.addRange(range);
            return;
        }
    }
    console.warn("Could not determine selection/range within editor for image insertion. Appending image.");
    userInputElement.appendChild(imgElement);
}

export async function processPastedImage(imageFile, userInputElement, locallyStagedImage, callbacks) {
    console.log('Image file found in paste, starting processing...', { name: imageFile.name, type: imageFile.type });
    let dataURI = null;
    try {
        dataURI = await convertFileToBase64(imageFile);
        if (!dataURI || !dataURI.startsWith('data:')) {
            console.warn('convertFileToBase64 returned invalid dataURI. Cannot display.', { preview: dataURI ? dataURI.substring(0,50) : 'undefined' });
            alert('Pasted image data appears invalid. Could not display.');
            return null;
        }
        console.log('Image dataURI obtained, attempting to display.', { dataURI_length: dataURI.length });
        const img = document.createElement('img');
        img.src = dataURI;
        insertImageIntoEditor(img, userInputElement);
        console.log('Image displayed in user input area.');

        const parsed = parseDataURI(dataURI);
        if (parsed) {
            const blob = base64ToBlob(parsed.base64Data, parsed.mimeType);
            if (blob) {
                locallyStagedImage.dataURI = dataURI;
                locallyStagedImage.mimeType = parsed.mimeType;
                locallyStagedImage.blob = blob;
                console.log('Advanced copy data staged for image.');
                if (callbacks?.onImageProcessed) {
                    callbacks.onImageProcessed(dataURI);
                }
                return dataURI;
            }
        }
        console.warn('Could not process image for advanced copy.');
        return null;
    } catch (error) {
        console.error('Error processing pasted image:', error.message, error.stack);
        alert('Error processing pasted image. See console for details.');
        return null;
    }
}

export async function handlePendingImageCopy(buttonElement) {
    console.log("'Copy Pending Image' button clicked.");
    const response = await chrome.runtime.sendMessage({ action: 'retrieveImageForCopy' });
    if (!(response && response.success && response.data)) {
        console.error("Could not retrieve pending image data again for actual copy.");
        if(buttonElement) buttonElement.textContent = 'Error: Image data lost!';
        return;
    }
    const pendingData = response.data;
    const parsed = parseDataURI(pendingData.dataURI);

    if (parsed) {
        const blob = base64ToBlob(parsed.base64Data, parsed.mimeType);
        if (blob) {
            try {
                await navigator.clipboard.write([new ClipboardItem({ [parsed.mimeType]: blob })]);
                console.log("Pending image blob copied successfully to clipboard.");
                if(buttonElement) {
                    buttonElement.textContent = 'Image Copied!';
                    buttonElement.disabled = true;
                }
                await clearPendingImageFromBackground(); 
                setTimeout(() => { 
                    try { if(buttonElement) buttonElement.remove(); } catch(e){/* no-op */}
                }, 2000);
            } catch (error) {
                console.error("Error copying pending image blob:", error.message, error.stack);
                if(buttonElement) buttonElement.textContent = 'Error Copying Image!';
            }
        } else {
            if(buttonElement) buttonElement.textContent = 'Error Processing Image!';
            console.error("Failed to create blob for pending image from background data.");
        }
    } else {
        if(buttonElement) buttonElement.textContent = 'Error Parsing Image Data!';
        console.error("Failed to parse dataURI for pending image from background data.");
    }
}
