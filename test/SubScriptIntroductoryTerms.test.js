const { expect } = require("chai");
const { ethers } = require("hardhat");
const {
  loadFixture,
  time,
} = require("@nomicfoundation/hardhat-network-helpers");

describe("SubScriptPSA introductory terms", function () {
  async function deployFixture() {
    const [owner, subscriber, merchant, keeper, treasury] =
      await ethers.getSigners();

    const MockUSDC = await ethers.getContractFactory("MockUSDC");
    const usdc = await MockUSDC.deploy();

    const MockStableFX = await ethers.getContractFactory("MockStableFX");
    const stableFX = await MockStableFX.deploy();

    const SubScript = await ethers.getContractFactory("SubScriptPSA");
    const subScript = await SubScript.deploy(
      await usdc.getAddress(),
      await stableFX.getAddress(),
      treasury.address
    );

    const TEN_K = ethers.parseUnits("10000", 6);
    await usdc.mint(subscriber.address, TEN_K);
    await usdc.connect(subscriber).approve(await subScript.getAddress(), TEN_K);

    const REGULAR = ethers.parseUnits("10", 6); /* 10 USDC */
    const INTRO = ethers.parseUnits("6", 6); /* 6 USDC = 40% off */
    const PERIOD = 30 * 24 * 60 * 60;

    return {
      usdc,
      subScript,
      owner,
      subscriber,
      merchant,
      keeper,
      treasury,
      REGULAR,
      INTRO,
      PERIOD,
    };
  }

  describe("createSubscriptionWithIntroductoryTerms", function () {
    it("charges the introductory amount at signup and records both prices", async function () {
      const { subScript, usdc, subscriber, merchant, treasury, REGULAR, INTRO, PERIOD } =
        await loadFixture(deployFixture);

      const fee = INTRO / 100n;
      const merchantBefore = await usdc.balanceOf(merchant.address);
      const treasuryBefore = await usdc.balanceOf(treasury.address);

      await expect(
        subScript
          .connect(subscriber)
          .createSubscriptionWithIntroductoryTerms(merchant.address, REGULAR, PERIOD, INTRO, 1)
      )
        .to.emit(subScript, "IntroductoryTermsSet")
        .withArgs(1, INTRO, 1, REGULAR)
        .and.to.emit(subScript, "PaymentExecuted")
        .withArgs(1, subscriber.address, merchant.address, INTRO, 0, (v) => v > 0);

      /* First payment moved the INTRO amount, fee taken on the amount actually collected */
      expect((await usdc.balanceOf(merchant.address)) - merchantBefore).to.equal(INTRO - fee);
      expect((await usdc.balanceOf(treasury.address)) - treasuryBefore).to.equal(fee);

      /* Authorization stores the REGULAR amount the subscriber approved */
      const sub = await subScript.subscriptions(1);
      expect(sub.amount).to.equal(REGULAR);

      const terms = await subScript.introductoryTerms(1);
      expect(terms.amount).to.equal(INTRO);
      expect(terms.cycles).to.equal(1);
    });

    it("moves no funds at signup for a free trial (intro amount 0)", async function () {
      const { subScript, usdc, subscriber, merchant, treasury, REGULAR, PERIOD } =
        await loadFixture(deployFixture);

      const subscriberBefore = await usdc.balanceOf(subscriber.address);
      const treasuryBefore = await usdc.balanceOf(treasury.address);

      await subScript
        .connect(subscriber)
        .createSubscriptionWithIntroductoryTerms(merchant.address, REGULAR, PERIOD, 0, 1);

      expect(await usdc.balanceOf(subscriber.address)).to.equal(subscriberBefore);
      expect(await usdc.balanceOf(merchant.address)).to.equal(0);
      /* No protocol fee on a zero-dollar trial */
      expect(await usdc.balanceOf(treasury.address)).to.equal(treasuryBefore);

      const sub = await subScript.subscriptions(1);
      expect(sub.isActive).to.be.true;
      expect(sub.amount).to.equal(REGULAR);
    });

    it("rejects terms that are not a discount", async function () {
      const { subScript, subscriber, merchant, REGULAR, PERIOD } =
        await loadFixture(deployFixture);

      /* intro >= regular */
      await expect(
        subScript
          .connect(subscriber)
          .createSubscriptionWithIntroductoryTerms(merchant.address, REGULAR, PERIOD, REGULAR, 1)
      ).to.be.revertedWithCustomError(subScript, "InvalidIntroductoryTerms");

      /* zero cycles */
      await expect(
        subScript
          .connect(subscriber)
          .createSubscriptionWithIntroductoryTerms(merchant.address, REGULAR, PERIOD, 0, 0)
      ).to.be.revertedWithCustomError(subScript, "InvalidIntroductoryTerms");

      /* cycles above the protocol ceiling */
      await expect(
        subScript
          .connect(subscriber)
          .createSubscriptionWithIntroductoryTerms(merchant.address, REGULAR, PERIOD, 0, 37)
      ).to.be.revertedWithCustomError(subScript, "InvalidIntroductoryTerms");
    });
  });

  describe("renewals across the phase switch", function () {
    it("bills the regular amount from the first renewal after a one-cycle discount", async function () {
      const { subScript, usdc, subscriber, merchant, keeper, REGULAR, INTRO, PERIOD } =
        await loadFixture(deployFixture);

      await subScript
        .connect(subscriber)
        .createSubscriptionWithIntroductoryTerms(merchant.address, REGULAR, PERIOD, INTRO, 1);

      /* Sequence 1 is priced at the regular amount */
      expect(await subScript.chargeAmountFor(1, 0)).to.equal(INTRO);
      expect(await subScript.chargeAmountFor(1, 1)).to.equal(REGULAR);

      await time.increase(PERIOD);
      const merchantBefore = await usdc.balanceOf(merchant.address);
      const fee = REGULAR / 100n;

      await expect(subScript.connect(keeper).executePayment(1, 1))
        .to.emit(subScript, "PaymentExecuted")
        .withArgs(1, subscriber.address, merchant.address, REGULAR, 1, (v) => v > 0);

      expect((await usdc.balanceOf(merchant.address)) - merchantBefore).to.equal(REGULAR - fee);
    });

    it("keeps the introductory price for multi-cycle promotions, then switches", async function () {
      const { subScript, subscriber, merchant, keeper, REGULAR, INTRO, PERIOD } =
        await loadFixture(deployFixture);

      await subScript
        .connect(subscriber)
        .createSubscriptionWithIntroductoryTerms(merchant.address, REGULAR, PERIOD, INTRO, 3);

      expect(await subScript.chargeAmountFor(1, 0)).to.equal(INTRO);
      expect(await subScript.chargeAmountFor(1, 1)).to.equal(INTRO);
      expect(await subScript.chargeAmountFor(1, 2)).to.equal(INTRO);
      expect(await subScript.chargeAmountFor(1, 3)).to.equal(REGULAR);

      await time.increase(PERIOD);
      await expect(subScript.connect(keeper).executePayment(1, 1))
        .to.emit(subScript, "PaymentExecuted")
        .withArgs(1, subscriber.address, merchant.address, INTRO, 1, (v) => v > 0);
    });

    it("charges the full regular price after a free trial ends", async function () {
      const { subScript, usdc, subscriber, merchant, keeper, treasury, REGULAR, PERIOD } =
        await loadFixture(deployFixture);

      await subScript
        .connect(subscriber)
        .createSubscriptionWithIntroductoryTerms(merchant.address, REGULAR, PERIOD, 0, 1);

      await time.increase(PERIOD);
      const fee = REGULAR / 100n;
      const treasuryBefore = await usdc.balanceOf(treasury.address);

      await subScript.connect(keeper).executePayment(1, 1);

      expect(await usdc.balanceOf(merchant.address)).to.equal(REGULAR - fee);
      expect((await usdc.balanceOf(treasury.address)) - treasuryBefore).to.equal(fee);
    });

    it("lets the subscriber cancel during the free trial with zero paid", async function () {
      const { subScript, usdc, subscriber, merchant, REGULAR, PERIOD } =
        await loadFixture(deployFixture);

      const balBefore = await usdc.balanceOf(subscriber.address);
      await subScript
        .connect(subscriber)
        .createSubscriptionWithIntroductoryTerms(merchant.address, REGULAR, PERIOD, 0, 1);
      await subScript.connect(subscriber).cancelSubscription(1);

      expect(await usdc.balanceOf(subscriber.address)).to.equal(balBefore);
      const sub = await subScript.subscriptions(1);
      expect(sub.isActive).to.be.false;
    });
  });

  describe("interaction with modifySubscription", function () {
    it("ends remaining introductory cycles when the subscriber re-authorizes a new price", async function () {
      const { subScript, subscriber, merchant, REGULAR, INTRO, PERIOD } =
        await loadFixture(deployFixture);

      await subScript
        .connect(subscriber)
        .createSubscriptionWithIntroductoryTerms(merchant.address, REGULAR, PERIOD, INTRO, 3);

      const upgraded = ethers.parseUnits("20", 6);
      await subScript.connect(subscriber).modifySubscription(1, upgraded, PERIOD);

      const terms = await subScript.introductoryTerms(1);
      expect(terms.cycles).to.equal(0);
      expect(await subScript.chargeAmountFor(1, 1)).to.equal(upgraded);
    });
  });

  describe("plain subscriptions are unaffected", function () {
    it("stores no introductory terms and charges the regular amount every cycle", async function () {
      const { subScript, subscriber, merchant, keeper, REGULAR, PERIOD } =
        await loadFixture(deployFixture);

      await subScript
        .connect(subscriber)
        ["createSubscription(address,uint256,uint256)"](merchant.address, REGULAR, PERIOD);

      const terms = await subScript.introductoryTerms(1);
      expect(terms.cycles).to.equal(0);
      expect(await subScript.chargeAmountFor(1, 0)).to.equal(REGULAR);
      expect(await subScript.chargeAmountFor(1, 1)).to.equal(REGULAR);

      await time.increase(PERIOD);
      await expect(subScript.connect(keeper).executePayment(1, 1))
        .to.emit(subScript, "PaymentExecuted")
        .withArgs(1, subscriber.address, merchant.address, REGULAR, 1, (v) => v > 0);
    });
  });
});
