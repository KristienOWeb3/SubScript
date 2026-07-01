"use client";

import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ethers } from "ethers";
import { 
    X, 
    GamepadIcon, 
    Award, 
    Loader2, 
    Trophy, 
    AlertCircle, 
    CheckCircle2, 
    Clock, 
    ArrowRight 
} from "@/components/icons";
import { parseFen as parseChessFen, getLegalTargets as getChessLegalTargets } from "@/lib/games/chess";
import { parseFen as parseCheckersFen, getLegalTargets as getCheckersLegalTargets } from "@/lib/games/checkers";
import { requireGameEscrowAddress } from "@/lib/games/client";
import { ARC_TESTNET_CHAIN_ID, USDC_NATIVE_GAS_ADDRESS } from "@/lib/contracts/constants";

interface GamesModalsProps {
    gamesMenuOpen: boolean;
    setGamesMenuOpen: (open: boolean) => void;
    selectedDmPeer: string | null;
    activePlayingGame: any | null;
    setActivePlayingGame: (game: any) => void;
    isChessBoardModalOpen: boolean;
    setIsChessBoardModalOpen: (open: boolean) => void;
    userWallet: string | null;
    triggerToast: (msg: string) => void;
    refetchDms: () => void;
    writeContractAsync: any;
    refetchUsdc: () => void;
    inline?: boolean;
}

const VAULT_TOKEN_ABI = [
    { type: "function", name: "allowance", stateMutability: "view", inputs: [{ name: "owner", type: "address" }, { name: "spender", type: "address" }], outputs: [{ name: "", type: "uint256" }] },
    { type: "function", name: "approve", stateMutability: "nonpayable", inputs: [{ name: "spender", type: "address" }, { name: "amount", type: "uint256" }], outputs: [{ name: "", type: "bool" }] },
] as const;

export const ESCROW_CONTRACT_ABI = [
    { type: "function", name: "createGame", stateMutability: "nonpayable", inputs: [{ name: "opponent", type: "address" }, { name: "stake", type: "uint256" }, { name: "initialStateHash", type: "bytes32" }], outputs: [{ name: "gameId", type: "uint256" }] },
    { type: "function", name: "joinGame", stateMutability: "nonpayable", inputs: [{ name: "gameId", type: "uint256" }], outputs: [] },
    { type: "function", name: "settleGame", stateMutability: "nonpayable", inputs: [
        { name: "gameId", type: "uint256" },
        { name: "winner", type: "address" },
        { name: "draw", type: "bool" },
        { name: "finalStateHash", type: "bytes32" },
        { name: "validUntil", type: "uint256" },
        { name: "signature", type: "bytes" }
    ], outputs: [] },
    { type: "function", name: "claimTimeout", stateMutability: "nonpayable", inputs: [{ name: "gameId", type: "uint256" }], outputs: [] },
] as const;

const UNICODE_PIECES: Record<string, string> = {
    "w-p": "♙", "w-r": "♖", "w-n": "♘", "w-b": "♗", "w-q": "♕", "w-k": "♔",
    "b-p": "♟", "b-r": "♜", "b-n": "♞", "b-b": "♝", "b-q": "♛", "b-k": "♚",
    "w-cp": "●", "w-ck": "👑",
    "b-cp": "●", "b-ck": "👑"
};

export function GamesModals({
    gamesMenuOpen,
    setGamesMenuOpen,
    selectedDmPeer,
    activePlayingGame,
    setActivePlayingGame,
    isChessBoardModalOpen,
    setIsChessBoardModalOpen,
    userWallet,
    triggerToast,
    refetchDms,
    writeContractAsync,
    refetchUsdc,
    inline = false
}: GamesModalsProps) {
    const [menuStep, setMenuStep] = useState<"catalog" | "stake" | "tx">("catalog");
    const [stakeAmount, setStakeAmount] = useState("1.00");
    const [loading, setLoading] = useState(false);
    const [errorMessage, setErrorMessage] = useState<string | null>(null);
    const [statusMessage, setStatusMessage] = useState<string | null>(null);
    
    // Chess board interaction state
    const [selectedSquare, setSelectedSquare] = useState<string | null>(null);
    const [legalTargets, setLegalTargets] = useState<string[]>([]);
    const [liveTimeLeft, setLiveTimeLeft] = useState("");
    const [isSubmittingMove, setIsSubmittingMove] = useState(false);
    const [isClaimingPayout, setIsClaimingPayout] = useState(false);

    const usdcAddress = USDC_NATIVE_GAS_ADDRESS as `0x${string}`;

    // Reset Games Menu states on close
    useEffect(() => {
        if (!gamesMenuOpen) {
            setMenuStep("catalog");
            setStakeAmount("1.00");
            setErrorMessage(null);
            setStatusMessage(null);
            setLoading(false);
        }
    }, [gamesMenuOpen]);

    // Live countdown timer for active chess game
    useEffect(() => {
        if (!activePlayingGame || activePlayingGame.status !== "ACTIVE" || !activePlayingGame.expiresAt) return;
        const interval = setInterval(() => {
            const diff = new Date(activePlayingGame.expiresAt).getTime() - Date.now();
            if (diff <= 0) {
                setLiveTimeLeft("00:00:00 - Expired");
                clearInterval(interval);
            } else {
                const hours = Math.floor(diff / 3600000);
                const minutes = Math.floor((diff % 3600000) / 60000);
                const seconds = Math.floor((diff % 60000) / 1000);
                setLiveTimeLeft(`${hours.toString().padStart(2, "0")}:${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`);
            }
        }, 1000);
        return () => clearInterval(interval);
    }, [activePlayingGame]);

    // Format helper
    const formatWallet = (addr: string) => `${addr.slice(0, 6)}...${addr.slice(-4)}`;

    const handleCreateInvite = async (e: React.FormEvent) => {
        e.preventDefault();
        setErrorMessage(null);
        setLoading(true);

        try {
            const stakeMicros = BigInt(Math.round(Number(stakeAmount) * 1_000_000));
            if (stakeMicros <= BigInt(0)) {
                throw new Error("Stake amount must be greater than zero");
            }

            // 1. Create game invite record on the backend
            setStatusMessage("Registering game lobby...");
            const res = await fetch("/api/user/dms/games", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "x-session-wallet": userWallet!,
                },
                body: JSON.stringify({
                    opponentAddress: selectedDmPeer,
                    stakeUsdc: stakeAmount,
                }),
            });

            const data = await res.json();
            if (!res.ok) {
                throw new Error(data.error || "Failed to create game lobby");
            }

            const createdGame = data.game;
            setMenuStep("tx");

            // 2. Perform on-chain stake escrow
            const escrowAddress = requireGameEscrowAddress(createdGame);
            setStatusMessage("Checking USDC allowance...");
            const provider = new ethers.JsonRpcProvider("https://rpc.testnet.arc.network");
            const tokenContract = new ethers.Contract(usdcAddress, [
                "function allowance(address owner, address spender) view returns (uint256)"
            ], provider);
            const allowance = await tokenContract.allowance(userWallet!, escrowAddress);

            if (BigInt(allowance.toString()) < stakeMicros) {
                setStatusMessage("Approving USDC stake...");
                const approveTx = await writeContractAsync({
                    address: usdcAddress,
                    abi: VAULT_TOKEN_ABI,
                    functionName: "approve",
                    args: [escrowAddress, stakeMicros],
                    chainId: ARC_TESTNET_CHAIN_ID,
                });
                setStatusMessage("Waiting for approval confirmation...");
                await provider.waitForTransaction(approveTx, 1, 30_000);
            }

            setStatusMessage("Staking USDC to game escrow...");
            const initialStateHash = ethers.id("rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1");
            const stakeTx = await writeContractAsync({
                address: escrowAddress,
                abi: ESCROW_CONTRACT_ABI,
                functionName: "createGame",
                args: [selectedDmPeer || ethers.ZeroAddress, stakeMicros, initialStateHash],
                chainId: ARC_TESTNET_CHAIN_ID,
            });

            // 3. Confirm deposit with backend
            setStatusMessage("Verifying stake transaction...");
            const verifyRes = await fetch(`/api/user/dms/games/${createdGame.id}/fund-creator`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "x-session-wallet": userWallet!,
                },
                body: JSON.stringify({ txHash: stakeTx }),
            });

            const verifyData = await verifyRes.json();
            if (!verifyRes.ok) {
                throw new Error(verifyData.error || "Referee failed to verify deposit transaction");
            }

            triggerToast("Chess game invite sent successfully!");
            refetchDms();
            refetchUsdc();
            setGamesMenuOpen(false);
        } catch (err: any) {
            console.error("Game creation error:", err);
            setErrorMessage(err.message || "Failed to initialize game.");
            setMenuStep("stake");
        } finally {
            setLoading(false);
            setStatusMessage(null);
        }
    };

    // Submits off-chain chess moves to the backend API
    const handleMoveSquare = async (targetSquare: string) => {
        if (!selectedSquare || !activePlayingGame || isSubmittingMove) return;
        setIsSubmittingMove(true);

        try {
            const res = await fetch(`/api/user/dms/games/${activePlayingGame.id}/move`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "x-session-wallet": userWallet!,
                },
                body: JSON.stringify({
                    from: selectedSquare,
                    to: targetSquare,
                    expectedVersion: activePlayingGame.version,
                }),
            });

            const data = await res.json();
            if (!res.ok) {
                throw new Error(data.error || "Illegal move or network error");
            }

            setActivePlayingGame(data.game);
            setSelectedSquare(null);
            setLegalTargets([]);
            refetchDms();
        } catch (err: any) {
            triggerToast(err.message || "Failed to submit move");
        } finally {
            setIsSubmittingMove(false);
        }
    };

    const handleResign = async () => {
        if (!activePlayingGame || loading) return;
        if (!confirm("Are you sure you want to resign and forfeit the stake?")) return;
        setLoading(true);

        try {
            const res = await fetch(`/api/user/dms/games/${activePlayingGame.id}/resign`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "x-session-wallet": userWallet!,
                },
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || "Resignation failed");
            
            setActivePlayingGame(data.game);
            triggerToast("You resigned from the game.");
            refetchDms();
        } catch (err: any) {
            triggerToast(err.message || "Failed to resign");
        } finally {
            setLoading(false);
        }
    };

    const handleClaimTimeout = async () => {
        if (!activePlayingGame || loading) return;
        setLoading(true);

        try {
            const res = await fetch(`/api/user/dms/games/${activePlayingGame.id}/timeout`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "x-session-wallet": userWallet!,
                },
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || "Timeout claim failed");

            setActivePlayingGame(data.game);
            triggerToast("Timeout claim successful! You won.");
            refetchDms();
        } catch (err: any) {
            triggerToast(err.message || "Failed to claim timeout victory");
        } finally {
            setLoading(false);
        }
    };

    // Claims the escrowed stakes on-chain using the referee signature
    const handleClaimPayout = async () => {
        if (!activePlayingGame || isClaimingPayout) return;
        setIsClaimingPayout(true);

        try {
            const escrowAddress = requireGameEscrowAddress(activePlayingGame);
            // Refetch game details to load the referee signature payload from GET API
            const res = await fetch(`/api/user/dms/games/${activePlayingGame.id}`, {
                headers: { "x-session-wallet": userWallet! }
            });
            const data = await res.json();
            if (!res.ok || !data.game.refereeSignature) {
                throw new Error("Could not retrieve referee signature from server");
            }

            const { signature, finalStateHash, validUntil } = data.game.refereeSignature;
            const draw = data.game.status === "DRAW";
            const winner = data.game.status === "WHITE_WON"
                ? data.game.whiteAddress
                : data.game.status === "BLACK_WON"
                    ? data.game.blackAddress
                    : ethers.ZeroAddress;

            setStatusMessage("Settling contract escrow on-chain...");
            const tx = await writeContractAsync({
                address: escrowAddress,
                abi: ESCROW_CONTRACT_ABI,
                functionName: "settleGame",
                args: [
                    BigInt(activePlayingGame.contractGameId),
                    winner,
                    draw,
                    finalStateHash,
                    BigInt(validUntil),
                    signature
                ],
                chainId: ARC_TESTNET_CHAIN_ID,
            });

            setStatusMessage("Confirming settlement transaction...");
            const provider = new ethers.JsonRpcProvider("https://rpc.testnet.arc.network");
            await provider.waitForTransaction(tx, 1, 30_000);

            // Notify backend to update db status
            await fetch(`/api/user/dms/games/${activePlayingGame.id}/settle`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "x-session-wallet": userWallet!,
                },
                body: JSON.stringify({ txHash: tx }),
            });

            triggerToast("Payout claimed successfully on-chain!");
            setIsChessBoardModalOpen(false);
            refetchDms();
            refetchUsdc();
        } catch (err: any) {
            triggerToast(err.message || "Failed to settle game on-chain");
        } finally {
            setIsClaimingPayout(false);
            setStatusMessage(null);
        }
    };

    // Square select handler on click
    const handleSquareClick = (square: string, piece: { color: string; type: string } | null) => {
        if (!activePlayingGame || activePlayingGame.status !== "ACTIVE") return;

        const isWhite = userWallet?.toLowerCase() === activePlayingGame.whiteAddress?.toLowerCase();
        const isBlack = userWallet?.toLowerCase() === activePlayingGame.blackAddress?.toLowerCase();
        
        // Confirm it is this player's turn
        const isMyTurn = (isWhite && activePlayingGame.currentTurnAddress === activePlayingGame.whiteAddress) ||
                         (isBlack && activePlayingGame.currentTurnAddress === activePlayingGame.blackAddress);
        if (!isMyTurn) return;

        const turnColor = activePlayingGame.currentTurnAddress === activePlayingGame.whiteAddress ? "w" : "b";

        if (selectedSquare === square) {
            setSelectedSquare(null);
            setLegalTargets([]);
        } else if (piece && piece.color === turnColor) {
            // Select piece and load legal moves
            setSelectedSquare(square);
            const targets = activePlayingGame.gameType === "CHECKERS"
                ? getCheckersLegalTargets(activePlayingGame.fen, square)
                : getChessLegalTargets(activePlayingGame.fen, square);
            setLegalTargets(targets as string[]);
        } else if (selectedSquare && legalTargets.includes(square)) {
            // Execute move
            handleMoveSquare(square);
        } else {
            // Deselect
            setSelectedSquare(null);
            setLegalTargets([]);
        }
    };

    // Render Chess Board Squares FEN Array Helper
    const renderChessBoard = () => {
        if (!activePlayingGame) return null;
        
        const position = activePlayingGame.gameType === "CHECKERS"
            ? parseCheckersFen(activePlayingGame.fen)
            : parseChessFen(activePlayingGame.fen);
        const isBlack = userWallet?.toLowerCase() === activePlayingGame.blackAddress?.toLowerCase();

        // 8x8 Grid files/ranks
        const ranks = isBlack ? [0, 1, 2, 3, 4, 5, 6, 7] : [7, 6, 5, 4, 3, 2, 1, 0];
        const files = isBlack ? [7, 6, 5, 4, 3, 2, 1, 0] : [0, 1, 2, 3, 4, 5, 6, 7];
        const fileLetters = ["a", "b", "c", "d", "e", "f", "g", "h"];

        const squares = [];
        for (const rank of ranks) {
            for (const file of files) {
                const squareName = fileLetters[file] + (rank + 1);
                const isDark = (rank + file) % 2 === 0;
                
                // Index is rank * 8 + file in standard array format
                const piece = position.board[rank * 8 + file];
                const isSelected = selectedSquare === squareName;
                const isLegalTarget = legalTargets.includes(squareName);

                squares.push(
                    <button
                        key={squareName}
                        type="button"
                        onClick={() => handleSquareClick(squareName, piece)}
                        className={`relative aspect-square flex items-center justify-center transition-all ${
                            isDark ? "bg-[#18181b]" : "bg-[#27272a]"
                        } ${
                            isSelected ? "ring-2 ring-inset ring-[#FFD825] bg-[#FFD825]/10" : ""
                        } ${
                            isLegalTarget ? "after:content-[''] after:absolute after:w-3.5 after:h-3.5 after:rounded-full after:bg-[#FFD825]/60 hover:bg-[#FFD825]/15" : ""
                        }`}
                    >
                        {/* Render piece */}
                        {piece && (
                            <span 
                                className={`text-4xl select-none leading-none z-10 ${
                                    piece.color === "w" 
                                        ? "text-white drop-shadow-[0_0_6px_rgba(255,255,255,0.4)]" 
                                        : "text-[#00b2ff] drop-shadow-[0_0_6px_rgba(0,178,255,0.5)]"
                                }`}
                            >
                                {UNICODE_PIECES[
                                    activePlayingGame.gameType === "CHECKERS"
                                        ? `${piece.color}-c${piece.type}`
                                        : `${piece.color}-${piece.type}`
                                ]}
                            </span>
                        )}
                        
                        {/* Display cell coordinates (small guides) */}
                        {file === (isBlack ? 7 : 0) && (
                            <span className="absolute top-1 left-1.5 text-[8px] font-bold text-white/20 select-none">
                                {rank + 1}
                            </span>
                        )}
                        {rank === (isBlack ? 7 : 0) && (
                            <span className="absolute bottom-0.5 right-1.5 text-[8px] font-bold text-white/20 select-none">
                                {fileLetters[file]}
                            </span>
                        )}
                    </button>
                );
            }
        }

        return <div className="grid grid-cols-8 border border-white/10 rounded-2xl overflow-hidden shadow-2xl bg-black/40">{squares}</div>;
    };

    if (!isChessBoardModalOpen || !activePlayingGame) return null;

    const boardContent = (
        <>
            {/* Header */}
            <div className="flex items-center justify-between border-b border-white/5 pb-3.5">
                <div className="flex items-center gap-2">
                    <span className="text-2xl">{activePlayingGame.gameType === "CHECKERS" ? "⛀" : "♞"}</span>
                    <div>
                        <h3 className="text-xs font-black uppercase tracking-widest text-[#FFD825]">
                            {activePlayingGame.gameType === "CHECKERS" ? "Checkers Match" : "Chess Match"}
                        </h3>
                        <p className="text-[10px] text-white/40 font-bold uppercase tracking-wider">
                            Stake: ${(Number(activePlayingGame.stakePerPlayerUsdc) / 1000000).toFixed(2)} USDC
                        </p>
                    </div>
                </div>
                <button 
                    type="button" 
                    onClick={() => setIsChessBoardModalOpen(false)} 
                    className="flex h-8 w-8 items-center justify-center rounded-full bg-white/5 text-white/60 hover:bg-white/10 transition-all"
                >
                    <X className="h-4 w-4" />
                </button>
            </div>

            {/* Game Info Panel */}
            <div className="rounded-2xl border border-white/5 bg-white/[0.02] p-3 flex justify-between items-center text-[10px] uppercase font-black tracking-wider">
                <div className="space-y-1">
                    <div className="flex items-center gap-1.5">
                        <span className="w-2.5 h-2.5 rounded-full bg-white inline-block border border-white/20"></span>
                        <span className="text-white/80">{formatWallet(activePlayingGame.whiteAddress)}</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                        <span className="w-2.5 h-2.5 rounded-full bg-[#00b2ff] inline-block"></span>
                        <span className="text-white/80">{formatWallet(activePlayingGame.blackAddress)}</span>
                    </div>
                </div>

                <div className="text-right space-y-1 border-l border-white/5 pl-4 shrink-0">
                    {activePlayingGame.status === "ACTIVE" ? (
                        <>
                            <span className="text-white/45 block text-[8px]">Time Remaining</span>
                            <span className="text-white font-mono flex items-center gap-1 text-[11px]">
                                <Clock className="w-3.5 h-3.5 text-[#FFD825]" />
                                {liveTimeLeft || "24:00:00"}
                            </span>
                        </>
                    ) : (
                        <>
                            <span className="text-white/45 block text-[8px]">Status</span>
                            <span className="text-[#FFD825] font-black">
                                {activePlayingGame.status.replace(/_/g, " ")}
                            </span>
                        </>
                    )}
                </div>
            </div>

            {/* Chess Board Grid */}
            <div className="relative">
                {renderChessBoard()}
                
                {/* Overlay for Game Statuses */}
                {activePlayingGame.status !== "ACTIVE" && (
                    <div className="absolute inset-0 bg-black/80 backdrop-blur-sm rounded-2xl flex flex-col items-center justify-center text-center p-6 space-y-3 z-35 border border-white/5">
                        <Trophy className="w-10 h-10 text-[#FFD825] animate-bounce" />
                        <div className="space-y-1">
                            <h4 className="text-sm font-black uppercase text-white tracking-widest">Match Concluded</h4>
                            <p className="text-[10px] text-white/55 leading-relaxed uppercase tracking-wider">
                                {activePlayingGame.winnerAddress 
                                    ? `Winner: ${formatWallet(activePlayingGame.winnerAddress)} (${activePlayingGame.resultReason})`
                                    : `Draw match (${activePlayingGame.resultReason})`
                                }
                            </p>
                        </div>

                        {/* Claim Button */}
                        {activePlayingGame.mode === "testnet" && activePlayingGame.settlementStatus === "AWAITING_SETTLEMENT" && (
                            <button
                                onClick={handleClaimPayout}
                                disabled={isClaimingPayout}
                                className="relative flex w-44 items-center justify-center gap-2 overflow-hidden rounded-full bg-[#FFD825] py-2.5 text-center text-[10px] font-black uppercase tracking-[0.16em] text-black hover:opacity-90 transition-all shadow-[0_8px_32px_rgba(255,216,37,0.15)] mt-3"
                            >
                                {isClaimingPayout ? (
                                    <Loader2 className="w-4 h-4 animate-spin" />
                                ) : (
                                    <span>Claim Payout</span>
                                )}
                            </button>
                        )}

                        {activePlayingGame.settlementStatus === "SETTLED" && (
                            <div className="flex items-center gap-1.5 text-[#FFD825] text-[10px] font-black uppercase tracking-widest mt-2">
                                <CheckCircle2 className="w-4 h-4" />
                                <span>Settled On-Chain</span>
                            </div>
                        )}
                    </div>
                )}
            </div>

            {/* Live Turn indicator or transaction verification overlay */}
            {statusMessage ? (
                <div className="rounded-2xl border border-[#FFD825]/10 bg-[#FFD825]/[0.02] p-4 flex items-center justify-center gap-3">
                    <Loader2 className="w-4 h-4 animate-spin text-[#FFD825] shrink-0" />
                    <span className="text-[10px] font-black uppercase tracking-widest text-white/80">{statusMessage}</span>
                </div>
            ) : activePlayingGame.status === "ACTIVE" ? (
                <div className="flex items-center justify-between border-t border-white/5 pt-4">
                    <div className="text-[10px] uppercase font-black tracking-wider">
                        {activePlayingGame.currentTurnAddress?.toLowerCase() === userWallet?.toLowerCase() ? (
                            <span className="text-[#FFD825] animate-pulse">● Your Turn</span>
                        ) : (
                            <span className="text-white/45">○ Opponent Turn</span>
                        )}
                    </div>

                    <div className="flex gap-2">
                        {/* Timeout victory check */}
                        {new Date(activePlayingGame.expiresAt).getTime() <= Date.now() && 
                         activePlayingGame.currentTurnAddress?.toLowerCase() !== userWallet?.toLowerCase() && (
                            <button
                                type="button"
                                onClick={handleClaimTimeout}
                                className="rounded-full border border-red-500/30 bg-red-950/15 hover:bg-red-950/30 px-4 py-2 text-[9px] font-black uppercase tracking-wider text-red-400"
                            >
                                Claim Timeout Win
                            </button>
                         )}

                        <button
                            type="button"
                            onClick={handleResign}
                            className="rounded-full border border-white/10 bg-white/[0.03] hover:bg-white/[0.06] px-4 py-2 text-[9px] font-black uppercase tracking-wider text-white/60"
                        >
                            Resign
                        </button>
                    </div>
                </div>
            ) : null}
        </>
    );

    if (inline) {
        return (
            <div className="w-full h-full flex flex-col justify-between text-left space-y-5">
                {boardContent}
            </div>
        );
    }

    return (
        <AnimatePresence>
            <motion.div 
                initial={{ opacity: 0 }} 
                animate={{ opacity: 1 }} 
                exit={{ opacity: 0 }} 
                className="md:hidden fixed inset-0 z-[60] flex flex-col bg-[#060608] p-4 sm:p-6 justify-between overflow-y-auto"
            >
                <motion.div 
                    initial={{ scale: 0.95, y: 15 }} 
                    animate={{ scale: 1, y: 0 }} 
                    exit={{ scale: 0.95, y: 15 }} 
                    className="w-full max-w-md mx-auto flex flex-col justify-between h-full min-h-0 space-y-5"
                >
                    {boardContent}
                </motion.div>
            </motion.div>
        </AnimatePresence>
    );
}
