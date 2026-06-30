const { expect } = require("chai");
const { ethers } = require("hardhat");
const {
  loadFixture,
  time,
} = require("@nomicfoundation/hardhat-network-helpers");

describe("SubScript Hardening & Chaos Testing", function () {
  /* Shared Fixture for General Hardening Tests */
  async function deployHardeningFixture() {
    const [owner, subscriber, merchant, keeper, stranger] =
      await ethers.getSigners();

    /* Deploy MockUSDC */
    const MockUSDC = await ethers.getContractFactory("MockUSDC");
    const usdc = await MockUSDC.deploy();

    /* Deploy MockStableFX */
    const MockStableFX = await ethers.getContractFactory("MockStableFX");
    const stableFX = await MockStableFX.deploy();

    /* Deploy SubScriptPSA */
    const SubScript = await ethers.getContractFactory("SubScriptPSA");
    const subScript = await SubScript.deploy(
      await usdc.getAddress(),
      await stableFX.getAddress(),
      owner.address
    );

    /* Mint USDC and approve */
    const INITIAL_BAL = ethers.parseUnits("5000", 6);
    await usdc.mint(subscriber.address, INITIAL_BAL);
    await usdc.connect(subscriber).approve(await subScript.getAddress(), INITIAL_BAL);

    const AMOUNT = ethers.parseUnits("100", 6);
    const PERIOD = 14 * 24 * 60 * 60; /* 14 days */

    return {
      usdc,
      subScript,
      owner,
      subscriber,
      merchant,
      keeper,
      stranger,
      AMOUNT,
      PERIOD,
      INITIAL_BAL
    };
  }

  describe("Reentrancy Protection", function () {
    it("should prevent reentrancy during execution using ReentrancyGuard", async function () {
      const [owner, subscriber, merchant, keeper] = await ethers.getSigners();
      
      /* Deploy MaliciousToken */
      const MaliciousToken = await ethers.getContractFactory("MaliciousToken");
      const malToken = await MaliciousToken.deploy();

      /* Deploy MockStableFX */
      const MockStableFX = await ethers.getContractFactory("MockStableFX");
      const stableFX = await MockStableFX.deploy();
      
      /* Deploy SubScriptPSA pointing to MaliciousToken and MockStableFX */
      const SubScript = await ethers.getContractFactory("SubScriptPSA");
      const subScript = await SubScript.deploy(
        await malToken.getAddress(),
        await stableFX.getAddress(),
        owner.address
      );
      
      /* Deploy ReentrancyAttacker pointing to subScript */
      const ReentrancyAttacker = await ethers.getContractFactory("ReentrancyAttacker");
      const attacker = await ReentrancyAttacker.deploy(await subScript.getAddress());
      
      /* Setup token approvals */
      const amount = ethers.parseUnits("100", 6);
      const period = 14 * 24 * 60 * 60;
      
      await malToken.approve(await subScript.getAddress(), ethers.MaxUint256);
      
      /* Create subscription */
      await subScript.createSubscription(await attacker.getAddress(), amount, period);
      
      /* Fast-forward past period */
      await time.increase(period + 1);
      
      /* Configure attacker parameters */
      await attacker.setTargetSub(1, 1);
      await malToken.setAttackParams(await attacker.getAddress(), await subScript.getAddress());
      
      /* Execute payment: should trigger reentrancy and revert with ReentrancyGuardReentrantCall */
      await expect(
        subScript.connect(keeper).executePayment(1, 1)
      ).to.be.revertedWithCustomError(subScript, "ReentrancyGuardReentrantCall");
    });
  });

  describe("Concurrency & Duplicate prevention", function () {
    it("should reject duplicate execution for the same sequence ID (idempotency check)", async function () {
      const { subScript, subscriber, merchant, keeper, AMOUNT, PERIOD } =
        await loadFixture(deployHardeningFixture);

      await subScript.connect(subscriber).createSubscription(merchant.address, AMOUNT, PERIOD);

      /* Fast forward to due time */
      await time.increase(PERIOD + 1);

      /* First execution should succeed */
      await expect(subScript.connect(keeper).executePayment(1, 1))
        .to.emit(subScript, "PaymentExecuted");

      /* Second execution of the same sequence ID 1 must revert with PaymentAlreadyExecuted */
      await expect(
        subScript.connect(keeper).executePayment(1, 1)
      ).to.be.revertedWithCustomError(subScript, "PaymentAlreadyExecuted");
    });

    it("should enforce correct temporal execution order (front-running mitigation)", async function () {
      const { subScript, subscriber, merchant, keeper, AMOUNT, PERIOD } =
        await loadFixture(deployHardeningFixture);

      await subScript.connect(subscriber).createSubscription(merchant.address, AMOUNT, PERIOD);

      /* Fast forward time only enough for sequence 1, not sequence 2 */
      await time.increase(PERIOD + 1);

      /* Attempting to execute sequence 2 before it is due must revert with PaymentNotDue */
      await expect(
        subScript.connect(keeper).executePayment(1, 2)
      ).to.be.revertedWithCustomError(subScript, "PaymentNotDue");
    });
  });

  describe("Failure Injections", function () {
    it("should revert if payment token transfer fails due to lack of subscriber balance", async function () {
      const { subScript, usdc, subscriber, merchant, keeper, AMOUNT, PERIOD } =
        await loadFixture(deployHardeningFixture);

      await subScript.connect(subscriber).createSubscription(merchant.address, AMOUNT, PERIOD);

      /* Drain subscriber balance */
      const balance = await usdc.balanceOf(subscriber.address);
      await usdc.connect(subscriber).transfer(merchant.address, balance);

      await time.increase(PERIOD + 1);

      /* Payment execution must fail on ERC20 transfer */
      await expect(
        subScript.connect(keeper).executePayment(1, 1)
      ).to.be.reverted;
    });

    it("should revert if payment execution is attempted on a cancelled subscription", async function () {
      const { subScript, subscriber, merchant, keeper, AMOUNT, PERIOD } =
        await loadFixture(deployHardeningFixture);

      await subScript.connect(subscriber).createSubscription(merchant.address, AMOUNT, PERIOD);

      /* Cancel subscription */
      await subScript.connect(subscriber).cancelSubscription(1);

      await time.increase(PERIOD + 1);

      /* Payment execution must revert with SubscriptionNotActive */
      await expect(
        subScript.connect(keeper).executePayment(1, 1)
      ).to.be.revertedWithCustomError(subScript, "SubscriptionNotActive");
    });

    it("should revert if subscription is modified to invalid parameters", async function () {
      const { subScript, subscriber, merchant, AMOUNT, PERIOD } =
        await loadFixture(deployHardeningFixture);

      await subScript.connect(subscriber).createSubscription(merchant.address, AMOUNT, PERIOD);

      await expect(
        subScript.connect(subscriber).modifySubscription(1, 0, PERIOD)
      ).to.be.revertedWithCustomError(subScript, "InvalidAmount");

      await expect(
        subScript.connect(subscriber).modifySubscription(1, AMOUNT, 0)
      ).to.be.revertedWithCustomError(subScript, "InvalidPeriod");
    });
  });
});
