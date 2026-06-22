// Minimal keeper example for the current SubScriptPSA ABI.
const protocol = new ethers.Contract(address, [
  "function subscriptions(uint256) view returns (address subscriber, address merchant, uint256 amount, uint256 period, uint256 nextPayment, bool isActive, address settlementToken, address paymentToken)",
  "function isSequenceExecuted(uint256 _subId, uint256 _sequenceId) view returns (bool)",
  "function isPaymentDue(uint256 _subId, uint256 _sequenceId) view returns (bool)",
  "function executePayment(uint256 _subId, uint256 _sequenceId) external"
], wallet);

async function runKeeper() {
  console.log("Keeper Bot waking up...");
  
  // 1. Check if subscription is due
  const sub = await protocol.subscriptions(1);
  let sequenceId = 1;
  while (await protocol.isSequenceExecuted(1, sequenceId)) {
    sequenceId++;
  }

  if (sub.isActive && await protocol.isPaymentDue(1, sequenceId)) {
     console.log(`Payment due for sequence ${sequenceId}. Triggering transaction...`);
     // 2. The Bot pays the gas to move the tokens
     const tx = await protocol.executePayment(1, sequenceId);
     await tx.wait();
     console.log("Success! Money moved.");
  } else {
     console.log("Not due yet. Sleeping...");
  }
}

// Run this check every 60 seconds
setInterval(runKeeper, 60000);
