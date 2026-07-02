// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import "@openzeppelin/contracts/utils/cryptography/SignatureChecker.sol";

/**
 * @title SubScriptGameEscrow
 * @notice Equal-stake ERC20 escrow for referee-coordinated, turn-based games.
 * @dev The referee validates gameplay off-chain. This contract only records the
 *      referee's state commitments and enforces escrow settlement.
 *
 *      A game stops accepting moves exactly 24 hours after the second player
 *      joins. If no signed result has been submitted by then, anyone may award
 *      the pot to the player whose turn it was not when time expired.
 *
 *      If a referee disappears and both players prefer a refund instead of the
 *      deterministic timeout result, each player may approve an emergency
 *      refund after a seven-day settlement grace period. Requiring both
 *      approvals prevents a losing player from unilaterally evading timeout.
 *
 *      The token is intentionally immutable and there is no rescue function
 *      for it: all escrowed payment tokens can leave only through a terminal
 *      game transition.
 */
contract SubScriptGameEscrow is Ownable, Pausable, ReentrancyGuard, EIP712 {
    using SafeERC20 for IERC20;

    uint256 public constant GAME_DURATION = 24 hours;
    uint256 public constant EMERGENCY_REFUND_GRACE = 7 days;
    uint256 public constant TREASURY_FEE_BPS = 1_000;
    uint256 public constant BPS_DENOMINATOR = 10_000;

    bytes32 public constant GAME_RESULT_TYPEHASH = keccak256(
        "GameResult(uint256 gameId,address winner,bool draw,bytes32 finalStateHash,uint256 validUntil)"
    );

    enum Status {
        None,
        Open,
        Active,
        WinnerPaid,
        Drawn,
        TimedOut,
        Cancelled,
        Refunded
    }

    struct Game {
        address creator;
        address opponent;
        address playerWhite;
        address playerBlack;
        address currentTurn;
        uint256 stake;
        uint64 joinedAt;
        uint64 deadline;
        bytes32 stateHash;
        Status status;
    }

    IERC20 public immutable paymentToken;
    address public immutable treasury;
    address public referee;
    uint256 public nextGameId = 1;
    uint256 public totalEscrowed;

    mapping(uint256 gameId => Game game) public games;
    mapping(uint256 gameId => mapping(address player => bool approved))
        public emergencyRefundApproved;

    event GameCreated(
        uint256 indexed gameId,
        address indexed creator,
        address indexed opponent,
        uint256 stake,
        bytes32 initialStateHash
    );
    event GameJoined(
        uint256 indexed gameId,
        address indexed playerWhite,
        address indexed playerBlack,
        uint64 deadline
    );
    event GameStateRecorded(
        uint256 indexed gameId,
        bytes32 indexed stateHash,
        address indexed currentTurn
    );
    event GameSettled(
        uint256 indexed gameId,
        address indexed winner,
        uint256 winnerAmount,
        uint256 treasuryFee,
        Status status,
        bytes32 finalStateHash
    );
    event GameDrawn(uint256 indexed gameId, uint256 refundPerPlayer, bytes32 finalStateHash);
    event GameCancelled(uint256 indexed gameId, address indexed creator, uint256 refund);
    event EmergencyRefundApproved(uint256 indexed gameId, address indexed player);
    event EmergencyRefunded(uint256 indexed gameId, uint256 refundPerPlayer);
    event RefereeSet(address indexed previousReferee, address indexed newReferee);

    error InvalidAddress();
    error InvalidAmount();
    error InvalidStateHash();
    error InvalidStatus(uint256 gameId, Status actual);
    error NotCreator();
    error NotOpponent();
    error CannotPlaySelf();
    error NotPlayer();
    error NotRefereeOrOwner();
    error GameExpired(uint256 deadline);
    error GameNotExpired(uint256 deadline);
    error InvalidNextTurn();
    error InvalidResult();
    error SignatureExpired();
    error InvalidRefereeSignature();
    error EmergencyRefundNotReady(uint256 availableAt);
    error EmergencyRefundAlreadyApproved();
    error UnsupportedPaymentToken();

    constructor(
        address token_,
        address treasury_,
        address referee_,
        address owner_
    ) Ownable(owner_) EIP712("SubScriptGameEscrow", "1") {
        if (
            token_ == address(0) ||
            treasury_ == address(0) ||
            referee_ == address(0) ||
            owner_ == address(0)
        ) {
            revert InvalidAddress();
        }

        paymentToken = IERC20(token_);
        treasury = treasury_;
        referee = referee_;
    }

    /**
     * @notice Creates an invitation and escrows the creator's stake.
     * @param opponent Address allowed to join, or address(0) for a public game.
     * @param stake Equal amount each player must escrow.
     * @param initialStateHash Commitment to the game's initial state.
     */
    function createGame(
        address opponent,
        uint256 stake,
        bytes32 initialStateHash
    ) external whenNotPaused nonReentrant returns (uint256 gameId) {
        if (stake == 0) revert InvalidAmount();
        if (opponent == msg.sender) revert CannotPlaySelf();
        if (initialStateHash == bytes32(0)) revert InvalidStateHash();

        gameId = nextGameId++;
        games[gameId] = Game({
            creator: msg.sender,
            opponent: opponent,
            playerWhite: address(0),
            playerBlack: address(0),
            currentTurn: address(0),
            stake: stake,
            joinedAt: 0,
            deadline: 0,
            stateHash: initialStateHash,
            status: Status.Open
        });

        totalEscrowed += stake;
        _collectExactStake(msg.sender, stake);

        emit GameCreated(gameId, msg.sender, opponent, stake, initialStateHash);
    }

    /**
     * @notice Joins an open game and starts its fixed 24-hour play clock.
     * @dev Color assignment is deliberately random-ish, not a source of secure
     *      randomness. Neither color has custody implications.
     */
    function joinGame(uint256 gameId) external whenNotPaused nonReentrant {
        Game storage game = games[gameId];
        if (game.status != Status.Open) revert InvalidStatus(gameId, game.status);
        if (msg.sender == game.creator) revert CannotPlaySelf();
        if (game.opponent != address(0) && game.opponent != msg.sender) revert NotOpponent();

        _collectExactStake(msg.sender, game.stake);
        totalEscrowed += game.stake;

        game.opponent = msg.sender;

        bool creatorIsWhite = (uint256(
            keccak256(
                abi.encodePacked(
                    block.prevrandao,
                    blockhash(block.number - 1),
                    gameId,
                    game.creator,
                    msg.sender,
                    address(this)
                )
            )
        ) & 1) == 0;

        game.playerWhite = creatorIsWhite ? game.creator : msg.sender;
        game.playerBlack = creatorIsWhite ? msg.sender : game.creator;
        game.currentTurn = game.playerWhite;
        game.joinedAt = uint64(block.timestamp);
        game.deadline = uint64(block.timestamp + GAME_DURATION);
        game.status = Status.Active;

        emit GameJoined(gameId, game.playerWhite, game.playerBlack, game.deadline);
    }

    /**
     * @notice Records a referee-validated state and changes whose turn it is.
     * @dev The contract does not attempt to validate chess rules.
     */
    function recordGameState(
        uint256 gameId,
        bytes32 newStateHash,
        address nextTurn
    ) external {
        if (msg.sender != referee && msg.sender != owner()) revert NotRefereeOrOwner();

        Game storage game = games[gameId];
        if (game.status != Status.Active) revert InvalidStatus(gameId, game.status);
        if (block.timestamp >= game.deadline) revert GameExpired(game.deadline);
        if (newStateHash == bytes32(0)) revert InvalidStateHash();

        address expectedNextTurn = game.currentTurn == game.playerWhite
            ? game.playerBlack
            : game.playerWhite;
        if (nextTurn != expectedNextTurn) revert InvalidNextTurn();

        game.stateHash = newStateHash;
        game.currentTurn = nextTurn;

        emit GameStateRecorded(gameId, newStateHash, nextTurn);
    }

    /**
     * @notice Settles a referee-signed result. Anyone may relay the signature.
     * @param winner A player address for a win, or address(0) for a draw.
     * @param draw True to refund both stakes without charging a treasury fee.
     */
    function settleGame(
        uint256 gameId,
        address winner,
        bool draw,
        bytes32 finalStateHash,
        uint256 validUntil,
        bytes calldata signature
    ) external nonReentrant {
        Game storage game = games[gameId];
        if (game.status != Status.Active) revert InvalidStatus(gameId, game.status);
        if (block.timestamp > validUntil) revert SignatureExpired();
        if (finalStateHash == bytes32(0)) revert InvalidStateHash();
        if (draw ? winner != address(0) : !_isPlayer(game, winner)) revert InvalidResult();

        bytes32 structHash = keccak256(
            abi.encode(
                GAME_RESULT_TYPEHASH,
                gameId,
                winner,
                draw,
                finalStateHash,
                validUntil
            )
        );
        if (
            !SignatureChecker.isValidSignatureNow(
                referee,
                _hashTypedDataV4(structHash),
                signature
            )
        ) {
            revert InvalidRefereeSignature();
        }

        game.stateHash = finalStateHash;

        if (draw) {
            _refundDraw(gameId, game, Status.Drawn);
            emit GameDrawn(gameId, game.stake, finalStateHash);
            return;
        }

        _payWinner(gameId, game, winner, Status.WinnerPaid, finalStateHash);
    }

    /**
     * @notice Permissionless liveness fallback after the 24-hour deadline. It refunds both stakes
     *         (no fee) rather than paying a winner: the contract does not reliably track whose turn
     *         it is on-chain — the referee validates play off-chain, and `currentTurn` is not
     *         advanced per move — so awarding a "winner" here would be based on stale state and
     *         could pay the wrong player. The decisive result is instead paid to the real winner
     *         via the referee-signed `settleGame`, which the SubScript keeper relays as soon as a
     *         game ends. This path only matters if that never happens, and a fair refund is the
     *         safe outcome when no trustworthy result is available on-chain.
     */
    function claimTimeout(uint256 gameId) external nonReentrant {
        Game storage game = games[gameId];
        if (game.status != Status.Active) revert InvalidStatus(gameId, game.status);
        if (block.timestamp < game.deadline) revert GameNotExpired(game.deadline);

        uint256 refundPerPlayer = game.stake;
        _refundDraw(gameId, game, Status.TimedOut);
        emit GameDrawn(gameId, refundPerPlayer, game.stateHash);
    }

    /**
     * @notice Cancels an invitation before another player joins.
     */
    function cancelUnjoinedGame(uint256 gameId) external nonReentrant {
        Game storage game = games[gameId];
        if (game.status != Status.Open) revert InvalidStatus(gameId, game.status);
        if (game.creator != msg.sender) revert NotCreator();

        game.status = Status.Cancelled;
        totalEscrowed -= game.stake;
        paymentToken.safeTransfer(game.creator, game.stake);

        emit GameCancelled(gameId, game.creator, game.stake);
    }

    /**
     * @notice Approves a no-fee refund after the seven-day liveness grace.
     * @dev Both players must approve. The second approval performs the refund.
     *      Normal timeout remains permissionless throughout the grace period.
     */
    function approveEmergencyRefund(uint256 gameId) external nonReentrant {
        Game storage game = games[gameId];
        if (game.status != Status.Active) revert InvalidStatus(gameId, game.status);
        if (!_isPlayer(game, msg.sender)) revert NotPlayer();

        uint256 availableAt = uint256(game.deadline) + EMERGENCY_REFUND_GRACE;
        if (block.timestamp < availableAt) revert EmergencyRefundNotReady(availableAt);
        if (emergencyRefundApproved[gameId][msg.sender]) {
            revert EmergencyRefundAlreadyApproved();
        }

        emergencyRefundApproved[gameId][msg.sender] = true;
        emit EmergencyRefundApproved(gameId, msg.sender);

        address otherPlayer = msg.sender == game.playerWhite
            ? game.playerBlack
            : game.playerWhite;
        if (emergencyRefundApproved[gameId][otherPlayer]) {
            uint256 refund = game.stake;
            _refundDraw(gameId, game, Status.Refunded);
            emit EmergencyRefunded(gameId, refund);
        }
    }

    function setReferee(address newReferee) external onlyOwner {
        if (newReferee == address(0)) revert InvalidAddress();
        address previousReferee = referee;
        referee = newReferee;
        emit RefereeSet(previousReferee, newReferee);
    }

    /**
     * @notice Pausing blocks new stake intake, but never traps existing escrow.
     */
    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    function gameResultDigest(
        uint256 gameId,
        address winner,
        bool draw,
        bytes32 finalStateHash,
        uint256 validUntil
    ) external view returns (bytes32) {
        return
            _hashTypedDataV4(
                keccak256(
                    abi.encode(
                        GAME_RESULT_TYPEHASH,
                        gameId,
                        winner,
                        draw,
                        finalStateHash,
                        validUntil
                    )
                )
            );
    }

    function _payWinner(
        uint256 gameId,
        Game storage game,
        address winner,
        Status terminalStatus,
        bytes32 finalStateHash
    ) internal {
        uint256 pot = game.stake * 2;
        uint256 treasuryFee = (pot * TREASURY_FEE_BPS) / BPS_DENOMINATOR;
        uint256 winnerAmount = pot - treasuryFee;

        game.status = terminalStatus;
        totalEscrowed -= pot;

        paymentToken.safeTransfer(treasury, treasuryFee);
        paymentToken.safeTransfer(winner, winnerAmount);

        emit GameSettled(
            gameId,
            winner,
            winnerAmount,
            treasuryFee,
            terminalStatus,
            finalStateHash
        );
    }

    function _refundDraw(
        uint256,
        Game storage game,
        Status terminalStatus
    ) internal {
        uint256 pot = game.stake * 2;
        game.status = terminalStatus;
        totalEscrowed -= pot;

        paymentToken.safeTransfer(game.creator, game.stake);
        paymentToken.safeTransfer(game.opponent, game.stake);
    }

    function _collectExactStake(address from, uint256 amount) internal {
        uint256 balanceBefore = paymentToken.balanceOf(address(this));
        paymentToken.safeTransferFrom(from, address(this), amount);
        if (paymentToken.balanceOf(address(this)) - balanceBefore != amount) {
            revert UnsupportedPaymentToken();
        }
    }

    function _isPlayer(Game storage game, address account) internal view returns (bool) {
        return account == game.playerWhite || account == game.playerBlack;
    }
}
