const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture } = require("@nomicfoundation/hardhat-network-helpers");

describe("SubScriptSBT", function () {
  /* Shared Fixture for deploying the SBT contract */
  async function deployFixture() {
    const [owner, minter, subscriber, recipient, stranger] = await ethers.getSigners();

    /* Deploy SubScriptSBT with owner and base URI */
    const SubScriptSBT = await ethers.getContractFactory("SubScriptSBT");
    const baseURI = "https://api.subscript.com/api/sbt/";
    const sbt = await SubScriptSBT.deploy(owner.address, baseURI);

    return {
      sbt,
      owner,
      minter,
      subscriber,
      recipient,
      stranger,
      baseURI
    };
  }

  describe("Deployment", function () {
    it("should set the correct name, symbol and owner", async function () {
      const { sbt, owner } = await loadFixture(deployFixture);
      expect(await sbt.name()).to.equal("SubScript Soulbound Access Token");
      expect(await sbt.symbol()).to.equal("SUB-SBT");
      expect(await sbt.owner()).to.equal(owner.address);
    });

    it("should return the correct base URI", async function () {
      const { sbt, owner } = await loadFixture(deployFixture);
      
      /* Mint a token to check tokenURI resolution */
      const subscriptionId = 12345;
      await sbt.connect(owner).mint(owner.address, subscriptionId);
      
      expect(await sbt.tokenURI(1)).to.equal("https://api.subscript.com/api/sbt/1");
    });
  });

  describe("Soulbound constraints (Transfers & Approvals)", function () {
    it("should reject standard transferFrom calls", async function () {
      const { sbt, owner, subscriber, recipient } = await loadFixture(deployFixture);
      
      await sbt.connect(owner).mint(subscriber.address, 101);

      await expect(
        sbt.connect(subscriber).transferFrom(subscriber.address, recipient.address, 1)
      ).to.be.revertedWith("SBT: Transfers are disabled");
    });

    it("should reject safeTransferFrom calls", async function () {
      const { sbt, owner, subscriber, recipient } = await loadFixture(deployFixture);
      
      await sbt.connect(owner).mint(subscriber.address, 102);

      await expect(
        sbt.connect(subscriber)["safeTransferFrom(address,address,uint256)"](subscriber.address, recipient.address, 1)
      ).to.be.revertedWith("SBT: Transfers are disabled");
    });

    it("should reject approve calls", async function () {
      const { sbt, owner, subscriber, stranger } = await loadFixture(deployFixture);
      
      await sbt.connect(owner).mint(subscriber.address, 103);

      await expect(
        sbt.connect(subscriber).approve(stranger.address, 1)
      ).to.be.revertedWith("SBT: Approvals are disabled");
    });

    it("should reject setApprovalForAll calls", async function () {
      const { sbt, owner, subscriber, stranger } = await loadFixture(deployFixture);
      
      await expect(
        sbt.connect(subscriber).setApprovalForAll(stranger.address, true)
      ).to.be.revertedWith("SBT: Approvals are disabled");
    });
  });

  describe("Minting", function () {
    it("should allow owner to mint and set bidirectional mappings", async function () {
      const { sbt, owner, subscriber } = await loadFixture(deployFixture);
      const subId = 777;

      await expect(sbt.connect(owner).mint(subscriber.address, subId))
        .to.emit(sbt, "Transfer")
        .withArgs(ethers.ZeroAddress, subscriber.address, 1);

      expect(await sbt.ownerOf(1)).to.equal(subscriber.address);
      expect(await sbt.tokenToSubscriptionId(1)).to.equal(subId);
      expect(await sbt.subscriptionToTokenId(subId)).to.equal(1);
    });

    it("should reject minting to zero address", async function () {
      const { sbt, owner } = await loadFixture(deployFixture);
      await expect(
        sbt.connect(owner).mint(ethers.ZeroAddress, 888)
      ).to.be.revertedWith("SBT: Cannot mint to zero address");
    });

    it("should prevent duplicate minting for the same subscription ID", async function () {
      const { sbt, owner, subscriber, stranger } = await loadFixture(deployFixture);
      const subId = 999;

      await sbt.connect(owner).mint(subscriber.address, subId);

      await expect(
        sbt.connect(owner).mint(stranger.address, subId)
      ).to.be.revertedWith("SBT: Token already minted for subscription");
    });

    it("should prevent non-owners from minting", async function () {
      const { sbt, stranger, subscriber } = await loadFixture(deployFixture);
      await expect(
        sbt.connect(stranger).mint(subscriber.address, 111)
      ).to.be.revertedWithCustomError(sbt, "OwnableUnauthorizedAccount");
    });
  });

  describe("Burning & Mapping Cleanup", function () {
    it("should allow owner to burn and clear bidirectional mapping bindings", async function () {
      const { sbt, owner, subscriber } = await loadFixture(deployFixture);
      const subId = 555;

      await sbt.connect(owner).mint(subscriber.address, subId);
      expect(await sbt.subscriptionToTokenId(subId)).to.equal(1);
      expect(await sbt.tokenToSubscriptionId(1)).to.equal(subId);

      /* Burn the token and assert it clears mapping and emits MetadataUpdate */
      await expect(sbt.connect(owner).burn(1))
        .to.emit(sbt, "MetadataUpdate")
        .withArgs(1);

      expect(await sbt.subscriptionToTokenId(subId)).to.equal(0);
      expect(await sbt.tokenToSubscriptionId(1)).to.equal(0);
      
      /* Verify the token is actually burned */
      await expect(sbt.ownerOf(1)).to.be.reverted;

      /* Verify that we can now mint a new token for the same subscription ID */
      await expect(sbt.connect(owner).mint(subscriber.address, subId))
        .to.emit(sbt, "Transfer")
        .withArgs(ethers.ZeroAddress, subscriber.address, 2);

      expect(await sbt.subscriptionToTokenId(subId)).to.equal(2);
      expect(await sbt.tokenToSubscriptionId(2)).to.equal(subId);
    });

    it("should prevent non-owners from burning", async function () {
      const { sbt, owner, subscriber, stranger } = await loadFixture(deployFixture);
      await sbt.connect(owner).mint(subscriber.address, 444);

      await expect(
        sbt.connect(stranger).burn(1)
      ).to.be.revertedWithCustomError(sbt, "OwnableUnauthorizedAccount");
    });
  });

  describe("Metadata Refresh", function () {
    it("should emit MetadataUpdate on refreshMetadata", async function () {
      const { sbt, owner, subscriber } = await loadFixture(deployFixture);
      await sbt.connect(owner).mint(subscriber.address, 333);

      await expect(sbt.connect(owner).refreshMetadata(1))
        .to.emit(sbt, "MetadataUpdate")
        .withArgs(1);
    });

    it("should revert refreshMetadata for non-existent token", async function () {
      const { sbt, owner } = await loadFixture(deployFixture);
      await expect(
        sbt.connect(owner).refreshMetadata(99)
      ).to.be.revertedWith("SBT: Token does not exist");
    });

    it("should prevent non-owners from calling refreshMetadata", async function () {
      const { sbt, owner, subscriber, stranger } = await loadFixture(deployFixture);
      await sbt.connect(owner).mint(subscriber.address, 222);

      await expect(
        sbt.connect(stranger).refreshMetadata(1)
      ).to.be.revertedWithCustomError(sbt, "OwnableUnauthorizedAccount");
    });

    it("should emit BatchMetadataUpdate when setBaseURI is called", async function () {
      const { sbt, owner, subscriber } = await loadFixture(deployFixture);
      await sbt.connect(owner).mint(subscriber.address, 111);

      await expect(sbt.connect(owner).setBaseURI("https://newapi.subscript.com/sbt/"))
        .to.emit(sbt, "BatchMetadataUpdate")
        .withArgs(1, 1);
    });
  });

  describe("ERC165 Interface Support", function () {
    it("should support ERC721 and ERC4906 interfaces", async function () {
      const { sbt } = await loadFixture(deployFixture);
      
      /* ERC721 interface ID is 0x80ac58cd */
      expect(await sbt.supportsInterface("0x80ac58cd")).to.be.true;

      /* ERC4906 interface ID is 0x49064906 */
      expect(await sbt.supportsInterface("0x49064906")).to.be.true;

      /* Random interface ID should not be supported */
      expect(await sbt.supportsInterface("0xffffffff")).to.be.false;
    });
  });
});
