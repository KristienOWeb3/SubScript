// This is PSEUDOCODE to show you the logic
const protocol = new ethers.Contract(address, abi, wallet);

async function runKeeper() {
  console.log("Keeper Bot waking up...");
  
  // 1. Check if subscription is due
  const sub = await protocol.subscriptions(1);
  const now = Math.floor(Date.now() / 1000);
  
  if (sub.nextPayment < now) {
     console.log("Payment Due! Triggering transaction...");
     // 2. The Bot pays the gas to move the tokens
     const tx = await protocol.executePayment(1);
     await tx.wait();
     console.log("Success! Money moved.");
  } else {
     console.log("Not due yet. Sleeping...");
  }
}

// Run this check every 60 seconds
setInterval(runKeeper, 60000);