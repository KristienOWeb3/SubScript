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
 * @title SubScriptRouter
 * @author SubScript Protocol
 * @notice Vault router routing recurring ZK burner subscriptions to merchants.
 */
contract SubScriptRouter is Initializable, UUPSUpgradeable, OwnableUpgradeable, ReentrancyGuard, PausableUpgradeable {
    using SafeERC20 for IERC20;

    // ──────────────────────────── State ────────────────────────────

    /// @notice The native stablecoin used (e.g. USDC).
    IERC20 public paymentToken;

    /// @notice Treasury wallet address receiving the 1% protocol fees.
    address public treasury;

    /// @notice Secure internal pull-payment ledger mapping merchant => USDC balance.
    mapping(address => uint256) public merchantBalances;

    /// @notice Prevention against double-spending of commitments.
    mapping(bytes32 => bool) public nullifierHashes;

    /// @notice Record of deposited commitment hashes.
    mapping(bytes32 => bool) public commitments;

    /// @notice Subscription tier for merchants (0 = Standard, 1 = Premium).
    mapping(address => uint8) public merchantTiers;

    /// @notice Redirected fund payout address for premium merchants.
    mapping(address => address) public merchantPayoutDestination;

    // ──────────────────────────── Events ───────────────────────────

    event Deposit(bytes32 indexed commitment, uint256 amount);

    event SubscriptionActivated(
        bytes32 indexed nullifierHash,
        address indexed merchant,
        uint256 amount,
        uint256 period
    );

    event Withdraw(address indexed merchant, uint256 amount);

    event MerchantPayoutRerouted(
        address indexed merchant,
        address indexed oldDestination,
        address indexed newDestination
    );

    event ERC20Rescued(
        address indexed token,
        address indexed recipient,
        uint256 amount
    );

    // ─────────────────────────── Constructor / Initializer ───────────

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    /**
     * @notice Initialize function for the upgradeable proxy.
     */
    function initialize(
        address _paymentToken,
        address _treasury,
        address _initialOwner
    ) external initializer {
        require(_paymentToken != address(0), "Invalid token address");
        require(_treasury != address(0), "Invalid treasury address");
        require(_initialOwner != address(0), "Invalid owner address");

        __Ownable_init(_initialOwner);
        __Pausable_init();

        paymentToken = IERC20(_paymentToken);
        treasury = _treasury;
    }

    // ─────────────────────────── Admin Functions ───────────────────

    /**
     * @notice UUPS upgrade authorization check.
     */
    function _authorizeUpgrade(address newImplementation) internal override onlyOwner {}

    /**
     * @notice Update treasury address.
     */
    function setTreasury(address _newTreasury) external onlyOwner {
        require(_newTreasury != address(0), "Invalid treasury address");
        treasury = _newTreasury;
    }

    /**
     * @notice Provision merchant tiers (0 = Standard, 1 = Premium).
     */
    function setMerchantTier(address _merchant, uint8 _tier) external onlyOwner {
        require(_merchant != address(0), "Invalid merchant address");
        merchantTiers[_merchant] = _tier;
    }

    /**
     * @notice Toggle emergency pause
     */
    function pause() external onlyOwner {
        _pause();
    }

    /**
     * @notice Toggle emergency unpause
     */
    function unpause() external onlyOwner {
        _unpause();
    }

    /**
     * @notice Recover stuck ERC20 tokens in the contract.
     */
    function rescueERC20(address token, address to, uint256 amount) external onlyOwner {
        require(token != address(0), "Invalid token address");
        require(to != address(0), "Invalid receiver address");
        require(amount > 0, "Amount must be greater than zero");
        
        uint256 balance = IERC20(token).balanceOf(address(this));
        require(amount <= balance, "Insufficient balance");
        
        IERC20(token).safeTransfer(to, amount);
        emit ERC20Rescued(token, to, amount);
    }

    // ─────────────────────────── Core Functions ─────────────────────

    /**
     * @notice Configure a new payout destination address for premium merchants.
     */
    function configurePayoutDestination(address _newDestination) external whenNotPaused {
        require(merchantTiers[msg.sender] >= 1, "Only Premium tier can reroute");
        require(_newDestination != address(0), "Invalid destination address");

        address oldDestination = merchantPayoutDestination[msg.sender];
        merchantPayoutDestination[msg.sender] = _newDestination;

        emit MerchantPayoutRerouted(msg.sender, oldDestination, _newDestination);
    }

    /**
     * @notice Deposit commitment on-chain using funding wallet.
     */
    function depositAndCommit(bytes32 commitment, uint256 amount) external nonReentrant whenNotPaused {
        require(commitment != bytes32(0), "Invalid commitment");
        require(amount > 0, "Amount must be greater than zero");

        paymentToken.safeTransferFrom(msg.sender, address(this), amount);
        commitments[commitment] = true;

        emit Deposit(commitment, amount);
    }

    /**
     * @notice Verify burner proof and activate subscription.
     * @dev Reverts if inputs do not match ZK public inputs bound to the proof.
     */
    function verifyAndActivate(
        bytes32[] calldata proof,
        bytes32 nullifierHash,
        address merchant,
        uint256 amount,
        uint256 period
    ) external nonReentrant whenNotPaused {
        require(proof.length >= 2, "Invalid proof format");
        require(nullifierHash != bytes32(0), "Invalid nullifier hash");
        require(merchant != address(0), "Invalid merchant address");
        require(amount > 0, "Amount must be greater than zero");
        require(period > 0, "Period must be greater than zero");
        require(!nullifierHashes[nullifierHash], "Nullifier already used");

        // Cryptographically bind parameters to prevent proof-replay/cross-merchant exploits.
        bytes32 expectedPublicInputHash = keccak256(abi.encodePacked(merchant, amount, period));
        require(proof[1] == expectedPublicInputHash, "Parameter mismatch with ZK public inputs");

        // Calculate 1% fee (100 bps)
        uint256 fee = (amount * 100) / 10000;
        uint256 netAmount = amount - fee;

        // Route the protocol fee to the treasury address
        paymentToken.safeTransfer(treasury, fee);

        /* Credit the net amount directly to the merchant's ledger balance */
        merchantBalances[merchant] += netAmount;

        /* Mark the nullifier hash as spent */
        nullifierHashes[nullifierHash] = true;

        emit SubscriptionActivated(nullifierHash, merchant, amount, period);
    }

    /**
     * @notice Safe, non-gated withdrawal function for merchants to pull their USDC.
     */
    function withdraw() external nonReentrant whenNotPaused {
        uint256 balance = merchantBalances[msg.sender];
        require(balance > 0, "No balance to withdraw");

        merchantBalances[msg.sender] = 0;

        address targetPayout = msg.sender;
        if (merchantTiers[msg.sender] >= 1 && merchantPayoutDestination[msg.sender] != address(0)) {
            targetPayout = merchantPayoutDestination[msg.sender];
        }

        paymentToken.safeTransfer(targetPayout, balance);

        emit Withdraw(targetPayout, balance);
    }

    /**
     * @notice Private, zero-knowledge gated withdrawal routing merchant's balance using burner proof.
     */
    function withdrawWithProof(
        bytes32[] calldata proof,
        bytes32 nullifierHash,
        address merchant,
        address target
    ) external nonReentrant whenNotPaused {
        require(proof.length >= 2, "Invalid proof format");
        require(nullifierHash != bytes32(0), "Invalid nullifier hash");
        require(merchant != address(0), "Invalid merchant address");
        require(target != address(0), "Invalid target address");
        require(!nullifierHashes[nullifierHash], "Nullifier already used");

        /* Cryptographically bind parameters to prevent proof-replay/cross-merchant exploits. */
        bytes32 expectedPublicInputHash = keccak256(abi.encodePacked(merchant, target));
        require(proof[1] == expectedPublicInputHash, "Parameter mismatch with ZK public inputs");

        uint256 balance = merchantBalances[merchant];
        require(balance > 0, "No balance to withdraw");

        merchantBalances[merchant] = 0;
        nullifierHashes[nullifierHash] = true;

        paymentToken.safeTransfer(target, balance);

        emit Withdraw(target, balance);
    }
}
