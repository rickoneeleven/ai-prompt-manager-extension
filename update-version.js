const fs = require('fs');
const path = require('path');

function generateTimestampVersion() {
    const now = new Date();
    const year = String(now.getFullYear()).slice(-2);
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    
    return `${year}.${month}.${day}.${hours}${minutes}`;
}

function updateManifestVersion() {
    const manifestPath = path.join(__dirname, 'manifest.json');
    
    try {
        const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
        const oldVersion = manifest.version;
        const newVersion = generateTimestampVersion();
        
        manifest.version = newVersion;
        
        fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
        
        console.log(`Version updated: ${oldVersion} → ${newVersion}`);
        return newVersion;
    } catch (error) {
        console.error('Error updating manifest version:', error);
        process.exit(1);
    }
}

if (require.main === module) {
    updateManifestVersion();
}

module.exports = { generateTimestampVersion, updateManifestVersion };
