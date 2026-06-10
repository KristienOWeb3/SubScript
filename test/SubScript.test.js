const { expect } = require("chai");
const { ethers } = require("hardhat");
const {
  loadFixture,
  time,
} = require("@nomicfoundation/hardhat-network-helpers");

describe("SubScript", function () {
  /* Shared Fixture */
  async function deployFixture() {
    const [owner, subscriber, merchant, keeper, stranger] =
      await ethers.getSigners();

    /* Deploy MockUSDC */
    const MockUSDC = await ethers.getContractFactory("MockUSDC");
    const usdc = await MockUSDC.deploy();

    /* Deploy SubScript */
    const SubScript = await ethers.getContractFactory("SubScript");
    const subScript = await SubScript.deploy(await usdc.getAddress());

    /* Mint 10 000 USDC to the subscriber (6 decimals) */
    const TEN_K = ethers.parseUnits("10000", 6);
    await usdc.mint(subscriber.address, TEN_K);

    /* Subscriber approves SubScript for 10 000 USDC */
    await usdc.connect(subscriber).approve(await subScript.getAddress(), TEN_K);

    const AMOUNT = ethers.parseUnits("15", 6); /* 15 USDC */
    const PERIOD = 30 * 24 * 60 * 60; /* 30 days in seconds */

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
      TEN_K,
    };
  }

  /* DEPLOYMENT */
  describe("Deployment", function () {
    it("should set the correct payment token", async function () {
      const { subScript, usdc } = await loadFixture(deployFixture);
      expect(await subScript.paymentToken()).to.equal(
        await usdc.getAddress()
      );
    });

    it("should start nextSubscriptionId at 1", async function () {
      const { subScript } = await loadFixture(deployFixture);
      expect(await subScript.nextSubscriptionId()).to.equal(1);
    });

    it("should revert if deployed with address(0)", async function () {
      const SubScript = await ethers.getContractFactory("SubScript");
      await expect(
        SubScript.deploy(ethers.ZeroAddress)
      ).to.be.revertedWithCustomError(SubScript, "InvalidAddress");
    });
  });

  /* CREATE SUBSCRIPTION */
  describe("createSubscription", function () {
    it("should create a subscription and take the first payment", async function () {
      const { subScript, usdc, subscriber, merchant, AMOUNT, PERIOD } =
        await loadFixture(deployFixture);

      const merchantBalBefore = await usdc.balanceOf(merchant.address);

      await expect(
        subScript
          .connect(subscriber)
          .createSubscription(merchant.address, AMOUNT, PERIOD)
      )
        .to.emit(subScript, "SubscriptionCreated")
        .withArgs(1, subscriber.address, merchant.address, AMOUNT, PERIOD);

      /* Verify first payment was taken */
      const merchantBalAfter = await usdc.balanceOf(merchant.address);
      expect(merchantBalAfter - merchantBalBefore).to.equal(AMOUNT);

      /* Verify subscription data */
      const sub = await subScript.subscriptions(1);
      expect(sub.subscriber).to.equal(subscriber.address);
      expect(sub.merchant).to.equal(merchant.address);
      expect(sub.amount).to.equal(AMOUNT);
      expect(sub.period).to.equal(PERIOD);
      expect(sub.isActive).to.be.true;

      /* nextSubscriptionId should now be 2 */
      expect(await subScript.nextSubscriptionId()).to.equal(2);
    });

    it("should revert with InvalidAddress for zero merchant", async function () {
      const { subScript, subscriber, AMOUNT, PERIOD } =
        await loadFixture(deployFixture);

      await expect(
        subScript
          .connect(subscriber)
          .createSubscription(ethers.ZeroAddress, AMOUNT, PERIOD)
      ).to.be.revertedWithCustomError(subScript, "InvalidAddress");
    });

    it("should revert with InvalidAmount for zero amount", async function () {
      const { subScript, subscriber, merchant, PERIOD } =
        await loadFixture(deployFixture);

      await expect(
        subScript
          .connect(subscriber)
          .createSubscription(merchant.address, 0, PERIOD)
      ).to.be.revertedWithCustomError(subScript, "InvalidAmount");
    });

    it("should revert with InvalidPeriod for zero period", async function () {
      const { subScript, subscriber, merchant, AMOUNT } =
        await loadFixture(deployFixture);

      await expect(
        subScript
          .connect(subscriber)
          .createSubscription(merchant.address, AMOUNT, 0)
      ).to.be.revertedWithCustomError(subScript, "InvalidPeriod");
    });
  });

  /* EXECUTE PAYMENT */
  describe("executePayment", function () {
    it("should execute payment when due", async function () {
      const { subScript, usdc, subscriber, merchant, keeper, AMOUNT, PERIOD } =
        await loadFixture(deployFixture);

      /* Create subscription */
      await subScript
        .connect(subscriber)
        .createSubscription(merchant.address, AMOUNT, PERIOD);

      /* Fast-forward time past the period */
      await time.increase(PERIOD + 1);

      const merchantBalBefore = await usdc.balanceOf(merchant.address);

      await expect(subScript.connect(keeper).executePayment(1, 1))
        .to.emit(subScript, "PaymentExecuted");

      const merchantBalAfter = await usdc.balanceOf(merchant.address);
      expect(merchantBalAfter - merchantBalBefore).to.equal(AMOUNT);
    });

    it("should revert if payment is not yet due", async function () {
      const { subScript, subscriber, merchant, AMOUNT, PERIOD } =
        await loadFixture(deployFixture);

      await subScript
        .connect(subscriber)
        .createSubscription(merchant.address, AMOUNT, PERIOD);

      /* Try to execute immediately — should fail */
      await expect(
        subScript.executePayment(1, 1)
      ).to.be.revertedWithCustomError(subScript, "PaymentNotDue");
    });

    it("should revert if subscription is inactive", async function () {
      const { subScript, subscriber, merchant, AMOUNT, PERIOD } =
        await loadFixture(deployFixture);

      await subScript
        .connect(subscriber)
        .createSubscription(merchant.address, AMOUNT, PERIOD);

      /* Cancel the subscription */
      await subScript.connect(subscriber).cancelSubscription(1);

      await time.increase(PERIOD + 1);

      await expect(
        subScript.executePayment(1, 1)
      ).to.be.revertedWithCustomError(subScript, "SubscriptionNotActive");
    });

    it("should revert if subscriber has insufficient allowance", async function () {
      const { subScript, usdc, subscriber, merchant, AMOUNT, PERIOD } =
        await loadFixture(deployFixture);

      await subScript
        .connect(subscriber)
        .createSubscription(merchant.address, AMOUNT, PERIOD);

      /* Revoke all remaining allowance */
      await usdc
        .connect(subscriber)
        .approve(await subScript.getAddress(), 0);

      await time.increase(PERIOD + 1);

      /* Should revert because allowance is 0 */
      await expect(subScript.executePayment(1, 1)).to.be.reverted;
    });

    it("should revert if subscriber has insufficient balance", async function () {
      const { subScript, usdc, subscriber, merchant, keeper, AMOUNT, PERIOD } =
        await loadFixture(deployFixture);

      await subScript
        .connect(subscriber)
        .createSubscription(merchant.address, AMOUNT, PERIOD);

      /* Drain subscriber balance (transfer all to merchant) */
      const bal = await usdc.balanceOf(subscriber.address);
      await usdc.connect(subscriber).transfer(merchant.address, bal);

      await time.increase(PERIOD + 1);

      await expect(subScript.connect(keeper).executePayment(1, 1)).to.be.reverted;
    });

    it("should allow multiple sequential payments", async function () {
      const { subScript, usdc, subscriber, merchant, keeper, AMOUNT, PERIOD } =
        await loadFixture(deployFixture);

      await subScript
        .connect(subscriber)
        .createSubscription(merchant.address, AMOUNT, PERIOD);

      /* Execute 3 consecutive payments */
      for (let i = 1; i <= 3; i++) {
        await time.increase(PERIOD + 1);
        await subScript.connect(keeper).executePayment(1, i);
      }

      /* Merchant should have received 4 payments total (1 initial + 3) */
      const merchantBal = await usdc.balanceOf(merchant.address);
      expect(merchantBal).to.equal(AMOUNT * 4n);
    });
  });

  /* CANCEL SUBSCRIPTION */
  describe("cancelSubscription", function () {
    it("should allow subscriber to cancel", async function () {
      const { subScript, subscriber, merchant, AMOUNT, PERIOD } =
        await loadFixture(deployFixture);

      await subScript
        .connect(subscriber)
        .createSubscription(merchant.address, AMOUNT, PERIOD);

      await expect(subScript.connect(subscriber).cancelSubscription(1))
        .to.emit(subScript, "SubscriptionCancelled")
        .withArgs(1, subscriber.address);

      const sub = await subScript.subscriptions(1);
      expect(sub.isActive).to.be.false;
    });

    it("should allow merchant to cancel", async function () {
      const { subScript, subscriber, merchant, AMOUNT, PERIOD } =
        await loadFixture(deployFixture);

      await subScript
        .connect(subscriber)
        .createSubscription(merchant.address, AMOUNT, PERIOD);

      await expect(subScript.connect(merchant).cancelSubscription(1))
        .to.emit(subScript, "SubscriptionCancelled")
        .withArgs(1, merchant.address);
    });

    it("should revert if caller is neither subscriber nor merchant", async function () {
      const { subScript, subscriber, merchant, stranger, AMOUNT, PERIOD } =
        await loadFixture(deployFixture);

      await subScript
        .connect(subscriber)
        .createSubscription(merchant.address, AMOUNT, PERIOD);

      await expect(
        subScript.connect(stranger).cancelSubscription(1)
      ).to.be.revertedWithCustomError(subScript, "NotAuthorized");
    });

    it("should revert if subscription is already cancelled", async function () {
      const { subScript, subscriber, merchant, AMOUNT, PERIOD } =
        await loadFixture(deployFixture);

      await subScript
        .connect(subscriber)
        .createSubscription(merchant.address, AMOUNT, PERIOD);

      await subScript.connect(subscriber).cancelSubscription(1);

      await expect(
        subScript.connect(subscriber).cancelSubscription(1)
      ).to.be.revertedWithCustomError(subScript, "SubscriptionNotActive");
    });
  });

  /* MODIFY SUBSCRIPTION */
  describe("modifySubscription", function () {
    it("should allow subscriber to modify amount and period", async function () {
      const { subScript, subscriber, merchant, AMOUNT, PERIOD } =
        await loadFixture(deployFixture);

      await subScript
        .connect(subscriber)
        .createSubscription(merchant.address, AMOUNT, PERIOD);

      const newAmount = ethers.parseUnits("25", 6);
      const newPeriod = 7 * 24 * 60 * 60; /* 7 days */

      await expect(
        subScript.connect(subscriber).modifySubscription(1, newAmount, newPeriod)
      )
        .to.emit(subScript, "SubscriptionModified")
        .withArgs(1, newAmount, newPeriod);

      const sub = await subScript.subscriptions(1);
      expect(sub.amount).to.equal(newAmount);
      expect(sub.period).to.equal(newPeriod);
    });

    it("should revert if caller is not the subscriber", async function () {
      const { subScript, subscriber, merchant, stranger, AMOUNT, PERIOD } =
        await loadFixture(deployFixture);

      await subScript
        .connect(subscriber)
        .createSubscription(merchant.address, AMOUNT, PERIOD);

      await expect(
        subScript
          .connect(stranger)
          .modifySubscription(1, AMOUNT, PERIOD)
      ).to.be.revertedWithCustomError(subScript, "NotAuthorized");
    });

    it("should revert for zero new amount", async function () {
      const { subScript, subscriber, merchant, AMOUNT, PERIOD } =
        await loadFixture(deployFixture);

      await subScript
        .connect(subscriber)
        .createSubscription(merchant.address, AMOUNT, PERIOD);

      await expect(
        subScript.connect(subscriber).modifySubscription(1, 0, PERIOD)
      ).to.be.revertedWithCustomError(subScript, "InvalidAmount");
    });

    it("should revert for zero new period", async function () {
      const { subScript, subscriber, merchant, AMOUNT, PERIOD } =
        await loadFixture(deployFixture);

      await subScript
        .connect(subscriber)
        .createSubscription(merchant.address, AMOUNT, PERIOD);

      await expect(
        subScript.connect(subscriber).modifySubscription(1, AMOUNT, 0)
      ).to.be.revertedWithCustomError(subScript, "InvalidPeriod");
    });
  });

  /* VIEW HELPERS */
  describe("isPaymentDue", function () {
    it("should return false when not yet due", async function () {
      const { subScript, subscriber, merchant, AMOUNT, PERIOD } =
        await loadFixture(deployFixture);

      await subScript
        .connect(subscriber)
        .createSubscription(merchant.address, AMOUNT, PERIOD);

      expect(await subScript.isPaymentDue(1, 1)).to.be.false;
    });

    it("should return true when due", async function () {
      const { subScript, subscriber, merchant, AMOUNT, PERIOD } =
        await loadFixture(deployFixture);

      await subScript
        .connect(subscriber)
        .createSubscription(merchant.address, AMOUNT, PERIOD);

      await time.increase(PERIOD + 1);

      expect(await subScript.isPaymentDue(1, 1)).to.be.true;
    });

    it("should return false for cancelled subscription", async function () {
      const { subScript, subscriber, merchant, AMOUNT, PERIOD } =
        await loadFixture(deployFixture);

      await subScript
        .connect(subscriber)
        .createSubscription(merchant.address, AMOUNT, PERIOD);

      await subScript.connect(subscriber).cancelSubscription(1);
      await time.increase(PERIOD + 1);

      expect(await subScript.isPaymentDue(1, 1)).to.be.false;
    });
  });
});
