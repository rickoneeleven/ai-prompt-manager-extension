const fs = require('fs');
const path = require('path');

// Generate timestamp version: YY.MM.DD.HHMM
const now = new Date();
const year = now.getFullYear().toString().slice(2);
const month = String(now.getMonth() + 1).padStart(2, '0');
const day = String(now.getDate()).padStart(2, '0');
const hour = String(now.getHours()).padStart(2, '0');
const minute = String(now.getMinutes()).padStart(2, '0');
const version = `${year}.${month}.${day}.${hour}${minute}`;

// Path to manifest.json (one level up from scripts directory)
const manifestPath = path.join(__dirname, '..', 'manifest.json');

try {
    // Read current manifest
    const manifestContent = fs.readFileSync(manifestPath, 'utf8');
    const manifest = JSON.parse(manifestContent);
    
    // Store old version for logging
    const oldVersion = manifest.version;
    
    // Update version
    manifest.version = version;
    
    // Write back to manifest.json with proper formatting
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
    
    console.log(`Version updated: ${oldVersion} → ${version}`);
    
} catch (error) {
    console.error('Error updating version:', error.message);
    process.exit(1);
}
