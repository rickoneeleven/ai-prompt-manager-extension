const { execSync } = require('child_process');
const fs = require('fs');

console.log('🧪 Testing version update script...\n');

// Read current version
const manifest = JSON.parse(fs.readFileSync('manifest.json', 'utf8'));
const currentVersion = manifest.version;
console.log(`Current version: ${currentVersion}`);

// Wait a moment to ensure timestamp difference
console.log('⏳ Waiting 1 second for timestamp difference...');
setTimeout(() => {
    try {
        // Run version update
        execSync('node scripts/update-version.js', { stdio: 'inherit' });
        
        // Read new version
        const updatedManifest = JSON.parse(fs.readFileSync('manifest.json', 'utf8'));
        const newVersion = updatedManifest.version;
        
        console.log(`\n✅ Test successful!`);
        console.log(`Version changed: ${currentVersion} → ${newVersion}`);
        
        // Restore original version for testing
        manifest.version = currentVersion;
        fs.writeFileSync('manifest.json', JSON.stringify(manifest, null, 2) + '\n');
        console.log(`🔄 Restored original version: ${currentVersion}`);
        
    } catch (error) {
        console.error('❌ Test failed:', error.message);
    }
}, 1000);
