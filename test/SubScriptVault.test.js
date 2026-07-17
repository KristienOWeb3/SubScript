const { expect } = require("chai");
const { ethers } = require("hardhat");
const {
  loadFixture,
  time,
} = require("@nomicfoundation/hardhat-network-helpers");

/* Hardhat mirror of the critical Foundry vault cases (test/SubScriptVault.t.sol), so
   `npm run test:contracts` always executes vault behavior even where Forge is absent,
   plus UUPS initializer/storage checks that gate any live proxy upgrade. */
describe("SubScriptVault", function () {
  const STANDARD_COMMIT = 2_000_000n; // 2 USDC (6dp) — platform constant
  const CYCLE = 30 * 24 * 60 * 60;
  const GRACE = 7 * 24 * 60 * 60;

  async function deployFixture() {
    const [owner, user, merchant, keeper, treasury, stranger] = await ethers.getSigners();

    const MockUSDC = await ethers.getContractFactory("MockUSDC");
    const usdc = await MockUSDC.deploy();

    /* Deploy behind a real ERC1967 proxy — the deployed testnet topology. */
    const Vault = await ethers.getContractFactory("SubScriptVault");
    const impl = await Vault.deploy();
    const initData = Vault.interface.encodeFunctionData("initialize", [
      await usdc.getAddress(),
      owner.address,
    ]);
    const Proxy = await ethers.getContractFactory("MockERC1967Proxy");
    const proxy = await Proxy.deploy(await impl.getAddress(), initData);
    const vault = Vault.attach(await proxy.getAddress());

    await usdc.mint(user.address, 1_000_000_000n); // 1000 USDC
    await usdc.connect(user).approve(await vault.getAddress(), ethers.MaxUint256);
    await vault.connect(owner).setAuthorizedDrawer(keeper.address, true);
    await vault.connect(owner).setTreasury(treasury.address);

    return { vault, impl, usdc, owner, user, merchant, keeper, treasury, stranger };
  }

  describe("platform-fixed 2 USDC policy", function () {
    it("activates at the standard commitment and reports it as the required commit", async function () {
      const { vault, user, merchant } = await loadFixture(deployFixture);
      await vault.connect(user).commit(merchant.address, STANDARD_COMMIT);
      const [balance, owed, , active, commitNeeded] = await vault.getVault(user.address, merchant.address);
      expect(balance).to.equal(STANDARD_COMMIT);
      expect(owed).to.equal(0n);
      expect(active).to.equal(true);
      expect(commitNeeded).to.equal(STANDARD_COMMIT);
      expect(await vault.STANDARD_COMMIT()).to.equal(STANDARD_COMMIT);
    });

    it("gives merchants no function to choose or raise the commitment", async function () {
      const { vault } = await loadFixture(deployFixture);
      expect(vault.interface.getFunction("setRequiredCommit")).to.equal(null);
      expect(vault.interface.getFunction("requiredCommit")).to.equal(null);
    });

    it("caps the per-cycle draw at 2 USDC even when the user escrowed more", async function () {
      const { vault, usdc, user, merchant, keeper } = await loadFixture(deployFixture);
      await vault.connect(user).commit(merchant.address, 10_000_000n); // 10 USDC surplus commit
      await time.increase(CYCLE + 1);

      const before = await usdc.balanceOf(user.address);
      await vault.connect(keeper).drawUsageFor(merchant.address, user.address, 10_000_000n);

      expect(await vault.merchantClaimable(merchant.address)).to.equal(STANDARD_COMMIT);
      expect(await usdc.balanceOf(user.address)).to.equal(before + 8_000_000n);
    });
  });

  describe("keeper-only settlement", function () {
    it("removes direct merchant draw authority entirely", async function () {
      const { vault, user, merchant } = await loadFixture(deployFixture);
      expect(vault.interface.getFunction("drawUsage")).to.equal(null);

      await vault.connect(user).commit(merchant.address, STANDARD_COMMIT);
      await time.increase(CYCLE + 1);
      await expect(
        vault.connect(merchant).drawUsageFor(merchant.address, user.address, 1_000_000n)
      ).to.be.revertedWith("not drawer");
    });

    it("bounds the keeper by maturity and the reclaim window", async function () {
      const { vault, user, merchant, keeper } = await loadFixture(deployFixture);
      await vault.connect(user).commit(merchant.address, STANDARD_COMMIT);

      await expect(
        vault.connect(keeper).drawUsageFor(merchant.address, user.address, 1_000_000n)
      ).to.be.revertedWith("cycle not mature");

      await time.increase(CYCLE + GRACE + 1);
      await expect(
        vault.connect(keeper).drawUsageFor(merchant.address, user.address, 1_000_000n)
      ).to.be.revertedWith("reclaim window opened");
    });

    it("settles usage, refunds the remainder, and requires a fresh commitment", async function () {
      const { vault, usdc, user, merchant, keeper } = await loadFixture(deployFixture);
      await vault.connect(user).commit(merchant.address, STANDARD_COMMIT);
      await time.increase(CYCLE + 1);

      const before = await usdc.balanceOf(user.address);
      await vault.connect(keeper).drawUsageFor(merchant.address, user.address, 800_000n);

      const [balance, , cycleStart, active] = await vault.getVault(user.address, merchant.address);
      expect(balance).to.equal(0n);
      expect(cycleStart).to.equal(0n);
      expect(active).to.equal(false);
      expect(await usdc.balanceOf(user.address)).to.equal(before + 1_200_000n);
      expect(await vault.merchantClaimable(merchant.address)).to.equal(800_000n);
    });

    it("merchant claim pays out less the flat 1% treasury fee", async function () {
      const { vault, usdc, user, merchant, keeper, treasury } = await loadFixture(deployFixture);
      await vault.connect(user).commit(merchant.address, STANDARD_COMMIT);
      await time.increase(CYCLE + 1);
      await vault.connect(keeper).drawUsageFor(merchant.address, user.address, STANDARD_COMMIT);

      const merchantBefore = await usdc.balanceOf(merchant.address);
      const treasuryBefore = await usdc.balanceOf(treasury.address);
      await vault.connect(merchant).merchantClaim();
      expect(await usdc.balanceOf(merchant.address)).to.equal(merchantBefore + 1_980_000n);
      expect(await usdc.balanceOf(treasury.address)).to.equal(treasuryBefore + 20_000n);
    });
  });

  describe("disputes", function () {
    it("an open user dispute blocks settlement and reclaim until the owner resolves", async function () {
      const { vault, owner, user, merchant, keeper } = await loadFixture(deployFixture);
      await vault.connect(user).commit(merchant.address, STANDARD_COMMIT);
      await vault.connect(user).raiseDispute(merchant.address);

      await time.increase(CYCLE + 1);
      await expect(
        vault.connect(keeper).drawUsageFor(merchant.address, user.address, 1_000_000n)
      ).to.be.revertedWith("disputed");

      await time.increase(GRACE + 1);
      await expect(
        vault.connect(user).reclaimAbandonedEscrow(merchant.address)
      ).to.be.revertedWith("disputed");

      await vault.connect(owner).resolveDispute(user.address, merchant.address, true);
      await vault.connect(keeper).drawUsageFor(merchant.address, user.address, 1_000_000n);
      expect(await vault.merchantClaimable(merchant.address)).to.equal(1_000_000n);
    });

    it("only the owner can resolve a dispute", async function () {
      const { vault, user, merchant } = await loadFixture(deployFixture);
      await vault.connect(user).commit(merchant.address, STANDARD_COMMIT);
      await vault.connect(user).raiseDispute(merchant.address);
      await expect(
        vault.connect(merchant).resolveDispute(user.address, merchant.address, true)
      ).to.be.reverted;
    });
  });

  describe("user reclaim and pause", function () {
    it("lets the user reclaim the full escrow after lock + grace, even while paused", async function () {
      const { vault, usdc, owner, user, merchant } = await loadFixture(deployFixture);
      await vault.connect(user).commit(merchant.address, STANDARD_COMMIT);
      await time.increase(CYCLE + GRACE + 1);
      await vault.connect(owner).pause();

      const before = await usdc.balanceOf(user.address);
      await vault.connect(user).reclaimAbandonedEscrow(merchant.address);
      expect(await usdc.balanceOf(user.address)).to.equal(before + STANDARD_COMMIT);
    });

    it("pause blocks commits and settlement", async function () {
      const { vault, owner, user, merchant, keeper } = await loadFixture(deployFixture);
      await vault.connect(user).commit(merchant.address, STANDARD_COMMIT);
      await time.increase(CYCLE + 1);
      await vault.connect(owner).pause();

      await expect(vault.connect(user).commit(merchant.address, 1n)).to.be.reverted;
      await expect(
        vault.connect(keeper).drawUsageFor(merchant.address, user.address, 1n)
      ).to.be.reverted;
    });
  });

  describe("upgrade safety", function () {
    it("initializers are locked and upgrades are owner-only", async function () {
      const { vault, impl, usdc, owner, stranger } = await loadFixture(deployFixture);

      /* Proxy: initialize cannot rerun; reinitializer(2) is owner-gated. */
      await expect(vault.initialize(await usdc.getAddress(), owner.address)).to.be.reverted;
      await expect(vault.connect(stranger).initializeV2(stranger.address)).to.be.reverted;

      /* The raw implementation is bricked (`_disableInitializers`). */
      await expect(impl.initialize(await usdc.getAddress(), owner.address)).to.be.reverted;

      /* Only the owner may authorize a UUPS upgrade. */
      const Vault = await ethers.getContractFactory("SubScriptVault");
      const nextImpl = await Vault.deploy();
      await expect(
        vault.connect(stranger).upgradeToAndCall(await nextImpl.getAddress(), "0x")
      ).to.be.reverted;
      await vault.connect(owner).upgradeToAndCall(await nextImpl.getAddress(), "0x");
      /* State survives the upgrade (proxy storage untouched). */
      expect(await vault.STANDARD_COMMIT()).to.equal(STANDARD_COMMIT);
    });
  });
});
