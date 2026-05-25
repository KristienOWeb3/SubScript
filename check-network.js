const { ethers } = require("ethers");

// The 3 most likely candidates for "Arc Testnet"
const RPC_LIST = [
    "https://rpc.testnet.arc.network",   // Option A: Circle Arc Standard
    "https://arc-testnet.drpc.org",      // Option B: Circle Arc Backup
    "https://testnet-rpc.areon.network"  // Option C: Areon Network (often called Arc)
];

async function testConnection() {
    console.log("🔍 Testing connections...");

    for (const url of RPC_LIST) {
        try {
            console.log(`\nTesting: ${url}`);
            const provider = new ethers.JsonRpcProvider(url);
            
            // Try to fetch the network ID
            const network = await provider.getNetwork();
            console.log(`✅ SUCCESS! Connected to Chain ID: ${network.chainId}`);
            console.log(`>>> USE THIS URL IN YOUR .ENV FILE <<<`);
            return; // Stop after finding a working one
            
        } catch (error) {
            console.log(`❌ Failed: ${error.message.split('(')[0]}`); // Print short error
        }
    }
    
    console.log("\n❌ All URLs failed. Please check your internet connection.");
}

testConnection();