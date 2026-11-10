import assert from "node:assert/strict";
import test, { describe, it } from "node:test";
import { ethers } from "ethers";
import {
    generateViewingKey,
    computeViewKeyHash,
    generateCommitmentSalt,
    computeCommitment,
} from "../viewKey.ts";

describe("Arc Viewing Key & Governed Access Utilities", () => {
    it("generates a valid 32-byte hex viewing key", () => {
        const key = generateViewingKey();
        assert.equal(typeof key, "string");
        assert.equal(key.startsWith("0x"), true);
        assert.equal(key.length, 66); // 0x + 64 hex chars
        assert.match(key, /^0x[0-9a-f]{64}$/i);
    });

    it("generates two distinct viewing keys on successive calls", () => {
        const key1 = generateViewingKey();
        const key2 = generateViewingKey();
        assert.notEqual(key1, key2);
    });

    it("computes view key hash matching ethers keccak256", () => {
        const key = generateViewingKey();
        const hash = computeViewKeyHash(key);
        const expected = ethers.keccak256(key);
        assert.equal(hash, expected);
        assert.equal(hash.length, 66);
    });

    it("throws an error when computing hash on invalid key format", () => {
        assert.throws(() => computeViewKeyHash("not-a-hex-key"), {
            message: /Invalid viewing key/i,
        });
        assert.throws(() => computeViewKeyHash("0x123"), {
            message: /Invalid viewing key/i,
        });
    });

    it("computes commitment matching expected solidityPacked encoding", () => {
        const key = generateViewingKey();
        const keyHash = computeViewKeyHash(key);
        const salt = generateCommitmentSalt();
        const merchant = "0x725D56151CeaC9eAd625241D13b8307B22EDDb10";

        const commitment = computeCommitment(keyHash, merchant, salt);
        const expected = ethers.keccak256(
            ethers.solidityPacked(
                ["bytes32", "address", "bytes32"],
                [keyHash, merchant, salt]
            )
        );

        assert.equal(commitment, expected);
        assert.equal(commitment.length, 66);
    });
});
