require("dotenv").config();
const { ethers } = require("ethers");

// 1. Configuration
const RPC_URL = process.env.RPC_URL;
const PRIVATE_KEY = process.env.PRIVATE_KEY;
const CONTRACT_ADDRESS = process.env.CONTRACT_ADDRESS;

// 2. The ABI (Only the functions we need)
const CONTRACT_ABI = [
  "function executePayment(uint256 _subId) external",
  "function subscriptions(uint256) view returns (address, address, uint256, uint256, uint256, bool)",
  "function nextSubscriptionId() view returns (uint256)"
];

async function startKeeper() {
  console.log("🤖 Keeper Bot starting on Arc Testnet...");
  
  // Connect to the Network
  const provider = new ethers.JsonRpcProvider(RPC_URL);

  // --- DEBUG CHECK START ---
  console.log("----------------Debug Info----------------");
  if (!PRIVATE_KEY) {
    console.log("❌ Error: Private Key is UNDEFINED / Empty in .env file");
    return; // STOP here if key is missing
  } else {
    console.log(`✅ Private Key found. Length: ${PRIVATE_KEY.length} characters`);
    console.log(`Starts with: ${PRIVATE_KEY.substring(0, 2)}`); // Should print "0x"
  }
  console.log("------------------------------------------");
  // --- DEBUG CHECK END ---

  // Create Wallet and Contract
  const wallet = new ethers.Wallet(PRIVATE_KEY, provider);
  const protocol = new ethers.Contract(CONTRACT_ADDRESS, CONTRACT_ABI, wallet);

  console.log(`✅ Wallet connected: ${wallet.address}`);

  // 3. The "Safe" Loop (Prevents overlaps)
  async function runLoop() {
    try {
      console.log("Checking for due subscriptions...");
      
      const nextId = await protocol.nextSubscriptionId();
      const currentTimestamp = Math.floor(Date.now() / 1000);

      for (let i = 1; i < nextId; i++) {
        const sub = await protocol.subscriptions(i);
        const isActive = sub[5];
        const nextPayment = Number(sub[4]);

        if (isActive && currentTimestamp >= nextPayment) {
          console.log(`⚡ Sub #${i} is DUE! Executing payment...`);
          const tx = await protocol.executePayment(i);
          console.log(`   Tx Sent: ${tx.hash}`);
          await tx.wait();
          console.log(`✅ Payment Executed for Sub #${i}`);
        }
      }
    } catch (error) {
      console.error("❌ Bot Error:", error.message);
    }

    // WAIT 60 seconds *after* finishing, then run again
    console.log("Sleeping for 60s...");
    setTimeout(runLoop, 60000);
  }

  // Start the loop for the first time
  runLoop();
}

startKeeper();