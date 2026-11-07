const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time, loadFixture } = require("@nomicfoundation/hardhat-network-helpers");

describe("Subscription entitlement and deferred renewal safety", function () {
  async function fixture() {
    const [, subscriber, merchant, stranger, treasury] = await ethers.getSigners();
    const usdc = await (await ethers.getContractFactory("MockUSDC")).deploy();
    const fx = await (await ethers.getContractFactory("MockStableFX")).deploy();
    const psa = await (await ethers.getContractFactory("SubScriptPSA")).deploy(
      await usdc.getAddress(), await fx.getAddress(), treasury.address,
    );
    const price = 10_000_000n;
    await usdc.mint(subscriber.address, 1_000_000_000n);
    await usdc.connect(subscriber).approve(await psa.getAddress(), 1_000_000_000n);
    return { psa, usdc, subscriber, merchant, stranger, price };
  }

  it("resumes without charging today and enforces the original cadence against any caller", async function () {
    const { psa, usdc, subscriber, merchant, stranger, price } = await loadFixture(fixture);
    const day = 86400, month = 30 * day;
    const firstCharge = (await time.latest()) + day;
    await psa.connect(subscriber).createSubscriptionWithDeferredFirstPayment(merchant.address, price, month, firstCharge);
    expect(await psa.supportsDeferredSubscriptions()).to.equal(true);
    expect(await usdc.balanceOf(subscriber.address)).to.equal(1_000_000_000n);
    expect((await psa.subscriptions(1)).period).to.equal(month);
    expect(await psa.paidThrough(1)).to.equal(firstCharge);
    await time.increaseTo(firstCharge);
    await psa.connect(stranger).executePayment(1, 1);
    expect(await psa.paidThrough(1)).to.equal(firstCharge + month);
    await time.increase(day);
    await expect(psa.connect(stranger).executePayment(1, 2)).to.be.revertedWithCustomError(psa, "PaymentNotDue");
    await time.increaseTo(firstCharge + month);
    await psa.connect(stranger).executePayment(1, 2);
    expect(await usdc.balanceOf(subscriber.address)).to.equal(980_000_000n);
  });

  it("retains current paid-through after third-party renewal and cancellation", async function () {
    const { psa, subscriber, merchant, stranger, price } = await loadFixture(fixture);
    const month = 30 * 86400;
    await psa.connect(subscriber).createSubscription(merchant.address, price, month);
    const firstDue = (await psa.subscriptions(1)).nextPayment;
    await time.increaseTo(firstDue);
    await psa.connect(stranger).executePayment(1, 1);
    expect((await psa.subscriptions(1)).nextPayment).to.equal(firstDue);
    expect(await psa.paidThrough(1)).to.equal(firstDue + BigInt(month));
    await psa.connect(subscriber).cancelSubscription(1);
    expect(await psa.paidThrough(1)).to.equal(firstDue + BigInt(month));
  });

  it("tracks free trial entitlement and latest settled interval without backcharging gaps", async function () {
    const { psa, subscriber, merchant, stranger, price } = await loadFixture(fixture);
    const month = 30 * 86400;
    await psa.connect(subscriber).createSubscriptionWithIntroductoryTerms(merchant.address, price, month, 0, 2);
    const firstDue = (await psa.subscriptions(1)).nextPayment;
    expect(await psa.paidThrough(1)).to.equal(firstDue);
    await time.increaseTo(firstDue + 3n * BigInt(month));
    await psa.connect(stranger).executePayment(1, 4);
    expect(await psa.paidThrough(1)).to.equal(firstDue + 4n * BigInt(month));
  });

  it("cannot defer the first charge beyond one authorized plan period", async function () {
    const { psa, subscriber, merchant, price } = await loadFixture(fixture);
    await expect(psa.connect(subscriber).createSubscriptionWithDeferredFirstPayment(
      merchant.address, price, 3600, (await time.latest()) + 7200,
    )).to.be.revertedWithCustomError(psa, "InvalidPeriod");
  });
});
