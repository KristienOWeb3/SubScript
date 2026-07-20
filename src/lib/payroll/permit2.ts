/* Shared Permit2 (AllowanceTransfer) EIP-712 construction for payroll.
 *
 * The frontend signer, the embedded server signer, and the keeper that submits `permit()` all build
 * the message from THIS module, so the signed message and the on-chain reconstruction can never
 * drift (a drift would make the signature fail to verify and the payout revert).
 *
 * Design: one bounded authorization for one payday. The signed amount is the
 * exact recipient total, expiry is shortly after that payday, and the signature
 * can only be submitted briefly after creation. A compromised keeper therefore
 * cannot drain an organization beyond the payroll the merchant approved.
 */

export const PERMIT2_ADDRESS = "0x000000000022D473030F116dDEE9F6B43aC78BA3" as const;

export const PERMIT2_MAX_AMOUNT = BigInt("0xffffffffffffffffffffffffffffffffffffffff");
const MAX_FREQUENCY_DAYS = 366;
const AUTHORIZATION_GRACE_SECONDS = 6 * 60 * 60;
const SIGNATURE_WINDOW_SECONDS = 15 * 60;

/* EIP-712 types (no EIP712Domain entry — both viem and ethers add it from the domain). */
export const PERMIT2_TYPES = {
    PermitSingle: [
        { name: "details", type: "PermitDetails" },
        { name: "spender", type: "address" },
        { name: "sigDeadline", type: "uint256" },
    ],
    PermitDetails: [
        { name: "token", type: "address" },
        { name: "amount", type: "uint160" },
        { name: "expiration", type: "uint48" },
        { name: "nonce", type: "uint48" },
    ],
} as const;

export function permit2Domain(chainId: number) {
    return { name: "Permit2", chainId, verifyingContract: PERMIT2_ADDRESS } as const;
}

export type PermitSingleMessage = {
    details: { token: string; amount: bigint; expiration: bigint; nonce: bigint };
    spender: string;
    sigDeadline: bigint;
};

export function payrollPermitWindow(frequencyDays: number, nowSeconds = Math.floor(Date.now() / 1000)) {
    if (!Number.isInteger(frequencyDays) || frequencyDays < 1 || frequencyDays > MAX_FREQUENCY_DAYS) {
        throw new Error(`Payroll frequency must be between 1 and ${MAX_FREQUENCY_DAYS} days.`);
    }
    const firstPaydaySeconds = nowSeconds + frequencyDays * 24 * 60 * 60;
    return {
        expiration: BigInt(firstPaydaySeconds + AUTHORIZATION_GRACE_SECONDS),
        sigDeadline: BigInt(firstPaydaySeconds + AUTHORIZATION_GRACE_SECONDS),
    };
}

/* Build the exact PermitSingle signed by the merchant and reconstructed by the keeper. */
export function buildPermitSingle(
    token: string,
    spender: string,
    nonce: number | bigint,
    amount: number | bigint,
    expiration: number | bigint,
    sigDeadline: number | bigint,
): PermitSingleMessage {
    const boundedAmount = BigInt(amount);
    if (boundedAmount <= BigInt(0) || boundedAmount > PERMIT2_MAX_AMOUNT) {
        throw new Error("Payroll authorization amount is outside Permit2's uint160 range.");
    }
    return {
        details: {
            token,
            amount: boundedAmount,
            expiration: BigInt(expiration),
            nonce: BigInt(nonce),
        },
        spender,
        sigDeadline: BigInt(sigDeadline),
    };
}
