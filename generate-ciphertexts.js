const crypto = require('crypto');
const fs = require('fs');

// Usage: node generate-ciphertexts.js "<public_key_file>"

function encryptSecret(publicKey, secretHex) {
    const secretBuffer = Buffer.from(secretHex, 'hex');
    const encrypted = crypto.publicEncrypt({
        key: publicKey,
        padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
        oaepHash: 'sha256'
    }, secretBuffer);
    return encrypted.toString('base64');
}

async function main() {
    const pubKeyPath = process.argv[2];
    if (!pubKeyPath) {
        console.error("Please provide the path to a file containing the Public Key from the Circle Console.");
        console.error("Example: node generate-ciphertexts.js pubkey.txt");
        process.exit(1);
    }

    const publicKey = fs.readFileSync(pubKeyPath, 'utf8');

    // The new secret we placed in .env
    const newSecret = "47e76e31b99ed36104a67eaa0c799c91ffa24aceaf409253169407a7785dd704";
    
    // The previous secrets (we'll generate ciphertexts for both candidates just in case)
    const prevSecret1 = "8fde455002d7d75ee8bfc00f6e835572acdb51d3c4e1fd3216801953fa50dafa"; // From .env.rotate
    const prevSecret2 = "f21c824846e1bc8bba212741ba4dc159ef358fdbd1b09b68f408b1852fcbb712"; // From old .env

    console.log("=========================================");
    console.log("NEW CIPHERTEXT (Paste this into the 'New Entity Secret Ciphertext' field):");
    console.log(encryptSecret(publicKey, newSecret));
    console.log("=========================================\n");

    console.log("If the console also asks for the PREVIOUS ciphertext, try these:");
    console.log("PREVIOUS CIPHERTEXT (Candidate 1 - from .env.rotate):");
    console.log(encryptSecret(publicKey, prevSecret1));
    console.log("\nPREVIOUS CIPHERTEXT (Candidate 2 - from old .env):");
    console.log(encryptSecret(publicKey, prevSecret2));
    console.log("=========================================");
}

main();
