import { test, expect } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { SignJWT } from "jose";
import dotenv from "dotenv";

// Load local environment variables (.env)
dotenv.config();

const prisma = new PrismaClient();

// Helper to generate a valid subscript_session_token JWT signed with JWT_SECRET
async function createAuthCookie(address: string): Promise<string> {
  const secretStr = process.env.JWT_SECRET || "mock_jwt_secret_for_testing_32_characters";
  const secret = new TextEncoder().encode(secretStr);
  const now = Date.now();
  return await new SignJWT({ address: address.toLowerCase(), authenticatedAt: now })
    .setProtectedHeader({ alg: "HS256" })
    .setExpirationTime("30d")
    .sign(secret);
}

// Generate random mock addresses for the test
const payerAddress = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
const merchantAddress = "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC";
const treasuryAddress = "0x725D56151CeaC9eAd625241D13b8307B22EDDb10"; // PREMIUM_PAYMENT_RECIPIENT_ADDRESS from contract constants
const strangerAddress = "0x90F79bf6EB2c4f870365E785982E1f101E93b906";
const invitedAddress = "0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65";

test.describe("SubScript Receipt Privacy E2E Integration Flow", () => {
  let receiptId: string;
  let txHash: string;

  test.beforeAll(async () => {
    receiptId = `test-receipt-${Date.now()}`;
    txHash = `0x${Array.from({ length: 64 }, () => Math.floor(Math.random() * 16).toString(16)).join("")}`;

    console.log(`[TEST SETUP] Creating mock receipt ${receiptId} in database...`);
    
    // Seed database with a private receipt
    await prisma.receipt.create({
      data: {
        receiptId,
        txHash,
        chainId: 5042002,
        memoContract: "0x835A9aEd7287068778e11df9D922B3FfaC7cFc29",
        payerAddress: payerAddress.toLowerCase(),
        merchantAddress: merchantAddress.toLowerCase(),
        amountUsdc: BigInt(25000000), // $25.00 USDC
        shareUrl: `https://subscript.app/receipt/${receiptId}`,
        status: "SUCCESS",
        invitedAddresses: ""
      }
    });
  });

  test.afterAll(async () => {
    console.log(`[TEST TEARDOWN] Cleaning up mock receipt ${receiptId}...`);
    try {
      await prisma.receipt.delete({
        where: { receiptId }
      });
    } catch (e) {
      console.warn("Teardown warning (receipt may have already been deleted):", e);
    }
    await prisma.$disconnect();
  });

  test("1. should reject unauthenticated requests to read private receipt", async ({ request }) => {
    const response = await request.get(`/api/receipts/${receiptId}`);
    expect(response.status()).toBe(401);
    
    const body = await response.json();
    expect(body.error).toContain("Private Receipt: Connect your wallet to authenticate.");
  });

  test("2. should reject authenticated but unauthorized viewer", async ({ request }) => {
    const strangerToken = await createAuthCookie(strangerAddress);
    
    const response = await request.get(`/api/receipts/${receiptId}`, {
      headers: {
        Cookie: `subscript_session_token=${strangerToken}`
      }
    });
    
    expect(response.status()).toBe(403);
    const body = await response.json();
    expect(body.error).toContain("Private Receipt: Unauthorized viewer.");
  });

  test("3. should allow payer, merchant, and treasury to view private receipt", async ({ request }) => {
    const payerToken = await createAuthCookie(payerAddress);
    const merchantToken = await createAuthCookie(merchantAddress);
    const treasuryToken = await createAuthCookie(treasuryAddress);

    // Test payer
    const resPayer = await request.get(`/api/receipts/${receiptId}`, {
      headers: { Cookie: `subscript_session_token=${payerToken}` }
    });
    expect(resPayer.status()).toBe(200);
    const bodyPayer = await resPayer.json();
    expect(bodyPayer.receipt.receipt_id).toBe(receiptId);

    // Test merchant
    const resMerchant = await request.get(`/api/receipts/${receiptId}`, {
      headers: { Cookie: `subscript_session_token=${merchantToken}` }
    });
    expect(resMerchant.status()).toBe(200);

    // Test treasury
    const resTreasury = await request.get(`/api/receipts/${receiptId}`, {
      headers: { Cookie: `subscript_session_token=${treasuryToken}` }
    });
    expect(resTreasury.status()).toBe(200);
  });

  test("4. should delegate access by inviting an address, and granting read permissions to them", async ({ request }) => {
    const payerToken = await createAuthCookie(payerAddress);
    const invitedToken = await createAuthCookie(invitedAddress);

    // Invited address should not have access initially
    const resBefore = await request.get(`/api/receipts/${receiptId}`, {
      headers: { Cookie: `subscript_session_token=${invitedToken}` }
    });
    expect(resBefore.status()).toBe(403);

    // Stranger cannot invite others
    const strangerToken = await createAuthCookie(strangerAddress);
    const resStrangerInvite = await request.post(`/api/receipts/invite`, {
      headers: { Cookie: `subscript_session_token=${strangerToken}` },
      data: {
        receiptId,
        inviteAddress: invitedAddress
      }
    });
    expect(resStrangerInvite.status()).toBe(403);

    // Payer invites the viewer
    const resInvite = await request.post(`/api/receipts/invite`, {
      headers: { Cookie: `subscript_session_token=${payerToken}` },
      data: {
        receiptId,
        inviteAddress: invitedAddress
      }
    });
    expect(resInvite.status()).toBe(200);

    // Invited address should now have access
    const resAfter = await request.get(`/api/receipts/${receiptId}`, {
      headers: { Cookie: `subscript_session_token=${invitedToken}` }
    });
    expect(resAfter.status()).toBe(200);
    const bodyAfter = await resAfter.json();
    expect(bodyAfter.receipt.receipt_id).toBe(receiptId);
  });
});
