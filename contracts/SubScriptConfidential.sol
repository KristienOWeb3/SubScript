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

    /* ──────────────────────────── State ──────────────────────────── */

    /* Mapping from viewKeyHash => merchant address */
    mapping(bytes32 => address) public viewKeyHashes;

    /* Mapping from merchant => array of batch records */
    mapping(address => BatchRecord[]) private batchHistory;

    /* ──────────────────────────── Events ─────────────────────────── */

    event ConfidentialBatchExecuted(
        address indexed merchant,
        bytes32 indexed batchHash,
        bytes encryptedPayload
    );

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
     * @notice Registers a hash of the View Key for governed access.
     * @dev A hash can only be claimed once (or re-asserted by its current holder) so a
     *      third party can never hijack an already-registered key hash or front-run a
     *      merchant's registration to redirect their batch history.
     */
    function registerViewKey(bytes32 _viewKeyHash) external {
        require(_viewKeyHash != bytes32(0), "Invalid key hash");
        address current = viewKeyHashes[_viewKeyHash];
        require(current == address(0) || current == msg.sender, "Key hash already registered");
        viewKeyHashes[_viewKeyHash] = msg.sender;
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
     * @notice Allows an authorized caller holding the correct viewKey to retrieve the plaintext execution logs.
     * @dev Intended for off-chain eth_call only — never submit the plaintext key inside a
     *      broadcast transaction, or it becomes public calldata.
     */
    function getDecryptedBatchHistory(
        bytes32 viewKey
    ) external view returns (BatchRecord[] memory) {
        bytes32 keyHash = keccak256(abi.encodePacked(viewKey));
        address merchant = viewKeyHashes[keyHash];
        require(merchant != address(0), "Unauthorized: Invalid View Key");
        return batchHistory[merchant];
    }
}
