require("dotenv").config();
const { ethers } = require("ethers");

// 1. Configuration
const RPC_URL = process.env.RPC_URL;
const PRIVATE_KEY = process.env.PRIVATE_KEY;
const CONTRACT_ADDRESS = process.env.CONTRACT_ADDRESS;
const APP_URL = process.env.APP_URL || "http://localhost:3000";
const KEEPER_SECRET = process.env.KEEPER_SECRET;
if (!KEEPER_SECRET) {
  console.error("Keeper secret is not defined in environment variables");
  process.exit(1);
}

// 2. The ABI (Only the functions and events we need)
const CONTRACT_ABI = [
  "function executePayment(uint256 _subId) external",
  "function subscriptions(uint256) view returns (address, address, uint256, uint256, uint256, bool)",
  "function nextSubscriptionId() view returns (uint256)",
  
  // Events we listen to
  "event SubscriptionCreated(uint256 indexed subId, address indexed subscriber, address indexed merchant, uint256 amount, uint256 period)",
  "event PaymentExecuted(uint256 indexed subId, address indexed subscriber, address indexed merchant, uint256 amount, uint256 timestamp)",
  "event SubscriptionCancelled(uint256 indexed subId, address cancelledBy)",
  "event SubscriptionModified(uint256 indexed subId, uint256 newAmount, uint256 newPeriod)",
  "event SubscriptionActivated(bytes32 indexed nullifierHash, address indexed merchant, uint256 amount, uint256 period)",
  "event Withdraw(address indexed merchant, uint256 amount)",
  "event MerchantPayoutRerouted(address indexed merchant, address indexed oldDestination, address indexed newDestination)"
];

// Helper to trigger webhook dispatch endpoint
async function triggerWebhook(merchant, eventName, data) {
  try {
    const url = `${APP_URL}/api/webhooks/dispatch`;
    console.log(`🤖 [Keeper] Forwarding ${eventName} event for merchant ${merchant} to ${url}...`);
    
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${KEEPER_SECRET}`
      },
      body: JSON.stringify({
        walletAddress: merchant,
        event: eventName,
        data: data
      })
    });
    
    const result = await response.json();
    console.log(`🤖 [Keeper] Webhook dispatch response:`, result);
  } catch (err) {
    console.error(`❌ [Keeper] Failed to trigger webhook ${eventName}:`, err.message);
  }
}

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
    console.log(`Starts with: ${PRIVATE_KEY.substring(0, 2)}`);
  }
  console.log("------------------------------------------");
  // --- DEBUG CHECK END ---

  // Create Wallet and Contract
  const wallet = new ethers.Wallet(PRIVATE_KEY, provider);
  const protocol = new ethers.Contract(CONTRACT_ADDRESS, CONTRACT_ABI, wallet);

  console.log(`✅ Wallet connected: ${wallet.address}`);

  // 3. Register Event Listeners
  console.log("📡 Registering on-chain event listeners...");

  protocol.on("SubscriptionCreated", async (subId, subscriber, merchant, amount, period, event) => {
    console.log(`🔔 Event captured: SubscriptionCreated (#${subId})`);
    await triggerWebhook(merchant, "subscription.created", {
      subscriptionId: `sub_${subId}`,
      subscriber,
      merchant,
      amount: ethers.formatUnits(amount, 6) + " USDC",
      period: Number(period),
      txHash: event.log.transactionHash
    });
  });

  protocol.on("PaymentExecuted", async (subId, subscriber, merchant, amount, timestamp, event) => {
    console.log(`🔔 Event captured: PaymentExecuted (#${subId})`);
    await triggerWebhook(merchant, "subscription.payment.succeeded", {
      subscriptionId: `sub_${subId}`,
      subscriber,
      merchant,
      amount: ethers.formatUnits(amount, 6) + " USDC",
      timestamp: Number(timestamp),
      txHash: event.log.transactionHash
    });
  });

  protocol.on("SubscriptionCancelled", async (subId, cancelledBy, event) => {
    console.log(`🔔 Event captured: SubscriptionCancelled (#${subId})`);
    try {
      const sub = await protocol.subscriptions(subId);
      const merchant = sub[1];
      await triggerWebhook(merchant, "subscription.cancelled", {
        subscriptionId: `sub_${subId}`,
        cancelledBy,
        merchant,
        txHash: event.log.transactionHash
      });
    } catch (err) {
      console.error("❌ Error resolving merchant for cancel event:", err);
    }
  });

  protocol.on("SubscriptionModified", async (subId, newAmount, newPeriod, event) => {
    console.log(`🔔 Event captured: SubscriptionModified (#${subId})`);
    try {
      const sub = await protocol.subscriptions(subId);
      const merchant = sub[1];
      await triggerWebhook(merchant, "subscription.modified", {
        subscriptionId: `sub_${subId}`,
        merchant,
        newAmount: ethers.formatUnits(newAmount, 6) + " USDC",
        newPeriod: Number(newPeriod),
        txHash: event.log.transactionHash
      });
    } catch (err) {
      console.error("❌ Error resolving merchant for modify event:", err);
    }
  });

  protocol.on("SubscriptionActivated", async (nullifierHash, merchant, amount, period, event) => {
    console.log(`🔔 Event captured: SubscriptionActivated (ZK Burner)`);
    await triggerWebhook(merchant, "subscription.activated", {
      nullifierHash,
      merchant,
      amount: ethers.formatUnits(amount, 6) + " USDC",
      period: Number(period),
      txHash: event.log.transactionHash
    });
  });

  protocol.on("Withdraw", async (merchant, amount, event) => {
    console.log(`🔔 Event captured: Withdraw`);
    await triggerWebhook(merchant, "merchant.withdraw", {
      merchant,
      amount: ethers.formatUnits(amount, 6) + " USDC",
      txHash: event.log.transactionHash
    });
  });

  protocol.on("MerchantPayoutRerouted", async (merchant, oldDestination, newDestination, event) => {
    console.log(`🔔 Event captured: MerchantPayoutRerouted`);
    await triggerWebhook(merchant, "merchant.payout_rerouted", {
      merchant,
      oldDestination,
      newDestination,
      txHash: event.log.transactionHash
    });
  });

  // 4. The "Safe" Loop for due payments execution
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
      console.error("❌ Bot Loop Error:", error.message);
    }

    // WAIT 60 seconds *after* finishing, then run again
    console.log("Sleeping for 60s...");
    setTimeout(runLoop, 60000);
  }

  // Start the billing loop
  runLoop();
}

startKeeper();