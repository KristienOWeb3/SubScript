const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture } = require("@nomicfoundation/hardhat-network-helpers");

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

  describe("Deployment", function () {
    it("should set the correct initial configurations", async function () {
      const { confidentialContract, owner, treasury, usdc } = await loadFixture(deployConfidentialFixture);
      expect(await confidentialContract.paymentToken()).to.equal(await usdc.getAddress());
      expect(await confidentialContract.treasury()).to.equal(treasury.address);
      expect(await confidentialContract.owner()).to.equal(owner.address);
    });
  });

  describe("View Key Registration", function () {
    it("should allow a merchant to register a view key hash", async function () {
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
    it("should execute shielded transfer, mask event logs, and support decryption", async function () {
      const { confidentialContract, usdc, merchant, recipient1, recipient2 } = await loadFixture(deployConfidentialFixture);

      /* Register view key for merchant */
      const rawKey = ethers.randomBytes(32);
      const keyHash = ethers.keccak256(rawKey);
      await confidentialContract.connect(merchant).registerViewKey(keyHash);

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

      /* Retrieve plaintext history using view key */
      const history = await confidentialContract.connect(merchant).getDecryptedBatchHistory(rawKey);
      expect(history.length).to.equal(1);
      expect(history[0].isShielded).to.be.true;
      expect(history[0].recipients[0]).to.equal(recipient1.address);
      expect(history[0].recipients[1]).to.equal(recipient2.address);
      expect(history[0].amounts[0]).to.equal(ethers.parseUnits("50", 6));
      expect(history[0].amounts[1]).to.equal(ethers.parseUnits("75", 6));

      /* Verify invalid view key access is rejected */
      const wrongKey = ethers.randomBytes(32);
      await expect(confidentialContract.connect(merchant).getDecryptedBatchHistory(wrongKey))
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
  });
});
