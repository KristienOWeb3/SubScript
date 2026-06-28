/* Shared Permit2 (AllowanceTransfer) EIP-712 construction for payroll.
 *
 * The frontend signer, the embedded server signer, and the keeper that submits `permit()` all build
 * the message from THIS module, so the signed message and the on-chain reconstruction can never
 * drift (a drift would make the signature fail to verify and the payout revert).
 *
 * Design: one fixed authorization for the lifetime of the campaign — max allowance + max expiration
 * — so the keeper calls `permit()` exactly once and every payday after is a plain `transferFrom`.
 * The ONLY dynamic field is `nonce`, read fresh from chain at sign time and persisted on the campaign.
 */

export const PERMIT2_ADDRESS = "0x000000000022D473030F116dDEE9F6B43aC78BA3" as const;

/* uint160 max (allowance amount) */
export const PERMIT2_MAX_AMOUNT = BigInt("0xffffffffffffffffffffffffffffffffffffffff");
/* uint48 max (allowance expiration) */
export const PERMIT2_MAX_EXPIRATION = BigInt("0xffffffffffff");
/* uint256 max (signature submission deadline) */
export const PERMIT2_SIG_DEADLINE = BigInt("0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff");

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

/* Build the PermitSingle message. `token` = USDC, `spender` = the keeper address,
   `nonce` = current on-chain Permit2 nonce for (owner, token, spender). */
export function buildPermitSingle(token: string, spender: string, nonce: number | bigint): PermitSingleMessage {
    return {
        details: {
            token,
            amount: PERMIT2_MAX_AMOUNT,
            expiration: PERMIT2_MAX_EXPIRATION,
            nonce: BigInt(nonce),
        },
        spender,
        sigDeadline: PERMIT2_SIG_DEADLINE,
    };
}
