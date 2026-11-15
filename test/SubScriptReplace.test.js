const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time, loadFixture } = require("@nomicfoundation/hardhat-network-helpers");

describe("SubScriptPSA replaceSubscription (atomic plan change)", function () {
  const DAY = 86400;
  const MONTH = 30 * DAY;
  const YEAR = 365 * DAY;
  const BASIC = 10_000_000n; /* 10 USDC */
  const PRO = 20_000_000n; /* 20 USDC */
  const LITE = 5_000_000n; /* 5 USDC */
  const FUNDS = 1_000_000_000n; /* 1000 USDC */

  async function fixture() {
    const [, subscriber, merchant, stranger, treasury, otherMerchant] = await ethers.getSigners();
    const usdc = await (await ethers.getContractFactory("MockUSDC")).deploy();
    const psa = await (await ethers.getContractFactory("SubScriptPSA")).deploy(
      await usdc.getAddress(), treasury.address,
    );
    await usdc.mint(subscriber.address, FUNDS);
    await usdc.connect(subscriber).approve(await psa.getAddress(), FUNDS);
    /* Sub #1: Basic, monthly, charged at creation. */
    await psa.connect(subscriber)["createSubscription(address,uint256,uint256)"](merchant.address, BASIC, MONTH);
    return { psa, usdc, subscriber, merchant, stranger, treasury, otherMerchant };
  }

  const fee = (amount) => amount / 100n;

  it("advertises the capability flag", async function () {
    const { psa } = await loadFixture(fixture);
    expect(await psa.supportsReplaceSubscriptions()).to.equal(true);
    expect(await psa.supportsDeferredSubscriptions()).to.equal(true);
  });

  it("upgrades: charges chargeNow today, then the full new price from the next cycle", async function () {
    const { psa, usdc, subscriber, merchant, stranger, treasury } = await loadFixture(fixture);
    await time.increase(10 * DAY);

    /* 20 days of Basic unused => credit 6.666666 USDC; chargeNow = Pro - credit. */
    const chargeNow = PRO - 6_666_666n;
    const subscriberBefore = await usdc.balanceOf(subscriber.address);
    const merchantBefore = await usdc.balanceOf(merchant.address);
    const treasuryBefore = await usdc.balanceOf(treasury.address);

    const tx = psa.connect(subscriber).replaceSubscription(1, PRO, MONTH, chargeNow, 0, 1);
    await expect(tx).to.emit(psa, "SubscriptionCancelled").withArgs(1, subscriber.address);
    const receipt = await (await tx).wait();
    const now = BigInt((await ethers.provider.getBlock(receipt.blockNumber)).timestamp);
    await expect(tx).to.emit(psa, "SubscriptionReplaced").withArgs(1, 2, chargeNow, now + BigInt(MONTH));
    await expect(tx).to.emit(psa, "PaymentExecuted").withArgs(2, subscriber.address, merchant.address, chargeNow, 0, now);

    expect(subscriberBefore - (await usdc.balanceOf(subscriber.address))).to.equal(chargeNow);
    expect((await usdc.balanceOf(merchant.address)) - merchantBefore).to.equal(chargeNow - fee(chargeNow));
    expect((await usdc.balanceOf(treasury.address)) - treasuryBefore).to.equal(fee(chargeNow));

    const oldSub = await psa.subscriptions(1);
    const newSub = await psa.subscriptions(2);
    expect(oldSub.isActive).to.equal(false);
    expect(newSub.isActive).to.equal(true);
    expect(newSub.subscriber).to.equal(subscriber.address);
    expect(newSub.merchant).to.equal(merchant.address);
    expect(newSub.amount).to.equal(PRO);
    expect(newSub.maxPaymentAmount).to.equal(PRO);
    expect(newSub.paymentToken).to.equal(await usdc.getAddress());
    expect(newSub.nextPayment).to.equal(now + BigInt(MONTH));
    expect(await psa.paidThrough(2)).to.equal(now + BigInt(MONTH));
    expect(await psa.chargeAmountFor(2, 0)).to.equal(chargeNow);
    expect(await psa.chargeAmountFor(2, 1)).to.equal(PRO);

    await time.increaseTo(newSub.nextPayment);
    const beforeRenewal = await usdc.balanceOf(subscriber.address);
    await psa.connect(stranger).executePayment(2, 1);
    expect(beforeRenewal - (await usdc.balanceOf(subscriber.address))).to.equal(PRO);
  });

  it("upgrades at full price with no introductory terms when chargeNow equals the new amount", async function () {
    const { psa, usdc, subscriber } = await loadFixture(fixture);
    const before = await usdc.balanceOf(subscriber.address);
    await psa.connect(subscriber).replaceSubscription(1, PRO, MONTH, PRO, 0, 0);
    expect(before - (await usdc.balanceOf(subscriber.address))).to.equal(PRO);
    expect((await psa.introductoryTerms(2)).cycles).to.equal(0n);
    expect(await psa.chargeAmountFor(2, 0)).to.equal(PRO);
  });

  it("downgrades with a deferred first payment: no charge now, first bill at paid-through", async function () {
    const { psa, usdc, subscriber, merchant, stranger } = await loadFixture(fixture);
    await time.increase(10 * DAY);
    const paidThrough = await psa.paidThrough(1);
    const before = await usdc.balanceOf(subscriber.address);

    const tx = psa.connect(subscriber).replaceSubscription(1, LITE, MONTH, 0, paidThrough, 0);
    await expect(tx).to.emit(psa, "SubscriptionReplaced").withArgs(1, 2, 0, paidThrough);
    await expect(tx).to.emit(psa, "SubscriptionFirstPaymentDeferred").withArgs(2, paidThrough);
    await (await tx).wait();

    expect(await usdc.balanceOf(subscriber.address)).to.equal(before);
    const newSub = await psa.subscriptions(2);
    expect(newSub.isActive).to.equal(true);
    expect(newSub.merchant).to.equal(merchant.address);
    expect(newSub.amount).to.equal(LITE);
    expect(newSub.nextPayment).to.equal(paidThrough);
    expect(await psa.paidThrough(2)).to.equal(paidThrough);
    expect(await psa.chargeAmountFor(2, 0)).to.equal(0n);

    await expect(psa.connect(stranger).executePayment(2, 1)).to.be.revertedWithCustomError(psa, "PaymentNotDue");
    await time.increaseTo(paidThrough);
    await psa.connect(stranger).executePayment(2, 1);
    expect(before - (await usdc.balanceOf(subscriber.address))).to.equal(LITE);
  });

  it("switches monthly to annual at the next renewal even though the new period is longer", async function () {
    const { psa, usdc, subscriber } = await loadFixture(fixture);
    const paidThrough = await psa.paidThrough(1);
    const before = await usdc.balanceOf(subscriber.address);
    await psa.connect(subscriber).replaceSubscription(1, BASIC * 10n, YEAR, 0, paidThrough, 0);
    expect(await usdc.balanceOf(subscriber.address)).to.equal(before);
    expect((await psa.subscriptions(2)).period).to.equal(BigInt(YEAR));
    expect(await psa.paidThrough(2)).to.equal(paidThrough);
  });

  it("rejects a caller who is not the old sub's subscriber", async function () {
    const { psa, merchant, stranger } = await loadFixture(fixture);
    await expect(psa.connect(stranger).replaceSubscription(1, PRO, MONTH, PRO, 0, 0))
      .to.be.revertedWithCustomError(psa, "NotAuthorized").withArgs(1);
    await expect(psa.connect(merchant).replaceSubscription(1, PRO, MONTH, PRO, 0, 0))
      .to.be.revertedWithCustomError(psa, "NotAuthorized").withArgs(1);
    expect((await psa.subscriptions(1)).isActive).to.equal(true);
  });

  it("rejects replacing an inactive sub (cancelled, already replaced, or nonexistent)", async function () {
    const { psa, subscriber, merchant } = await loadFixture(fixture);
    await psa.connect(subscriber).cancelSubscription(1);
    await expect(psa.connect(subscriber).replaceSubscription(1, PRO, MONTH, PRO, 0, 0))
      .to.be.revertedWithCustomError(psa, "SubscriptionNotActive").withArgs(1);
    await expect(psa.connect(subscriber).replaceSubscription(99, PRO, MONTH, PRO, 0, 0))
      .to.be.revertedWithCustomError(psa, "SubscriptionNotActive").withArgs(99);

    await psa.connect(subscriber)["createSubscription(address,uint256,uint256)"](merchant.address, BASIC, MONTH);
    await psa.connect(subscriber).replaceSubscription(2, PRO, MONTH, PRO, 0, 0);
    await expect(psa.connect(subscriber).replaceSubscription(2, PRO, MONTH, PRO, 0, 0))
      .to.be.revertedWithCustomError(psa, "SubscriptionNotActive").withArgs(2);
  });

  it("validates the upgrade and deferred term combinations", async function () {
    const { psa, subscriber } = await loadFixture(fixture);
    const paidThrough = await psa.paidThrough(1);
    const now = BigInt(await time.latest());
    const cases = [
      /* chargeNow above the new price */
      [[1, PRO, MONTH, PRO + 1n, 0, 0], "InvalidReplacementTerms"],
      /* upgrade must not also name a deferred date */
      [[1, PRO, MONTH, PRO, paidThrough, 0], "InvalidReplacementTerms"],
      /* full-price upgrade with intro cycles is meaningless */
      [[1, PRO, MONTH, PRO, 0, 1], "InvalidReplacementTerms"],
      /* discounted charge needs 1..36 intro cycles */
      [[1, PRO, MONTH, PRO - 1n, 0, 0], "InvalidIntroductoryTerms"],
      [[1, PRO, MONTH, PRO - 1n, 0, 37], "InvalidIntroductoryTerms"],
      /* deferred: no intro cycles, date strictly in the future and within paid-through */
      [[1, LITE, MONTH, 0, paidThrough, 1], "InvalidReplacementTerms"],
      [[1, LITE, MONTH, 0, 0, 0], "InvalidReplacementTerms"],
      [[1, LITE, MONTH, 0, now, 0], "InvalidReplacementTerms"],
      [[1, LITE, MONTH, 0, paidThrough + 1n, 0], "InvalidReplacementTerms"],
      /* the usual create checks still apply */
      [[1, 0, MONTH, 0, paidThrough, 0], "InvalidAmount"],
      [[1, LITE, 3599, 0, paidThrough, 0], "InvalidPeriod"],
    ];
    for (const [args, error] of cases) {
      await expect(psa.connect(subscriber).replaceSubscription(...args), `${error} ${args}`)
        .to.be.revertedWithCustomError(psa, error);
    }
    expect((await psa.subscriptions(1)).isActive).to.equal(true);
    expect(await psa.nextSubscriptionId()).to.equal(2n);
  });

  it("rejects a cross-token sub at replace time (USDC-only)", async function () {
    const { psa, usdc, subscriber } = await loadFixture(fixture);
    const eurc = await (await ethers.getContractFactory("MockUSDC")).deploy();
    const psaAddress = await psa.getAddress();

    /* No create path can produce a cross-token sub, so forge one in storage to prove replace
       re-checks the token pairing instead of trusting what it copies from the old sub. */
    const pad = (v) => ethers.zeroPadValue(v, 32);
    let base = null;
    for (let slot = 0; slot < 16 && base === null; slot++) {
      const candidate = BigInt(ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(["uint256", "uint256"], [1, slot])));
      const word = await ethers.provider.getStorage(psaAddress, candidate);
      if (word.toLowerCase() === pad(subscriber.address).toLowerCase()) base = candidate;
    }
    expect(base !== null, "subscriptions mapping slot").to.equal(true);
    /* Field order: subscriber, merchant, amount, period, nextPayment, isActive|settlementToken, paymentToken */
    await ethers.provider.send("hardhat_setStorageAt", [
      psaAddress, ethers.toQuantity(base + 6n), pad(await eurc.getAddress()),
    ]);
    expect((await psa.subscriptions(1)).paymentToken).to.equal(await eurc.getAddress());

    await expect(psa.connect(subscriber).replaceSubscription(1, PRO, MONTH, PRO, 0, 0))
      .to.be.revertedWithCustomError(psa, "UnsupportedToken")
      .withArgs(await usdc.getAddress(), await eurc.getAddress());
    expect((await psa.subscriptions(1)).isActive).to.equal(true);
  });

  it("keeps the duplicate guard correct after a replace", async function () {
    const { psa, subscriber, merchant } = await loadFixture(fixture);
    await psa.connect(subscriber).replaceSubscription(1, PRO, MONTH, PRO, 0, 0);

    /* The new plan key is live, so the same plan can't be bought twice. */
    await expect(psa.connect(subscriber)["createSubscription(address,uint256,uint256)"](merchant.address, PRO, MONTH))
      .to.be.revertedWithCustomError(psa, "DuplicateActiveSubscription").withArgs(2);

    /* The old plan key was released exactly as cancelSubscription would. */
    await psa.connect(subscriber)["createSubscription(address,uint256,uint256)"](merchant.address, BASIC, MONTH);
    expect((await psa.subscriptions(3)).isActive).to.equal(true);

    /* Replacing into a plan that another live sub already holds reverts the whole change. */
    await expect(psa.connect(subscriber).replaceSubscription(3, PRO, MONTH, PRO, 0, 0))
      .to.be.revertedWithCustomError(psa, "DuplicateActiveSubscription").withArgs(2);
    expect((await psa.subscriptions(3)).isActive).to.equal(true);
  });

  it("allows replacing with identical terms (re-authorization)", async function () {
    const { psa, subscriber } = await loadFixture(fixture);
    const paidThrough = await psa.paidThrough(1);
    await psa.connect(subscriber).replaceSubscription(1, BASIC, MONTH, 0, paidThrough, 0);
    expect((await psa.subscriptions(1)).isActive).to.equal(false);
    expect((await psa.subscriptions(2)).isActive).to.equal(true);
  });

  it("leaves the old sub uncollectable while keeping its paid-through record", async function () {
    const { psa, usdc, subscriber, stranger } = await loadFixture(fixture);
    const oldDue = (await psa.subscriptions(1)).nextPayment;
    const oldPaidThrough = await psa.paidThrough(1);
    await psa.connect(subscriber).replaceSubscription(1, LITE, MONTH, 0, oldPaidThrough, 0);

    await time.increaseTo(oldDue);
    expect(await psa.isPaymentDue(1, 1)).to.equal(false);
    const [upkeepNeeded] = await psa.checkUpkeep(
      ethers.AbiCoder.defaultAbiCoder().encode(["uint256", "uint256"], [1, 1]),
    );
    expect(upkeepNeeded).to.equal(false);
    await expect(psa.connect(stranger).executePayment(1, 1))
      .to.be.revertedWithCustomError(psa, "SubscriptionNotActive").withArgs(1);
    expect(await psa.paidThrough(1)).to.equal(oldPaidThrough);

    /* Only the replacement bills, once, at the lower price. */
    const before = await usdc.balanceOf(subscriber.address);
    await psa.connect(stranger).executePayment(2, 1);
    expect(before - (await usdc.balanceOf(subscriber.address))).to.equal(LITE);
  });

  it("is atomic: a failed upgrade charge leaves the old sub live", async function () {
    const { psa, usdc, subscriber } = await loadFixture(fixture);
    await usdc.connect(subscriber).approve(await psa.getAddress(), 0);
    await expect(psa.connect(subscriber).replaceSubscription(1, PRO, MONTH, PRO, 0, 0)).to.be.reverted;
    expect((await psa.subscriptions(1)).isActive).to.equal(true);
    expect(await psa.nextSubscriptionId()).to.equal(2n);
  });
});
