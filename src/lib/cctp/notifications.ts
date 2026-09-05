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
    title: "USDC moving to Arc",
    body: `USDC on ${params.originChainName} received, moving to arc.. (Please wait for 15 minutes)`,
  });
}

/** Fired when Arc has minted and the money is spendable. */
export async function notifyDepositArrived(params: {
  recipientAddress: string;
  originChainName: string;
  netUsdc: string;
  txHash?: string;
}): Promise<void> {
  await createNotification({
    recipientAddress: params.recipientAddress,
    title: "USDC deposited on Arc",
    body: `USDC deposited is now on the arc network (${params.netUsdc} USDC from ${params.originChainName}).`,
  });

  try {
    const { resolveRecipient, safelySendEmail } = await import("@/lib/email/core");
    const email = await resolveRecipient(params.recipientAddress, "transactional");
    if (email) {
      const { sendDepositReceivedEmail } = await import("@/lib/email/transactional");
      await safelySendEmail("deposit received email", () => sendDepositReceivedEmail({
        recipientEmail: email,
        amountUsdc: params.netUsdc,
        originChainName: params.originChainName,
        txHash: params.txHash,
      }));
    }
  } catch (emailErr) {
    console.warn("[cctp] could not send deposit confirmation email:", emailErr);
  }
}

/** Fired when a withdrawal's destination chain has minted. */
export async function notifyWithdrawalArrived(params: {
  recipientAddress: string;
  destinationChainName: string;
  netUsdc: string;
  destinationAddress?: string;
  txHash?: string;
}): Promise<void> {
  await createNotification({
    recipientAddress: params.recipientAddress,
    title: "Withdrawal delivered",
    body: `${params.netUsdc} USDC landed on ${params.destinationChainName}.`,
  });

  try {
    const { resolveRecipient, safelySendEmail } = await import("@/lib/email/core");
    const email = await resolveRecipient(params.recipientAddress, "transactional");
    if (email) {
      const { sendWithdrawalCompletedEmail } = await import("@/lib/email/transactional");
      await safelySendEmail("withdrawal completed email", () => sendWithdrawalCompletedEmail({
        recipientEmail: email,
        amountUsdc: params.netUsdc,
        destinationChainName: params.destinationChainName,
        destinationAddress: params.destinationAddress,
        txHash: params.txHash,
      }));
    }
  } catch (emailErr) {
    console.warn("[cctp] could not send withdrawal delivery email:", emailErr);
  }
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

const lastGasAlertTime = new Map<string, number>();
const SIX_HOURS_MS = 6 * 60 * 60 * 1000;

/** Fired when native gas on a router or relayer address is below the operating threshold. */
export async function notifyAdminsLowGas(params: {
  chainName: string;
  chainId: number | string;
  walletAddress: string;
  walletRole: "Router Address" | "Relayer / Sponsor Wallet";
  balanceFormatted: string;
  tokenSymbol: string;
  thresholdFormatted: string;
}): Promise<void> {
  const key = `${params.chainId}:${params.walletAddress.toLowerCase()}`;
  const now = Date.now();
  const lastTime = lastGasAlertTime.get(key) || 0;
  if (now - lastTime < SIX_HOURS_MS) {
    return;
  }
  lastGasAlertTime.set(key, now);

  try {
    const { prisma } = await import("@/lib/prisma");
    const { listAdminNotificationEmails } = await import("@/lib/email/adminRecipients");
    const { sendAdminLowGasAlertEmail } = await import("@/lib/email/transactional");
    const { listRootAdmins } = await import("@/lib/admin/identity");

    const adminWallets = new Set<string>();
    for (const w of listRootAdmins()) {
      if (w) adminWallets.add(w.toLowerCase());
    }
    try {
      const delegated = await prisma.adminWallet.findMany({ select: { wallet: true } });
      delegated.forEach((r) => adminWallets.add(r.wallet.toLowerCase()));
    } catch {}

    const title = `⚠️ Low Gas Alert: ${params.chainName}`;
    const body = `Gas is running low on ${params.chainName} (${params.walletRole} ${params.walletAddress}). Current balance: ${params.balanceFormatted} ${params.tokenSymbol} (Threshold: ${params.thresholdFormatted} ${params.tokenSymbol}). Please top up to maintain automated sweeps.`;

    for (const adminAddr of adminWallets) {
      await prisma.accountNotification.create({
        data: {
          recipientAddress: adminAddr,
          audience: "ADMIN",
          title,
          body,
          source: "OPS_ALERT",
        },
      }).catch(() => undefined);
    }

    const adminEmails = await listAdminNotificationEmails();
    for (const email of adminEmails) {
      await sendAdminLowGasAlertEmail({
        adminEmail: email,
        chainName: params.chainName,
        chainId: params.chainId,
        walletAddress: params.walletAddress,
        walletRole: params.walletRole,
        balanceFormatted: params.balanceFormatted,
        tokenSymbol: params.tokenSymbol,
        thresholdFormatted: params.thresholdFormatted,
      }).catch((err) => console.warn("[cctp] low gas email send failed:", err?.message));
    }
  } catch (error) {
    console.warn("[cctp] could not notify admins of low gas:", error);
  }
}
