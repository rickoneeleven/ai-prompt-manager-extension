# --- File: README.md ---
# AI Prompt Manager Chrome Extension

This extension allows you to store, manage, and quickly use AI system prompts.

## Development Setup for Cross-Device Sync

This extension uses `chrome.storage.sync` to synchronize your prompts across different computers where you are logged into the same Chrome profile.

**Problem:** When loading an unpacked extension during development, Chrome typically assigns a different Extension ID on each machine based on the extension's file path. `chrome.storage.sync` data is tied to the Extension ID, so without a fixed ID, data saved on one machine won't appear on another.

**Solution:** We use a fixed public key in the `manifest.json` (`key` field) to force Chrome to assign the *same* Extension ID on all machines where this specific `manifest.json` file is used.

**IMPORTANT:** The private key (`key.pem`) used to generate this public key is **required** for Chrome to accept the public key in the manifest, but it is **not included** in this repository for security reasons (it should never be committed to version control).

### Steps for Setting Up on a New Machine:

**Option A: Sync with Existing Data (Recommended if you started development elsewhere):**

1.  **Securely Copy `key.pem`:** Transfer the original `key.pem` file you generated on your first development machine to the root directory of this project on the new machine. **Do not transfer it via insecure means (like committing it to Git).** Use a secure method like `scp`, a USB drive, or a secure cloud storage service.
2.  **Load Extension:**
    *   Open Chrome and go to `chrome://extensions`.
    *   Enable "Developer mode" (usually a toggle in the top right).
    *   Click "Load unpacked".
    *   Select the directory containing this project's code (including the `manifest.json` and the `key.pem` you just copied).
    *   Chrome will now use the public key in `manifest.json` and verify it against the `key.pem` file, assigning the consistent Extension ID. Your synced prompts should appear after a short delay.

**Option B: Start Fresh on This Machine (Will NOT sync with previous data):**

If you don't have the original `key.pem` or want to start with a fresh, separate sync storage for this machine setup, you need to generate a *new* key pair:

1.  **Generate New Keys:** Open a terminal in the project's root directory and run:
    ```bash
    # Generate private key
    openssl genrsa 2048 | openssl pkcs8 -topk8 -nocrypt -out key.pem

    # Extract public key string (copy the output)
    openssl rsa -in key.pem -pubout -outform DER | openssl base64 -A
    ```
2.  **Update Manifest:** Open `manifest.json` and replace the existing value of the `key` field with the *new* public key string you just copied.
3.  **Load Extension:** Follow the "Load Extension" steps from Option A. The extension will load with a new ID based on your new key, and `chrome.storage.sync` will start fresh for this setup.

**Remember:** To sync data between machines, they **must** be loaded using the *same* `key.pem` file and the corresponding public key in `manifest.json`.