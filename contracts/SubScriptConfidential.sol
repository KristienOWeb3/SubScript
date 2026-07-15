/* SPDX-License-Identifier: MIT */
pragma solidity ^0.8.24;

import "./SubScriptPSA.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/*
 * @title SubScriptConfidential
 * @author SubScript Protocol
 * @notice Access-gated batch-payout extension of SubScriptPSA. It adds owner/view-key governed
 *         READ access over payout data and governed batch settlement.
 *
 *         IMPORTANT — this contract does NOT make payments confidential on-chain. Recipient
 *         addresses and amounts are public in transaction calldata and contract storage, exactly
 *         like any other EVM transaction; a gated getter cannot hide data that is already on the
 *         public ledger. Treat "Confidential" here as access-controlled reads, NOT cryptographic
 *         privacy, and do not represent payments made through it as private or anonymous.
 *
 *         VIEW KEY REGISTRATION uses a commit-reveal scheme to prevent mempool front-running:
 *           1. commitViewKey(commitment)  — stores keccak256(viewKeyHash, msg.sender, salt)
 *           2. revealViewKey(viewKeyHash, salt) — after COMMIT_DELAY blocks, reveals and registers
 *         This ensures an observer who sees the commitment cannot derive the viewKeyHash to
 *         front-run the registration, because the commitment also binds msg.sender and a secret salt.
 */
contract SubScriptConfidential is SubScriptPSA, Ownable {
    using SafeERC20 for IERC20;

    /* ──────────────────────────── Types ──────────────────────────── */

    struct BatchRecord {
        address[] recipients;
        uint256[] amounts;
        bool isShielded;
        uint256 timestamp;
    }

    struct ViewKeyCommitment {
        bytes32 commitment;     // keccak256(abi.encodePacked(viewKeyHash, msg.sender, salt))
        uint256 commitBlock;    // block.number at commit time
    }

    /* ──────────────────────────── State ──────────────────────────── */

    /* Mapping from viewKeyHash => merchant address */
    mapping(bytes32 => address) public viewKeyHashes;

    /* Block at which each viewKeyHash was registered. A reveal may take over a
       registration made AFTER its own commit block (see revealViewKey): the hash was
       secret until the reveal hit the mempool, so any registration younger than the
       commitment is by definition a front-run of that reveal. */
    mapping(bytes32 => uint256) public viewKeyRegistrationBlock;

    /* Mapping from merchant => array of batch records */
    mapping(address => BatchRecord[]) private batchHistory;

    /* Commit-reveal: merchant address => pending commitment */
    mapping(address => ViewKeyCommitment) public pendingCommitments;

    /* Minimum blocks between commit and reveal to prevent same-block front-running.
       On Arc (~2s blocks), 10 blocks ≈ 20 seconds — long enough that the commit tx is
       confirmed and the mempool window for front-running has closed. */
    uint256 public constant COMMIT_DELAY = 10;

    /* Maximum blocks a commitment remains valid. Prevents stale commitments from being
       revealed indefinitely. 1800 blocks ≈ 1 hour on Arc. */
    uint256 public constant COMMIT_EXPIRY = 1800;

    /* ──────────────────────────── Events ─────────────────────────── */

    event ConfidentialBatchExecuted(
        address indexed merchant,
        bytes32 indexed batchHash,
        bytes encryptedPayload
    );

    event ViewKeyCommitted(address indexed merchant, uint256 commitBlock);
    event ViewKeyRegistered(address indexed merchant, bytes32 indexed viewKeyHash);

    /* ─────────────────────── Constructor ─────────────────────────── */

    constructor(
        address _paymentToken,
        address _stableFXRouter,
        address _treasury,
        address _initialOwner
    )
        SubScriptPSA(_paymentToken, _stableFXRouter, _treasury)
        Ownable(_initialOwner)
    {}

    /* ──────────────────── External Functions ─────────────────────── */

    /*
     * @notice Phase 1 of commit-reveal: submit a blinded commitment.
     * @param _commitment  keccak256(abi.encodePacked(viewKeyHash, msg.sender, salt))
     *        The salt is a random bytes32 chosen by the caller to blind the commitment.
     * @dev Overwrites any previous uncommitted/expired commitment for this sender.
     */
    function commitViewKey(bytes32 _commitment) external {
        require(_commitment != bytes32(0), "Invalid commitment");
        pendingCommitments[msg.sender] = ViewKeyCommitment({
            commitment: _commitment,
            commitBlock: block.number
        });
        emit ViewKeyCommitted(msg.sender, block.number);
    }

    /*
     * @notice Phase 2 of commit-reveal: reveal and register the view key hash.
     * @param _viewKeyHash The keccak256 hash of the plaintext view key.
     * @param _salt        The random salt used in the commitment.
     * @dev Requires COMMIT_DELAY blocks to have passed and the commitment to not be expired.
     *      Once revealed, the commitment is consumed and the view key hash is registered.
     */
    function revealViewKey(bytes32 _viewKeyHash, bytes32 _salt) external {
        require(_viewKeyHash != bytes32(0), "Invalid key hash");

        ViewKeyCommitment storage pending = pendingCommitments[msg.sender];
        require(pending.commitBlock > 0, "No pending commitment");
        require(block.number >= pending.commitBlock + COMMIT_DELAY, "Reveal too early");
        require(block.number <= pending.commitBlock + COMMIT_EXPIRY, "Commitment expired");

        // Verify the commitment matches
        bytes32 expectedCommitment = keccak256(abi.encodePacked(_viewKeyHash, msg.sender, _salt));
        require(pending.commitment == expectedCommitment, "Commitment mismatch");

        /* Earliest commitment wins. The reveal transaction itself exposes the hash in the
           mempool, so an observer could race it with the single-step registerViewKey. Any
           registration whose block is LATER than this commitment can only have learned the
           hash from this reveal (or the legacy tx it raced) — the committer takes it over.
           A registration older than the commitment is legitimate and stays owned. */
        address current = viewKeyHashes[_viewKeyHash];
        require(
            current == address(0)
                || current == msg.sender
                || viewKeyRegistrationBlock[_viewKeyHash] > pending.commitBlock,
            "Key hash already registered"
        );

        // Register (anchoring priority at the commit block) and consume the commitment
        viewKeyHashes[_viewKeyHash] = msg.sender;
        viewKeyRegistrationBlock[_viewKeyHash] = pending.commitBlock;
        delete pendingCommitments[msg.sender];

        emit ViewKeyRegistered(msg.sender, _viewKeyHash);
    }

    /*
     * @notice Legacy single-step registration — kept for backward compatibility but
     *         callers should prefer commitViewKey + revealViewKey to avoid front-running.
     * @dev A hash can only be claimed once (or re-asserted by its current holder) so a
     *      third party can never hijack an already-registered key hash.
     */
    function registerViewKey(bytes32 _viewKeyHash) external {
        require(_viewKeyHash != bytes32(0), "Invalid key hash");
        address current = viewKeyHashes[_viewKeyHash];
        require(current == address(0) || current == msg.sender, "Key hash already registered");
        viewKeyHashes[_viewKeyHash] = msg.sender;
        viewKeyRegistrationBlock[_viewKeyHash] = block.number;
        emit ViewKeyRegistered(msg.sender, _viewKeyHash);
    }

    /*
     * @notice Executes batch payout with opt-in shielding.
     *         Pulls total amount from caller (admin/owner) and routes to recipients.
     * @param viewKeyHash The registered keccak256 hash of the merchant's view key. The
     *        plaintext view key must NEVER be passed here: transaction calldata is public,
     *        so submitting the key on-chain would let anyone replay it against
     *        getDecryptedBatchHistory. Only the hash travels on-chain.
     */
    function executeBatchPayout(
        address[] calldata recipients,
        uint256[] calldata amounts,
        bool isShielded,
        bytes32 viewKeyHash
    ) external onlyOwner nonReentrant {
        require(recipients.length == amounts.length, "Array length mismatch");
        require(recipients.length > 0, "Empty arrays");
        require(recipients.length < 255, "Array size exceeds limit");

        uint256 totalAmount = 0;
        for (uint256 i = 0; i < amounts.length; i++) {
            require(recipients[i] != address(0), "Invalid recipient address");
            require(amounts[i] > 0, "Amount must be positive");
            totalAmount += amounts[i];
        }

        /* Pull total amount from owner (admin wallet) directly into the contract */
        IERC20(paymentToken).safeTransferFrom(msg.sender, address(this), totalAmount);

        /* Route directly to recipients */
        for (uint256 i = 0; i < recipients.length; i++) {
            IERC20(paymentToken).safeTransfer(recipients[i], amounts[i]);
        }

        /* If isShielded is true, invoke native Arc precompile engine at address 0x88 using assembly.
           CAVEAT: on chains where 0x88 is not a live precompile, a CALL to an empty account
           succeeds trivially, so `success` is not proof that shielding happened. Recipients and
           amounts also remain visible in this transaction's public calldata regardless — the
           precompile shields protocol-level state, not the submitted calldata. */
        if (isShielded) {
            address precompile = address(0x0000000000000000000000000000000000000088);
            bytes memory payload = abi.encode(recipients, amounts);
            bool success;
            
            assembly {
                let ptr := mload(0x40)
                let size := mload(payload)
                let dataStart := add(payload, 0x20)
                success := call(gas(), precompile, 0, dataStart, size, 0, 0)
            }
            require(success, "Arc confidential engine precompile execution failed");

            /* Generate a generic/masked identifier for state logs */
            bytes32 batchHash = keccak256(abi.encode(recipients, amounts, block.timestamp));
            
            /* Emit shielded event with masked metadata (totalAmount and count only), suppressing counterparties */
            emit ConfidentialBatchExecuted(
                msg.sender,
                batchHash,
                abi.encode(totalAmount, recipients.length)
            );
        } else {
            /* Emit non-shielded log for transparent execution */
            bytes32 batchHash = keccak256(abi.encode(recipients, amounts, block.timestamp));
            emit ConfidentialBatchExecuted(
                msg.sender,
                batchHash,
                abi.encode(recipients, amounts)
            );
        }

        /* Store the plaintext history for the merchant, if they've registered a view key */
        address merchant = viewKeyHashes[viewKeyHash];
        if (merchant != address(0)) {
            batchHistory[merchant].push(BatchRecord({
                recipients: recipients,
                amounts: amounts,
                isShielded: isShielded,
                timestamp: block.timestamp
            }));
        }
    }

    /*
     * @notice Allows the registered merchant to retrieve plaintext execution logs by view key hash.
     * @dev This function takes the HASH (not the plaintext key) to eliminate the risk of
     *      accidental plaintext leakage in broadcast calldata. The caller must be the merchant
     *      who registered the hash. For off-chain use via eth_call.
     */
    function getDecryptedBatchHistory(
        bytes32 viewKeyHash
    ) external view returns (BatchRecord[] memory) {
        address merchant = viewKeyHashes[viewKeyHash];
        require(merchant != address(0), "Unauthorized: Invalid View Key");
        require(msg.sender == merchant, "Unauthorized: Caller is not the registered merchant");
        return batchHistory[merchant];
    }
}
