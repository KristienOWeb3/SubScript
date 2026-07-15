const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture } = require("@nomicfoundation/hardhat-network-helpers");
const { mine } = require("@nomicfoundation/hardhat-network-helpers");

describe("SubScriptConfidential", function () {
  /* Shared Fixture for deployments */
  async function deployConfidentialFixture() {
    const [owner, subscriber, merchant, recipient1, recipient2, stranger, treasury] =
      await ethers.getSigners();

    /* Deploy MockUSDC */
    const MockUSDC = await ethers.getContractFactory("MockUSDC");
    const usdc = await MockUSDC.deploy();
    const usdcAddress = await usdc.getAddress();

    /* Deploy MockStableFX */
    const MockStableFX = await ethers.getContractFactory("MockStableFX");
    const stableFX = await MockStableFX.deploy();
    const stableFXAddress = await stableFX.getAddress();

    /* Deploy SubScriptConfidential (Ownable initial owner is set to owner) */
    const SubScriptConfidential = await ethers.getContractFactory("SubScriptConfidential");
    const confidentialContract = await SubScriptConfidential.deploy(
      usdcAddress,
      stableFXAddress,
      treasury.address,
      owner.address
    );
    const contractAddress = await confidentialContract.getAddress();

    /* Mint 10,000 USDC to the owner for batch payouts */
    const TEN_K = ethers.parseUnits("10000", 6);
    await usdc.mint(owner.address, TEN_K);

    /* Owner approves the contract to spend USDC */
    await usdc.connect(owner).approve(contractAddress, TEN_K);

    return {
      usdc,
      stableFX,
      confidentialContract,
      owner,
      subscriber,
      merchant,
      recipient1,
      recipient2,
      stranger,
      treasury,
      TEN_K,
    };
  }

  /* Helper: commit-reveal a view key for a merchant */
  async function commitRevealViewKey(contract, signer, rawKey) {
    const keyHash = ethers.keccak256(rawKey);
    const salt = ethers.randomBytes(32);
    const saltHex = ethers.hexlify(salt);

    // commitment = keccak256(abi.encodePacked(viewKeyHash, msg.sender, salt))
    const commitment = ethers.keccak256(
      ethers.solidityPacked(
        ["bytes32", "address", "bytes32"],
        [keyHash, signer.address, saltHex]
      )
    );

    await contract.connect(signer).commitViewKey(commitment);

    // Mine COMMIT_DELAY blocks (10)
    await mine(10);

    await contract.connect(signer).revealViewKey(keyHash, saltHex);

    return { keyHash, salt: saltHex };
  }

  describe("Deployment", function () {
    it("should set the correct initial configurations", async function () {
      const { confidentialContract, owner, treasury, usdc } = await loadFixture(deployConfidentialFixture);
      expect(await confidentialContract.paymentToken()).to.equal(await usdc.getAddress());
      expect(await confidentialContract.treasury()).to.equal(treasury.address);
      expect(await confidentialContract.owner()).to.equal(owner.address);
    });
  });

  describe("View Key Registration (Legacy)", function () {
    it("should allow a merchant to register a view key hash via legacy method", async function () {
      const { confidentialContract, merchant } = await loadFixture(deployConfidentialFixture);
      
      const rawKey = ethers.randomBytes(32);
      const keyHash = ethers.keccak256(rawKey);

      await expect(confidentialContract.connect(merchant).registerViewKey(keyHash))
        .to.emit(confidentialContract, "ViewKeyRegistered")
        .withArgs(merchant.address, keyHash);

      expect(await confidentialContract.viewKeyHashes(keyHash)).to.equal(merchant.address);
    });

    it("should prevent a third party from hijacking a registered view key hash", async function () {
      const { confidentialContract, merchant, stranger } = await loadFixture(deployConfidentialFixture);

      const keyHash = ethers.keccak256(ethers.randomBytes(32));
      await confidentialContract.connect(merchant).registerViewKey(keyHash);

      /* A different account can never claim (or front-run onto) the same hash */
      await expect(
        confidentialContract.connect(stranger).registerViewKey(keyHash)
      ).to.be.revertedWith("Key hash already registered");

      /* The current holder may re-assert their own registration */
      await confidentialContract.connect(merchant).registerViewKey(keyHash);
    });

    it("should revert if view key hash is zero", async function () {
      const { confidentialContract, merchant } = await loadFixture(deployConfidentialFixture);
      const zeroHash = ethers.zeroPadValue("0x00", 32);

      await expect(confidentialContract.connect(merchant).registerViewKey(zeroHash))
        .to.be.revertedWith("Invalid key hash");
    });
  });

  describe("View Key Registration (Commit-Reveal)", function () {
    it("should allow a merchant to register via commit-reveal", async function () {
      const { confidentialContract, merchant } = await loadFixture(deployConfidentialFixture);

      const rawKey = ethers.randomBytes(32);
      const keyHash = ethers.keccak256(rawKey);
      const salt = ethers.hexlify(ethers.randomBytes(32));

      const commitment = ethers.keccak256(
        ethers.solidityPacked(
          ["bytes32", "address", "bytes32"],
          [keyHash, merchant.address, salt]
        )
      );

      // Phase 1: commit
      await expect(confidentialContract.connect(merchant).commitViewKey(commitment))
        .to.emit(confidentialContract, "ViewKeyCommitted")
        .withArgs(merchant.address, await ethers.provider.getBlockNumber() + 1);

      // Mine enough blocks
      await mine(10);

      // Phase 2: reveal
      await expect(confidentialContract.connect(merchant).revealViewKey(keyHash, salt))
        .to.emit(confidentialContract, "ViewKeyRegistered")
        .withArgs(merchant.address, keyHash);

      expect(await confidentialContract.viewKeyHashes(keyHash)).to.equal(merchant.address);
    });

    it("should reject reveal before COMMIT_DELAY blocks", async function () {
      const { confidentialContract, merchant } = await loadFixture(deployConfidentialFixture);

      const rawKey = ethers.randomBytes(32);
      const keyHash = ethers.keccak256(rawKey);
      const salt = ethers.hexlify(ethers.randomBytes(32));

      const commitment = ethers.keccak256(
        ethers.solidityPacked(
          ["bytes32", "address", "bytes32"],
          [keyHash, merchant.address, salt]
        )
      );

      await confidentialContract.connect(merchant).commitViewKey(commitment);

      // Only mine 5 blocks (less than COMMIT_DELAY of 10)
      await mine(5);

      await expect(
        confidentialContract.connect(merchant).revealViewKey(keyHash, salt)
      ).to.be.revertedWith("Reveal too early");
    });

    it("should reject reveal after commitment expires", async function () {
      const { confidentialContract, merchant } = await loadFixture(deployConfidentialFixture);

      const rawKey = ethers.randomBytes(32);
      const keyHash = ethers.keccak256(rawKey);
      const salt = ethers.hexlify(ethers.randomBytes(32));

      const commitment = ethers.keccak256(
        ethers.solidityPacked(
          ["bytes32", "address", "bytes32"],
          [keyHash, merchant.address, salt]
        )
      );

      await confidentialContract.connect(merchant).commitViewKey(commitment);

      // Mine past COMMIT_EXPIRY (1800 blocks)
      await mine(1801);

      await expect(
        confidentialContract.connect(merchant).revealViewKey(keyHash, salt)
      ).to.be.revertedWith("Commitment expired");
    });

    it("should reject reveal with wrong salt (commitment mismatch)", async function () {
      const { confidentialContract, merchant } = await loadFixture(deployConfidentialFixture);

      const rawKey = ethers.randomBytes(32);
      const keyHash = ethers.keccak256(rawKey);
      const salt = ethers.hexlify(ethers.randomBytes(32));
      const wrongSalt = ethers.hexlify(ethers.randomBytes(32));

      const commitment = ethers.keccak256(
        ethers.solidityPacked(
          ["bytes32", "address", "bytes32"],
          [keyHash, merchant.address, salt]
        )
      );

      await confidentialContract.connect(merchant).commitViewKey(commitment);
      await mine(10);

      await expect(
        confidentialContract.connect(merchant).revealViewKey(keyHash, wrongSalt)
      ).to.be.revertedWith("Commitment mismatch");
    });

    it("should prevent front-running: attacker cannot reveal someone else's commitment", async function () {
      const { confidentialContract, merchant, stranger } = await loadFixture(deployConfidentialFixture);

      const rawKey = ethers.randomBytes(32);
      const keyHash = ethers.keccak256(rawKey);
      const salt = ethers.hexlify(ethers.randomBytes(32));

      // Merchant commits
      const commitment = ethers.keccak256(
        ethers.solidityPacked(
          ["bytes32", "address", "bytes32"],
          [keyHash, merchant.address, salt]
        )
      );
      await confidentialContract.connect(merchant).commitViewKey(commitment);
      await mine(10);

      // Attacker tries to reveal with the merchant's keyHash and salt but from their own address
      // This will fail because the commitment binds msg.sender — the stranger has no pending commitment
      await expect(
        confidentialContract.connect(stranger).revealViewKey(keyHash, salt)
      ).to.be.revertedWith("No pending commitment");
    });

    it("should prevent front-running: attacker's own commit for same hash gets blocked after legitimate reveal", async function () {
      const { confidentialContract, merchant, stranger } = await loadFixture(deployConfidentialFixture);

      const rawKey = ethers.randomBytes(32);
      const keyHash = ethers.keccak256(rawKey);

      // Merchant commits and reveals first
      const merchantSalt = ethers.hexlify(ethers.randomBytes(32));
      const merchantCommitment = ethers.keccak256(
        ethers.solidityPacked(
          ["bytes32", "address", "bytes32"],
          [keyHash, merchant.address, merchantSalt]
        )
      );
      await confidentialContract.connect(merchant).commitViewKey(merchantCommitment);
      await mine(10);
      await confidentialContract.connect(merchant).revealViewKey(keyHash, merchantSalt);

      // Attacker tries to register the same hash via their own commit-reveal
      const attackerSalt = ethers.hexlify(ethers.randomBytes(32));
      const attackerCommitment = ethers.keccak256(
        ethers.solidityPacked(
          ["bytes32", "address", "bytes32"],
          [keyHash, stranger.address, attackerSalt]
        )
      );
      await confidentialContract.connect(stranger).commitViewKey(attackerCommitment);
      await mine(10);

      // Attacker's reveal fails because the hash is already registered to merchant
      await expect(
        confidentialContract.connect(stranger).revealViewKey(keyHash, attackerSalt)
      ).to.be.revertedWith("Key hash already registered");
    });

    it("should reject commit with zero commitment", async function () {
      const { confidentialContract, merchant } = await loadFixture(deployConfidentialFixture);
      const zeroHash = ethers.zeroPadValue("0x00", 32);

      await expect(
        confidentialContract.connect(merchant).commitViewKey(zeroHash)
      ).to.be.revertedWith("Invalid commitment");
    });

    it("should reject reveal with no pending commitment", async function () {
      const { confidentialContract, merchant } = await loadFixture(deployConfidentialFixture);
      const keyHash = ethers.keccak256(ethers.randomBytes(32));
      const salt = ethers.hexlify(ethers.randomBytes(32));

      await expect(
        confidentialContract.connect(merchant).revealViewKey(keyHash, salt)
      ).to.be.revertedWith("No pending commitment");
    });
  });

  describe("Unshielded (Transparent) Batch Payouts", function () {
    it("should execute transparent batch transfer and emit counterparty list", async function () {
      const { confidentialContract, usdc, recipient1, recipient2 } = await loadFixture(deployConfidentialFixture);

      const recipients = [recipient1.address, recipient2.address];
      const amounts = [ethers.parseUnits("100", 6), ethers.parseUnits("200", 6)];
      
      const tx = await confidentialContract.executeBatchPayout(
        recipients,
        amounts,
        false, /* isShielded */
        ethers.zeroPadValue("0x00", 32) /* viewKey */
      );

      /* Verify tokens were transferred correctly */
      expect(await usdc.balanceOf(recipient1.address)).to.equal(ethers.parseUnits("100", 6));
      expect(await usdc.balanceOf(recipient2.address)).to.equal(ethers.parseUnits("200", 6));

      /* Verify standard distribution log emission */
      const receipt = await tx.wait();
      const event = receipt.logs
        .map((log) => {
          try {
            return confidentialContract.interface.parseLog(log);
          } catch {
            return null;
          }
        })
        .find((parsed) => parsed && parsed.name === "ConfidentialBatchExecuted");

      expect(event).to.not.be.null;
      
      /* In transparent mode, the event payload should contain the full unshielded arrays */
      const [recipientsArg, amountsArg] = ethers.AbiCoder.defaultAbiCoder().decode(
        ["address[]", "uint256[]"],
        event.args.encryptedPayload
      );

      expect(recipientsArg[0]).to.equal(recipient1.address);
      expect(recipientsArg[1]).to.equal(recipient2.address);
      expect(amountsArg[0]).to.equal(ethers.parseUnits("100", 6));
      expect(amountsArg[1]).to.equal(ethers.parseUnits("200", 6));
    });
  });

  describe("Shielded (Confidential) Batch Payouts", function () {
    it("should execute shielded transfer, mask event logs, and support decryption via hash", async function () {
      const { confidentialContract, usdc, merchant, recipient1, recipient2 } = await loadFixture(deployConfidentialFixture);

      /* Register view key for merchant via commit-reveal */
      const rawKey = ethers.randomBytes(32);
      const { keyHash } = await commitRevealViewKey(confidentialContract, merchant, rawKey);

      const recipients = [recipient1.address, recipient2.address];
      const amounts = [ethers.parseUnits("50", 6), ethers.parseUnits("75", 6)];

      /* Execute shielded payout — only the key HASH goes on-chain; the plaintext key
         must never appear in broadcast calldata. */
      const tx = await confidentialContract.executeBatchPayout(
        recipients,
        amounts,
        true, /* isShielded */
        keyHash
      );

      /* Verify tokens reached target destinations on-chain */
      expect(await usdc.balanceOf(recipient1.address)).to.equal(ethers.parseUnits("50", 6));
      expect(await usdc.balanceOf(recipient2.address)).to.equal(ethers.parseUnits("75", 6));

      /* Parse emitted event and verify it is masked (count and sum only) */
      const receipt = await tx.wait();
      const event = receipt.logs
        .map((log) => {
          try {
            return confidentialContract.interface.parseLog(log);
          } catch {
            return null;
          }
        })
        .find((parsed) => parsed && parsed.name === "ConfidentialBatchExecuted");

      expect(event).to.not.be.null;

      /* Decrypt/decode masked payload */
      const [totalAmountArg, countArg] = ethers.AbiCoder.defaultAbiCoder().decode(
        ["uint256", "uint256"],
        event.args.encryptedPayload
      );
      
      expect(totalAmountArg).to.equal(ethers.parseUnits("125", 6));
      expect(countArg).to.equal(2n);

      /* Retrieve plaintext history using view key HASH (not plaintext) */
      const history = await confidentialContract.connect(merchant).getDecryptedBatchHistory(keyHash);
      expect(history.length).to.equal(1);
      expect(history[0].isShielded).to.be.true;
      expect(history[0].recipients[0]).to.equal(recipient1.address);
      expect(history[0].recipients[1]).to.equal(recipient2.address);
      expect(history[0].amounts[0]).to.equal(ethers.parseUnits("50", 6));
      expect(history[0].amounts[1]).to.equal(ethers.parseUnits("75", 6));

      /* Verify unregistered hash is rejected */
      const wrongHash = ethers.keccak256(ethers.randomBytes(32));
      await expect(confidentialContract.connect(merchant).getDecryptedBatchHistory(wrongHash))
        .to.be.revertedWith("Unauthorized: Invalid View Key");
    });
  });

  describe("Governance and Security", function () {
    it("should revert if non-owner attempts to execute batch payout", async function () {
      const { confidentialContract, stranger, recipient1 } = await loadFixture(deployConfidentialFixture);

      const recipients = [recipient1.address];
      const amounts = [ethers.parseUnits("10", 6)];

      await expect(
        confidentialContract.connect(stranger).executeBatchPayout(
          recipients,
          amounts,
          false,
          ethers.zeroPadValue("0x00", 32)
        )
      ).to.be.revertedWithCustomError(confidentialContract, "OwnableUnauthorizedAccount");
    });

    it("should reject getDecryptedBatchHistory from non-registered merchant", async function () {
      const { confidentialContract, merchant, stranger } = await loadFixture(deployConfidentialFixture);

      /* Register a view key for merchant */
      const rawKey = ethers.randomBytes(32);
      const { keyHash } = await commitRevealViewKey(confidentialContract, merchant, rawKey);

      /* Stranger cannot read merchant's history even with the correct hash */
      await expect(
        confidentialContract.connect(stranger).getDecryptedBatchHistory(keyHash)
      ).to.be.revertedWith("Unauthorized: Caller is not the registered merchant");
    });
  });
});
