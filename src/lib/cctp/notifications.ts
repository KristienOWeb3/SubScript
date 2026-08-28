/**
 * Bridge notifications are transient: they exist to tell someone their money is moving, and they
 * are cleared once that person has actually seen them. The bell deletes anything with this source
 * after it has been on screen and read, so nobody ends up with a list of stale "moving to Arc"
 * rows.
 */
export const BRIDGE_NOTIFICATION_SOURCE = "BRIDGE";

async function createNotification(params: {
  recipientAddress: string;
  title: string;
  body: string;
}): Promise<void> {
  try {
    const { prisma } = await import("@/lib/prisma");
    await prisma.accountNotification.create({
      data: {
        recipientAddress: params.recipientAddress.toLowerCase(),
        audience: "USER",
        title: params.title,
        body: params.body,
        source: BRIDGE_NOTIFICATION_SOURCE,
      },
    });
  } catch (error) {
    /* A missing notification must never roll back or block a transfer. */
    console.warn("[cctp] could not create notification:", error);
  }
}

/** Fired as soon as the burn lands on the origin chain. */
export function notifyDepositStarted(params: {
  recipientAddress: string;
  originChainName: string;
}): Promise<void> {
  return createNotification({
    recipientAddress: params.recipientAddress,
    title: "USDC on the way",
    body: `USDC on ${params.originChainName} received, moving to Arc. Give it about five minutes.`,
  });
}

/** Fired when Arc has minted and the money is spendable. */
export function notifyDepositArrived(params: {
  recipientAddress: string;
  originChainName: string;
  netUsdc: string;
}): Promise<void> {
  return createNotification({
    recipientAddress: params.recipientAddress,
    title: "USDC arrived on Arc",
    body: `${params.netUsdc} USDC from ${params.originChainName} is in your Arc wallet and ready to use.`,
  });
}

/** Fired when a withdrawal's destination chain has minted. */
export function notifyWithdrawalArrived(params: {
  recipientAddress: string;
  destinationChainName: string;
  netUsdc: string;
}): Promise<void> {
  return createNotification({
    recipientAddress: params.recipientAddress,
    title: "Withdrawal delivered",
    body: `${params.netUsdc} USDC landed on ${params.destinationChainName}.`,
  });
}

/** Fired when a transfer has stopped retrying and needs someone to look at it. */
export function notifyTransferStalled(params: {
  recipientAddress: string;
  reason: string;
}): Promise<void> {
  return createNotification({
    recipientAddress: params.recipientAddress,
    title: "Transfer needs attention",
    body: `We couldn't finish moving your USDC. ${params.reason} Our team has been alerted, and your funds are safe.`,
  });
}
