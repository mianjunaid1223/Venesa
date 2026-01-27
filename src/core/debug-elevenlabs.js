
const fs = require('fs');
const path = require('path');
const https = require('https');

const ENV_PATH = path.join(process.cwd(), '.env');

async function testKeys() {
    console.log('\n=== ELEVENLABS KEY DEBUGGER ===\n');

    if (!fs.existsSync(ENV_PATH)) {
        console.log('❌ .env file NOT found at: ' + ENV_PATH);
        return;
    }
    console.log('✅ .env file found at: ' + ENV_PATH);

    const content = fs.readFileSync(ENV_PATH, 'utf8');
    const lines = content.split('\n');
    let keysFound = [];

    // 1. EXTRACT KEYS
    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;

        // Lenient regex to catch "ELEVENLABS_API_KEY = value"
        const match = trimmed.match(/^(ELEVENLABS_API_KEY(?:_\d+)?)\s*=\s*(.+)$/);

        if (match) {
            const keyName = match[1];
            let rawValue = match[2].trim();

            // Logic used in apiKeyPool.js
            // Remove quotes surrounding the value
            let key = rawValue;
            if ((key.startsWith('"') && key.endsWith('"')) || (key.startsWith("'") && key.endsWith("'"))) {
                key = key.slice(1, -1);
            }
            // Fallback cleanup (aggressive quote removal - as in current code)
            key = key.replace(/["']/g, '');

            keysFound.push({ name: keyName, key: key, raw: rawValue });
        }
    }

    if (keysFound.length === 0) {
        console.log('❌ No ELEVENLABS_API_KEY entries found in .env');
        return;
    }

    console.log(`Found ${keysFound.length} key(s). Testing each...\n`);

    // 2. TEST KEYS
    for (const item of keysFound) {
        const { name, key } = item;
        const masked = key.substring(0, 5) + '...' + key.substring(key.length - 4);
        console.log(`🔹 Testing ${name}: ${masked} (Length: ${key.length})`);

        // Test A: /v1/user
        console.log('  [Test A] Fetching User Info (v1/user)...');
        try {
            const resA = await fetchWithTimeout('https://api.elevenlabs.io/v1/user', {
                headers: { 'xi-api-key': key }
            });

            if (resA.ok) {
                const data = await resA.json();
                console.log(`  ✅ SUCCESS! Tier: ${data.subscription.tier}, Character Limit: ${data.subscription.character_limit}`);
            } else {
                console.log(`  ❌ FAILED. Status: ${resA.status} ${resA.statusText}`);
                const text = await resA.text();
                console.log(`     Response: ${text.substring(0, 100)}`);
            }
        } catch (e) {
            console.log(`  ❌ ERROR: ${e.message}`);
        }

        // Test B: /v1/voices
        console.log('  [Test B] Fetching Voices (v1/voices)...');
        try {
            const resB = await fetchWithTimeout('https://api.elevenlabs.io/v1/voices', {
                headers: { 'xi-api-key': key }
            });

            if (resB.ok) {
                console.log(`  ✅ SUCCESS! Voices Validated.`);
            } else {
                console.log(`  ❌ FAILED. Status: ${resB.status}`);
            }
        } catch (e) {
            console.log(`  ❌ ERROR: ${e.message}`);
        }
        console.log('--------------------------------------------------\n');
    }
}

// Helper with timeout
function fetchWithTimeout(url, options, timeout = 5000) {
    return Promise.race([
        fetch(url, options),
        new Promise((_, reject) =>
            setTimeout(() => reject(new Error('Request timed out')), timeout)
        )
    ]);
}

testKeys();
