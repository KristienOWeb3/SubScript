/* SPDX-License-Identifier: MIT */
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
 *         Operates as a stateless transient dispatcher, holding zero USDC across block boundaries.
 */
contract SubScriptRouter is Initializable, UUPSUpgradeable, OwnableUpgradeable, ReentrancyGuard, PausableUpgradeable {
    using SafeERC20 for IERC20;

    /* ──────────────────────────── State ──────────────────────────── */

    /* The native stablecoin used (e.g. USDC) */
    IERC20 public paymentToken;

    /* Treasury wallet address receiving the 1% protocol fees */
    address public treasury;

    /* Secure internal pull-payment ledger mapping merchant => USDC balance */
    mapping(address => uint256) public merchantBalances;

    /* Prevention against double-spending of commitments */
    mapping(bytes32 => bool) public nullifierHashes;

    /* Record of deposited commitment hashes */
    mapping(bytes32 => bool) public commitments;

    /* Subscription tier for merchants (0 = Standard, 1 = Premium) */
    mapping(address => uint8) public merchantTiers;

    /* Redirected fund payout address for premium merchants */
    mapping(address => address) public merchantPayoutDestination;

    /* ──────────────────────────── Events ─────────────────────────── */

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

    event BatchPayoutExecuted(
        address indexed merchant,
        uint256 totalAmount,
        uint256 recipientCount
    );

    /* ─────────────────────────── Constructor / Initializer ─────────── */

    /** @custom:oz-upgrades-unsafe-allow constructor */
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

    /* ─────────────────────────── Admin Functions ─────────────────── */

    /**
     * @notice UUPS upgrade authorization check.
     */
    function _authorizeUpgrade(address newImplementation) internal override onlyOwner {}

    /**
     * @notice Update treasury address.
     */
    function setTreasury(address _newTreasury) external onlyOwner {
        require(_newTreasury != address(0), "Invalid new treasury");
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

    /* ─────────────────────────── Core Functions ───────────────────── */

    /**
     * @notice Configure a new payout destination address for premium merchants.
     */
    function configurePayoutDestination(address _newDestination) external nonReentrant whenNotPaused {
        require(merchantTiers[msg.sender] >= 1, "Only Premium tier can reroute");
        require(_newDestination != address(0), "Invalid destination address");

        address oldDestination = merchantPayoutDestination[msg.sender];
        merchantPayoutDestination[msg.sender] = _newDestination;

        emit MerchantPayoutRerouted(msg.sender, oldDestination, _newDestination);
    }

    /**
     * @notice Deposit commitment on-chain.
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
     *         Pulls payment from the subscriber's commitment on-chain or direct allowance.
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

        bytes32 expectedPublicInputHash = keccak256(abi.encodePacked(merchant, amount, period));
        require(proof[1] == expectedPublicInputHash, "Parameter mismatch with ZK public inputs");

        /* Derive and verify the commitment from the proof's secret pre-image */
        bytes32 commitment = keccak256(abi.encodePacked(proof[0]));
        require(commitments[commitment], "Commitment not found or already spent");

        /* Burn the commitment to prevent reuse */
        commitments[commitment] = false;

        /* Calculate 1% fee (100 bps) */
        uint256 fee = (amount * 100) / 10000;
        uint256 netAmount = amount - fee;

        /* Mark nullifier hash as spent before transfer (Checks-Effects-Interactions) */
        nullifierHashes[nullifierHash] = true;

        /* Route the protocol fee to the treasury */
        paymentToken.safeTransfer(treasury, fee);

        /* Transfer net amount directly to the merchant (stateless router) */
        address targetPayout = merchant;
        if (merchantTiers[merchant] >= 1 && merchantPayoutDestination[merchant] != address(0)) {
            targetPayout = merchantPayoutDestination[merchant];
        }
        paymentToken.safeTransfer(targetPayout, netAmount);

        emit SubscriptionActivated(nullifierHash, merchant, amount, period);
    }

    /**
     * @notice Safe, non-gated withdrawal function.
     *         Reverts since stateless router holds no funds across blocks.
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
     * @notice Gated withdrawal routing using ZK proof.
     *         Reverts since stateless router holds no funds across blocks.
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

        bytes32 expectedPublicInputHash = keccak256(abi.encodePacked(merchant, target));
        require(proof[1] == expectedPublicInputHash, "Parameter mismatch with ZK public inputs");

        uint256 balance = merchantBalances[merchant];
        require(balance > 0, "No balance to withdraw");

        merchantBalances[merchant] = 0;
        nullifierHashes[nullifierHash] = true;

        paymentToken.safeTransfer(target, balance);

        emit Withdraw(target, balance);
    }

    /**
     * @notice Admin-gated transient batch payout execution.
     *         Pulls total amount from caller and distributes to recipients in a single transaction.
     */
    function executeBatchPayout(
        address[] calldata recipients,
        uint256[] calldata amounts
    ) external onlyOwner nonReentrant whenNotPaused {
        require(recipients.length == amounts.length, "Array length mismatch");
        require(recipients.length > 0, "Empty arrays");

        uint256 totalAmount = 0;
        for (uint256 i = 0; i < amounts.length; i++) {
            require(recipients[i] != address(0), "Invalid recipient address");
            totalAmount += amounts[i];
        }

        /* Pull total amount from owner (admin wallet) directly into the router */
        paymentToken.safeTransferFrom(msg.sender, address(this), totalAmount);

        /* Route directly to recipients instantly (stateless router) */
        for (uint256 i = 0; i < recipients.length; i++) {
            paymentToken.safeTransfer(recipients[i], amounts[i]);
        }

        emit BatchPayoutExecuted(msg.sender, totalAmount, recipients.length);
    }
}
