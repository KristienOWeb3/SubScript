import { ethers } from "ethers";
import { CONFIDENTIAL_CONTRACT_ABI } from "../contracts/abis";
import { CONFIDENTIAL_CONTRACT_ADDRESS } from "../contracts/constants";

export interface DecryptedBatchRecord {
    recipients: string[];
    amounts: bigint[];
    isShielded: boolean;
    timestamp: bigint;
}

export interface DecryptedHistoryResult {
    records: DecryptedBatchRecord[];
    totalCount: bigint;
}

/**
 * Generates a cryptographically secure 32-byte Viewing Key for merchant confidentiality.
 * Must be kept secret by the merchant; never broadcast in transaction calldata.
 */
export function generateViewingKey(): string {
    const bytes = crypto.getRandomValues(new Uint8Array(32));
    return ethers.hexlify(bytes);
}

/**
 * Computes the keccak256 hash of a plaintext viewing key.
 * Only this hash is registered or referenced on-chain.
 */
export function computeViewKeyHash(viewKey: string): `0x${string}` {
    const cleanKey = viewKey.trim();
    if (!/^0x[0-9a-fA-F]{64}$/.test(cleanKey)) {
        throw new Error("Invalid viewing key: expected 32-byte hex string (0x...)");
    }
    return ethers.keccak256(cleanKey) as `0x${string}`;
}

/**
 * Generates a random 32-byte salt for blinding the commit-reveal view key registration.
 */
export function generateCommitmentSalt(): `0x${string}` {
    const bytes = crypto.getRandomValues(new Uint8Array(32));
    return ethers.hexlify(bytes) as `0x${string}`;
}

/**
 * Computes the commitment hash for Phase 1 of view key registration:
 * keccak256(abi.encodePacked(viewKeyHash, merchantAddress, salt))
 */
export function computeCommitment(
    viewKeyHash: `0x${string}`,
    merchantAddress: string,
    salt: `0x${string}`
): `0x${string}` {
    return ethers.keccak256(
        ethers.solidityPacked(
            ["bytes32", "address", "bytes32"],
            [viewKeyHash, merchantAddress, salt]
        )
    ) as `0x${string}`;
}

/**
 * Retrieves a paginated slice of decrypted batch payout history from the SubScriptConfidential
 * contract via an off-chain eth_call.
 * 
 * Invariant: The caller must be the merchant who registered the view key hash, or the call reverts.
 */
export async function fetchDecryptedBatchHistory(args: {
    runner: ethers.ContractRunner;
    merchantAddress: string;
    viewKeyHash: `0x${string}`;
    offset?: number;
    limit?: number;
    contractAddress?: string;
}): Promise<DecryptedHistoryResult> {
    const {
        runner,
        viewKeyHash,
        offset = 0,
        limit = 50,
        contractAddress = CONFIDENTIAL_CONTRACT_ADDRESS,
    } = args;

    const contract = new ethers.Contract(
        contractAddress,
        CONFIDENTIAL_CONTRACT_ABI,
        runner
    );

    const [rawRecords, totalCount] = await contract.getDecryptedBatchHistoryPaginated(
        viewKeyHash,
        BigInt(offset),
        BigInt(limit)
    );

    const records: DecryptedBatchRecord[] = (rawRecords || []).map((r: any) => ({
        recipients: Array.from(r.recipients || []),
        amounts: (r.amounts || []).map((a: any) => BigInt(a.toString())),
        isShielded: Boolean(r.isShielded),
        timestamp: BigInt(r.timestamp?.toString() || 0),
    }));

    return {
        records,
        totalCount: BigInt(totalCount?.toString() || 0),
    };
}
