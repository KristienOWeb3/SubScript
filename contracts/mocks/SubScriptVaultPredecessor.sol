// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/**
 * @dev Test-only fixture matching the deployed predecessor storage order represented
 *      by contracts/SubScriptVault.sol at PR base 5c99783. Keep this fixture minimal:
 *      it exists solely to prove that a V3 upgrade preserves live proxy state.
 */
contract SubScriptVaultPredecessor is
    Initializable,
    UUPSUpgradeable,
    OwnableUpgradeable,
    ReentrancyGuard,
    PausableUpgradeable
{
    using SafeERC20 for IERC20;

    IERC20 public paymentToken;

    struct Vault {
        uint256 balance;
        uint256 owed;
        uint64 cycleStart;
        bool active;
        uint64 lockedUntil;
    }

    mapping(address => mapping(address => Vault)) public vaults;
    mapping(address => uint256) public requiredCommit;
    mapping(address => uint256) public merchantClaimable;
    mapping(address => bool) public authorizedDrawers;
    uint64 public cycleLength;
    address public treasury;

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(address token, address initialOwner) external initializer {
        __Ownable_init(initialOwner);
        __Pausable_init();
        require(token != address(0), "token=0");
        paymentToken = IERC20(token);
        cycleLength = 30 days;
        treasury = initialOwner;
    }

    function setRequiredCommit(uint256 amount) external {
        requiredCommit[msg.sender] = amount;
    }

    function commit(address merchant, uint256 amount) external nonReentrant whenNotPaused {
        require(merchant != address(0), "merchant=0");
        require(amount > 0, "amount=0");

        paymentToken.safeTransferFrom(msg.sender, address(this), amount);

        Vault storage v = vaults[msg.sender][merchant];
        v.balance += amount;
        if (!v.active && v.balance >= requiredCommit[merchant]) {
            v.active = true;
            v.cycleStart = uint64(block.timestamp);
            v.lockedUntil = uint64(block.timestamp + cycleLength);
        }
    }

    function setAuthorizedDrawer(address drawer, bool allowed) external onlyOwner {
        authorizedDrawers[drawer] = allowed;
    }

    function setTreasury(address newTreasury) external onlyOwner {
        require(newTreasury != address(0), "treasury=0");
        treasury = newTreasury;
    }

    function _authorizeUpgrade(address) internal override onlyOwner {}
}
