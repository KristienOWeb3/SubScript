const { expect } = require("chai");
const { ethers } = require("hardhat");
const {
  loadFixture,
  time,
} = require("@nomicfoundation/hardhat-network-helpers");

describe("SubScript", function () {
  /* Shared Fixture */
  async function deployFixture() {
    const [owner, subscriber, merchant, keeper, stranger, treasury] =
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
      treasury.address
    );

    /* Mint 10 000 USDC to the subscriber (6 decimals) */
    const TEN_K = ethers.parseUnits("10000", 6);
    await usdc.mint(subscriber.address, TEN_K);

    /* Subscriber approves SubScript for 10 000 USDC */
    await usdc.connect(subscriber).approve(await subScript.getAddress(), TEN_K);

    const AMOUNT = ethers.parseUnits("15", 6); /* 15 USDC */
    const PERIOD = 30 * 24 * 60 * 60; /* 30 days in seconds */

    return {
      usdc,
      stableFX,
      subScript,
      owner,
      subscriber,
      merchant,
      keeper,
      stranger,
      treasury,
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
      const SubScript = await ethers.getContractFactory("SubScriptPSA");
      await expect(
        SubScript.deploy(ethers.ZeroAddress, ethers.ZeroAddress, ethers.ZeroAddress)
      ).to.be.revertedWithCustomError(SubScript, "InvalidAddress");
    });

    it("should set the configured treasury", async function () {
      const { subScript, treasury } = await loadFixture(deployFixture);
      expect(await subScript.treasury()).to.equal(treasury.address);
    });
  });

  /* CREATE SUBSCRIPTION */
  describe("createSubscription", function () {
    it("should create a subscription and take the first payment", async function () {
      const { subScript, usdc, subscriber, merchant, treasury, AMOUNT, PERIOD } =
        await loadFixture(deployFixture);

      const merchantBalBefore = await usdc.balanceOf(merchant.address);
      const treasuryBalBefore = await usdc.balanceOf(treasury.address);
      const fee = AMOUNT / 100n;
      const merchantAmount = AMOUNT - fee;

      await expect(
        subScript
          .connect(subscriber)
          .createSubscription(merchant.address, AMOUNT, PERIOD)
      )
        .to.emit(subScript, "SubscriptionCreated")
        .withArgs(1, subscriber.address, merchant.address, AMOUNT, PERIOD)
        .and.to.emit(subScript, "ProtocolFeePaid")
        .withArgs(1, merchant.address, await usdc.getAddress(), fee);

      /* Verify first payment was taken */
      const merchantBalAfter = await usdc.balanceOf(merchant.address);
      const treasuryBalAfter = await usdc.balanceOf(treasury.address);
      expect(merchantBalAfter - merchantBalBefore).to.equal(merchantAmount);
      expect(treasuryBalAfter - treasuryBalBefore).to.equal(fee);

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

    it("should reject the same active plan for the same subscriber twice", async function () {
      const { subScript, subscriber, merchant, AMOUNT, PERIOD } =
        await loadFixture(deployFixture);

      await subScript
        .connect(subscriber)
        .createSubscription(merchant.address, AMOUNT, PERIOD);

      await expect(
        subScript
          .connect(subscriber)
          .createSubscription(merchant.address, AMOUNT, PERIOD)
      )
        .to.be.revertedWithCustomError(subScript, "DuplicateActiveSubscription")
        .withArgs(1);
    });

    it("should allow the same plan again after the subscriber cancels it", async function () {
      const { subScript, subscriber, merchant, AMOUNT, PERIOD } =
        await loadFixture(deployFixture);

      await subScript
        .connect(subscriber)
        .createSubscription(merchant.address, AMOUNT, PERIOD);
      await subScript.connect(subscriber).cancelSubscription(1);

      await expect(
        subScript
          .connect(subscriber)
          .createSubscription(merchant.address, AMOUNT, PERIOD)
      )
        .to.emit(subScript, "SubscriptionCreated")
        .withArgs(2, subscriber.address, merchant.address, AMOUNT, PERIOD);
    });
  });

  /* EXECUTE PAYMENT */
  describe("executePayment", function () {
    it("should execute payment when due", async function () {
      const { subScript, usdc, subscriber, merchant, keeper, treasury, AMOUNT, PERIOD } =
        await loadFixture(deployFixture);

      /* Create subscription */
      await subScript
        .connect(subscriber)
        .createSubscription(merchant.address, AMOUNT, PERIOD);

      /* Fast-forward time past the period */
      await time.increase(PERIOD + 1);

      const merchantBalBefore = await usdc.balanceOf(merchant.address);
      const treasuryBalBefore = await usdc.balanceOf(treasury.address);
      const fee = AMOUNT / 100n;

      await expect(subScript.connect(keeper).executePayment(1, 1))
        .to.emit(subScript, "PaymentExecuted");

      const merchantBalAfter = await usdc.balanceOf(merchant.address);
      const treasuryBalAfter = await usdc.balanceOf(treasury.address);
      expect(merchantBalAfter - merchantBalBefore).to.equal(AMOUNT - fee);
      expect(treasuryBalAfter - treasuryBalBefore).to.equal(fee);
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

    it("must reject the charge when cancellation was requested at the period boundary", async function () {
      /* The exact race behind cancel-at-period-end: the renewal is already DUE, the user
         requests cancellation, and a permissionless keeper (or anyone) calls executePayment
         immediately after. Because SubScript now revokes the authorization on-chain at
         cancellation time, the charge must fail even though the payment was due first. */
      const { subScript, subscriber, merchant, keeper, AMOUNT, PERIOD } =
        await loadFixture(deployFixture);

      await subScript
        .connect(subscriber)
        .createSubscription(merchant.address, AMOUNT, PERIOD);

      /* Renewal becomes due BEFORE the cancellation request. */
      await time.increase(PERIOD + 1);

      /* User requests cancellation, causing immediate on-chain revocation. */
      await subScript.connect(subscriber).cancelSubscription(1);

      /* Permissionless charge attempt right at the boundary must fail. */
      await expect(
        subScript.connect(keeper).executePayment(1, 1)
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
      expect(merchantBal).to.equal((AMOUNT - (AMOUNT / 100n)) * 4n);
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

    it("should not allow merchant to cancel a subscriber's authorization", async function () {
      const { subScript, subscriber, merchant, AMOUNT, PERIOD } =
        await loadFixture(deployFixture);

      await subScript
        .connect(subscriber)
        .createSubscription(merchant.address, AMOUNT, PERIOD);

      await expect(
        subScript.connect(merchant).cancelSubscription(1)
      ).to.be.revertedWithCustomError(subScript, "NotAuthorized");

      const sub = await subScript.subscriptions(1);
      expect(sub.isActive).to.be.true;
    });

    it("should revert if caller is not the subscriber", async function () {
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

    it("should reject a lower recurring rate", async function () {
      const { subScript, subscriber, merchant, AMOUNT, PERIOD } =
        await loadFixture(deployFixture);

      await subScript
        .connect(subscriber)
        .createSubscription(merchant.address, AMOUNT, PERIOD);

      await expect(
        subScript.connect(subscriber).modifySubscription(1, AMOUNT / 2n, PERIOD)
      )
        .to.be.revertedWithCustomError(subScript, "PlanReductionNotAllowed")
        .withArgs(1);

      await expect(
        subScript.connect(subscriber).modifySubscription(1, AMOUNT, PERIOD * 2)
      )
        .to.be.revertedWithCustomError(subScript, "PlanReductionNotAllowed")
        .withArgs(1);
    });

    it("should allow a different billing interval at the same recurring rate", async function () {
      const { subScript, subscriber, merchant, AMOUNT, PERIOD } =
        await loadFixture(deployFixture);

      await subScript
        .connect(subscriber)
        .createSubscription(merchant.address, AMOUNT, PERIOD);

      await expect(
        subScript.connect(subscriber).modifySubscription(1, AMOUNT * 2n, PERIOD * 2)
      )
        .to.emit(subScript, "SubscriptionModified")
        .withArgs(1, AMOUNT * 2n, PERIOD * 2);
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

  /* STABLEFX MULTI-CURRENCY SWAPPING */
  describe("StableFX Multi-Currency Swapping", function () {
    it("should swap multi-currency subscriptions successfully on creation and execution", async function () {
      const { subScript, usdc, stableFX, subscriber, merchant, keeper, treasury, AMOUNT, PERIOD, TEN_K } =
        await loadFixture(deployFixture);

      /* Deploy MockEURC as settlementToken */
      const MockEURC = await ethers.getContractFactory("MockUSDC"); /* reuse MockUSDC contract factory */
      const eurc = await MockEURC.deploy();
      const eurcAddress = await eurc.getAddress();
      const usdcAddress = await usdc.getAddress();

      /* Set rate on MockStableFX: 1.10 input per output (EURC to USDC) */
      await stableFX.setRate(110);

      /* Mint EURC to StableFX contract so it can payout the merchant */
      await eurc.mint(await stableFX.getAddress(), TEN_K);

      /* Approve SubScript for subscriber USDC */
      await usdc.connect(subscriber).approve(await subScript.getAddress(), TEN_K);

      const merchantEurcBefore = await eurc.balanceOf(merchant.address);
      const treasuryEurcBefore = await eurc.balanceOf(treasury.address);
      const subscriberUsdcBefore = await usdc.balanceOf(subscriber.address);
      const fee = AMOUNT / 100n;

      /* Create multi-currency subscription (merchant gets EURC, subscriber pays USDC).
         maxPaymentAmount caps the USDC pulled: 20% headroom above the 15 EURC settlement covers the
         1.10 FX rate (16.5 USDC needed). */
      const maxPay = (AMOUNT * 120n) / 100n;
      await subScript
        .connect(subscriber)
        ["createSubscription(address,uint256,uint256,address,address,uint256)"](
          merchant.address, AMOUNT, PERIOD, eurcAddress, usdcAddress, maxPay
        );

      /* Verify first payment took place (swapped) */
      const merchantEurcAfter = await eurc.balanceOf(merchant.address);
      const treasuryEurcAfter = await eurc.balanceOf(treasury.address);
      expect(merchantEurcAfter - merchantEurcBefore).to.equal(AMOUNT - fee);
      expect(treasuryEurcAfter - treasuryEurcBefore).to.equal(fee);

      /* Verify subscriber paid correct USDC amount (15 EURC * 1.10 = 16.50 USDC) */
      const subscriberUsdcAfter = await usdc.balanceOf(subscriber.address);
      const expectedUsdcSpent = (AMOUNT * 110n) / 100n;
      expect(subscriberUsdcBefore - subscriberUsdcAfter).to.equal(expectedUsdcSpent);

      /* Fast-forward and execute payment */
      await time.increase(PERIOD + 1);

      const subscriberUsdcBeforeExecution = await usdc.balanceOf(subscriber.address);
      const merchantEurcBeforeExecution = await eurc.balanceOf(merchant.address);
      const treasuryEurcBeforeExecution = await eurc.balanceOf(treasury.address);

      await subScript.connect(keeper).executePayment(1, 1);

      const subscriberUsdcAfterExecution = await usdc.balanceOf(subscriber.address);
      const merchantEurcAfterExecution = await eurc.balanceOf(merchant.address);
      const treasuryEurcAfterExecution = await eurc.balanceOf(treasury.address);

      expect(merchantEurcAfterExecution - merchantEurcBeforeExecution).to.equal(AMOUNT - fee);
      expect(treasuryEurcAfterExecution - treasuryEurcBeforeExecution).to.equal(fee);
      expect(subscriberUsdcBeforeExecution - subscriberUsdcAfterExecution).to.equal(expectedUsdcSpent);
    });

    it("reverts a cross-token swap that would pull more input than the subscriber approved", async function () {
      const { subScript, usdc, stableFX, subscriber, merchant, AMOUNT, PERIOD, TEN_K } =
        await loadFixture(deployFixture);
      const MockEURC = await ethers.getContractFactory("MockUSDC");
      const eurc = await MockEURC.deploy();
      const eurcAddress = await eurc.getAddress();
      const usdcAddress = await usdc.getAddress();

      /* Router quotes 2.0x input (manipulated/adverse rate): 15 EURC -> 30 USDC. */
      await stableFX.setRate(200);
      await eurc.mint(await stableFX.getAddress(), TEN_K);
      await usdc.connect(subscriber).approve(await subScript.getAddress(), TEN_K);

      /* Subscriber only approved a 20% headroom cap (18 USDC), so the 30 USDC pull must revert
         rather than silently draining their wallet. */
      const maxPay = (AMOUNT * 120n) / 100n;
      await expect(
        subScript
          .connect(subscriber)
          ["createSubscription(address,uint256,uint256,address,address,uint256)"](
            merchant.address, AMOUNT, PERIOD, eurcAddress, usdcAddress, maxPay
          )
      ).to.be.revertedWithCustomError(subScript, "ExcessiveSwapInput");
    });

    it("requires an explicit max for cross-token subscriptions", async function () {
      const { subScript, usdc, subscriber, merchant, AMOUNT, PERIOD } =
        await loadFixture(deployFixture);
      const MockEURC = await ethers.getContractFactory("MockUSDC");
      const eurc = await MockEURC.deploy();
      const eurcAddress = await eurc.getAddress();
      const usdcAddress = await usdc.getAddress();

      /* The 5-arg overload has no cap, so cross-token creation must be rejected outright. */
      await expect(
        subScript
          .connect(subscriber)
          ["createSubscription(address,uint256,uint256,address,address)"](
            merchant.address, AMOUNT, PERIOD, eurcAddress, usdcAddress
          )
      ).to.be.revertedWithCustomError(subScript, "MaxPaymentAmountRequired");
    });
  });

  /* SUBSCRIPT ROUTER VAULT AND FEES */
  describe("SubScriptRouter Vault and Fees", function () {
    async function deployRouterFixture() {
      const [owner, subscriber, merchant, treasury] = await ethers.getSigners();

      const MockUSDC = await ethers.getContractFactory("MockUSDC");
      const usdc = await MockUSDC.deploy();

      const SubScriptRouter = await ethers.getContractFactory("SubScriptRouter");
      const implementation = await SubScriptRouter.deploy();

      const ERC1967Proxy = await ethers.getContractFactory("MockERC1967Proxy");
      const initData = implementation.interface.encodeFunctionData("initialize", [
        await usdc.getAddress(),
        treasury.address,
        owner.address
      ]);
      const proxy = await ERC1967Proxy.deploy(await implementation.getAddress(), initData);
      const router = SubScriptRouter.attach(await proxy.getAddress());

      const TEN_K = ethers.parseUnits("10000", 6);
      await usdc.mint(subscriber.address, TEN_K);
      await usdc.connect(subscriber).approve(await router.getAddress(), TEN_K);

      return {
        usdc,
        router,
        owner,
        subscriber,
        merchant,
        treasury,
      };
    }

    it("should deposit funds into merchant vault and emit event", async function () {
      const { usdc, router, subscriber, merchant } = await loadFixture(deployRouterFixture);

      const amount = ethers.parseUnits("100", 6);
      const memo = "receipt-12345";

      await expect(
        router.connect(subscriber).depositForMerchant(merchant.address, amount, memo)
      )
        .to.emit(router, "DepositWithMemo")
        .withArgs(subscriber.address, merchant.address, amount, memo);

      expect(await router.merchantBalances(merchant.address)).to.equal(amount);
      expect(await usdc.balanceOf(await router.getAddress())).to.equal(amount);
    });

    it("should withdraw vault balance to merchant and send 1% fee to treasury", async function () {
      const { usdc, router, subscriber, merchant, treasury } = await loadFixture(deployRouterFixture);

      const amount = ethers.parseUnits("100", 6); // 100 USDC
      const memo = "receipt-12345";

      await router.connect(subscriber).depositForMerchant(merchant.address, amount, memo);

      const merchantBalBefore = await usdc.balanceOf(merchant.address);
      const treasuryBalBefore = await usdc.balanceOf(treasury.address);

      // Perform withdrawal
      await expect(router.connect(merchant).withdraw())
        .to.emit(router, "Withdraw")
        .withArgs(merchant.address, ethers.parseUnits("99", 6));

      const merchantBalAfter = await usdc.balanceOf(merchant.address);
      const treasuryBalAfter = await usdc.balanceOf(treasury.address);

      expect(merchantBalAfter - merchantBalBefore).to.equal(ethers.parseUnits("99", 6));
      expect(treasuryBalAfter - treasuryBalBefore).to.equal(ethers.parseUnits("1", 6));
      expect(await router.merchantBalances(merchant.address)).to.equal(0);
    });

    it("should withdraw vault balance to a custom recipient and send 1% fee to treasury", async function () {
      const { usdc, router, subscriber, merchant, treasury } = await loadFixture(deployRouterFixture);
      const [, , , , recipient] = await ethers.getSigners();

      const amount = ethers.parseUnits("100", 6); // 100 USDC
      const memo = "receipt-12345";

      await router.setMerchantTier(merchant.address, 1);
      await router.connect(subscriber).depositForMerchant(merchant.address, amount, memo);

      const recipientBalBefore = await usdc.balanceOf(recipient.address);
      const treasuryBalBefore = await usdc.balanceOf(treasury.address);

      // Perform withdrawal to recipient. Withdraw stays keyed to the merchant so rerouted
      // payouts keep their merchant identity; PayoutDelivered records the destination.
      await expect(router.connect(merchant).withdrawTo(recipient.address))
        .to.emit(router, "Withdraw")
        .withArgs(merchant.address, ethers.parseUnits("99", 6))
        .and.to.emit(router, "PayoutDelivered")
        .withArgs(merchant.address, recipient.address, ethers.parseUnits("99", 6), ethers.parseUnits("1", 6));

      const recipientBalAfter = await usdc.balanceOf(recipient.address);
      const treasuryBalAfter = await usdc.balanceOf(treasury.address);

      expect(recipientBalAfter - recipientBalBefore).to.equal(ethers.parseUnits("99", 6));
      expect(treasuryBalAfter - treasuryBalBefore).to.equal(ethers.parseUnits("1", 6));
      expect(await router.merchantBalances(merchant.address)).to.equal(0);
    });

    it("should never allow the owner to rescue the payment token", async function () {
      const { usdc, router, owner, subscriber, merchant } = await loadFixture(deployRouterFixture);

      const amount = ethers.parseUnits("100", 6);
      await router.connect(subscriber).depositForMerchant(merchant.address, amount, "receipt-1");
      expect(await router.totalMerchantLiabilities()).to.equal(amount);

      /* Legacy deposits predate the liability counter, so payment-token rescue stays disabled
         even when the current counter appears to leave a surplus. */
      await expect(
        router.rescueERC20(await usdc.getAddress(), owner.address, 1)
      ).to.be.revertedWith("Payment token rescue disabled");

      /* Direct transfers cannot be distinguished safely from pre-upgrade liabilities. */
      const surplus = ethers.parseUnits("5", 6);
      await usdc.connect(subscriber).transfer(await router.getAddress(), surplus);
      await expect(
        router.rescueERC20(await usdc.getAddress(), owner.address, surplus)
      ).to.be.revertedWith("Payment token rescue disabled");

      /* Withdrawal releases the liability */
      await router.connect(merchant).withdraw();
      expect(await router.totalMerchantLiabilities()).to.equal(0);
    });
  });
});
