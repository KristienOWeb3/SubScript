"use client";

import { useState, useEffect } from "react";
import { useAccount, useConnect, useSwitchChain, useWriteContract, useBalance } from "wagmi";
import { ethers } from "ethers";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { 
    ARC_TESTNET_CHAIN_ID, 
    USDC_NATIVE_GAS_ADDRESS 
} from "@/lib/contracts/constants";
import { 
    Award, 
    CheckCircle2, 
    AlertCircle, 
    Loader2, 
    Wallet, 
    GamepadIcon 
} from "@/components/icons";

interface GameProps {
    game: {
        id: string;
        creatorAddress: string;
        opponentAddress: string | null;
        contractGameId: string | null;
        stakePerPlayerUsdc: string;
        status: string;
        settlementStatus: string;
    };
}

const VAULT_TOKEN_ABI = [
    { type: "function", name: "allowance", stateMutability: "view", inputs: [{ name: "owner", type: "address" }, { name: "spender", type: "address" }], outputs: [{ name: "", type: "uint256" }] },
    { type: "function", name: "approve", stateMutability: "nonpayable", inputs: [{ name: "spender", type: "address" }, { name: "amount", type: "uint256" }], outputs: [{ name: "", type: "bool" }] },
] as const;

const ESCROW_CONTRACT_ABI = [
    { type: "function", name: "joinGame", stateMutability: "nonpayable", inputs: [{ name: "gameId", type: "uint256" }], outputs: [] },
] as const;

export default function GameInviteClient({ game }: GameProps) {
    const router = useRouter();
    const { address, isConnected, chainId } = useAccount();
    const { connect, connectors } = useConnect();
    const { switchChainAsync } = useSwitchChain();
    const { writeContractAsync } = useWriteContract();

    const [isCheckingAllowance, setIsCheckingAllowance] = useState(false);
    const [allowance, setAllowance] = useState<bigint>(BigInt(0));
    const [actionLoading, setActionLoading] = useState(false);
    const [statusMessage, setStatusMessage] = useState<string | null>(null);
    const [errorMessage, setErrorMessage] = useState<string | null>(null);
    const [step, setStep] = useState<"ready" | "success">("ready");

    const escrowAddress = (process.env.NEXT_PUBLIC_DM_GAME_ESCROW_ADDRESS || "0xCFc7Db58d256688Bea3dE0a063d0bCF9137a237D") as `0x${string}`;
    const usdcAddress = USDC_NATIVE_GAS_ADDRESS as `0x${string}`;
    const stakeAmount = BigInt(game.stakePerPlayerUsdc);
    const stakeAmountUsdc = Number(stakeAmount) / 1_000_000;

    const { data: usdcBalance, refetch: refetchUsdc } = useBalance({
        address: address,
        token: usdcAddress,
        chainId: ARC_TESTNET_CHAIN_ID,
    });

    // Check allowance on network/address changes
    useEffect(() => {
        if (!isConnected || !address || chainId !== ARC_TESTNET_CHAIN_ID) return;

        const checkAllowance = async () => {
            setIsCheckingAllowance(true);
            try {
                const provider = new ethers.JsonRpcProvider("https://rpc.testnet.arc.network");
                const tokenContract = new ethers.Contract(usdcAddress, [
                    "function allowance(address owner, address spender) view returns (uint256)"
                ], provider);
                const currentAllowance = await tokenContract.allowance(address, escrowAddress);
                setAllowance(BigInt(currentAllowance.toString()));
            } catch (err) {
                console.error("Failed to check allowance:", err);
            } finally {
                setIsCheckingAllowance(false);
            }
        };

        checkAllowance();
    }, [address, isConnected, chainId, escrowAddress, usdcAddress]);

    const handleConnect = () => {
        const injected = connectors.find((c) => c.id === "injected" || c.name.toLowerCase().includes("metamask"));
        const target = injected || connectors[0];
        if (target) {
            connect({ connector: target });
        }
    };

    const handleJoinGame = async () => {
        setErrorMessage(null);
        setStatusMessage(null);
        setActionLoading(true);

        try {
            // 1. Check network
            if (chainId !== ARC_TESTNET_CHAIN_ID) {
                setStatusMessage("Switching chain to Arc Testnet...");
                await switchChainAsync({ chainId: ARC_TESTNET_CHAIN_ID });
            }

            // 2. Double check balance
            if (usdcBalance && usdcBalance.value < stakeAmount) {
                throw new Error(`Insufficient USDC balance. You need at least ${stakeAmountUsdc} USDC.`);
            }

            // 3. Approve USDC if necessary
            if (allowance < stakeAmount) {
                setStatusMessage("Approving USDC stake...");
                const approveTx = await writeContractAsync({
                    address: usdcAddress,
                    abi: VAULT_TOKEN_ABI,
                    functionName: "approve",
                    args: [escrowAddress, stakeAmount],
                    chainId: ARC_TESTNET_CHAIN_ID,
                });
                
                setStatusMessage("Waiting for approval confirmation...");
                const provider = new ethers.JsonRpcProvider("https://rpc.testnet.arc.network");
                await provider.waitForTransaction(approveTx, 1, 30_000);
                setAllowance(stakeAmount);
            }

            // 4. Join game on-chain
            if (!game.contractGameId) {
                throw new Error("This game is not initialized on-chain by the host yet.");
            }

            setStatusMessage("Staking and joining game on-chain...");
            const joinTx = await writeContractAsync({
                address: escrowAddress,
                abi: ESCROW_CONTRACT_ABI,
                functionName: "joinGame",
                args: [BigInt(game.contractGameId)],
                chainId: ARC_TESTNET_CHAIN_ID,
            });

            // 5. Submit transaction hash to backend
            setStatusMessage("Verifying stake transaction with referee...");
            const res = await fetch(`/api/user/dms/games/${game.id}/accept`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "x-session-wallet": address!,
                },
                body: JSON.stringify({ txHash: joinTx }),
            });

            const data = await res.json();
            if (!res.ok) {
                throw new Error(data.error || "Failed to join game on the backend");
            }

            // 6. Complete
            refetchUsdc();
            setStep("success");
        } catch (err: any) {
            console.error("Game accept error:", err);
            setErrorMessage(err.message || "An unexpected error occurred during staking.");
        } finally {
            setActionLoading(false);
            setStatusMessage(null);
        }
    };

    if (step === "success") {
        return (
            <motion.div 
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                className="liquid-glass border border-[#ccff00]/20 bg-black/40 backdrop-blur-xl rounded-3xl p-8 max-w-md w-full text-center space-y-6 shadow-2xl"
            >
                <div className="mx-auto w-16 h-16 bg-[#ccff00]/10 border border-[#ccff00]/20 rounded-full flex items-center justify-center text-[#ccff00]">
                    <CheckCircle2 className="w-8 h-8" />
                </div>
                <div className="space-y-2">
                    <h2 className="text-xl font-black uppercase tracking-wider text-white">Challenge Accepted!</h2>
                    <p className="text-xs text-white/60 leading-relaxed">
                        Your stake is deposited. The Chess board is active and the 24-hour timer has started!
                    </p>
                </div>
                <button
                    onClick={() => router.push(`/dashboard/user?tab=inbox&chat=${game.creatorAddress.toLowerCase()}`)}
                    className="relative flex w-full items-center justify-center gap-2 overflow-hidden rounded-full bg-[#ccff00] py-3.5 text-center text-xs font-black uppercase tracking-[0.16em] text-black hover:opacity-90 transition-all shadow-[0_8px_32px_0_rgba(204,255,0,0.2)]"
                >
                    Open Game Board
                </button>
            </motion.div>
        );
    }

    return (
        <motion.div 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="liquid-glass border border-white/5 bg-black/40 backdrop-blur-xl rounded-3xl p-6 sm:p-8 max-w-md w-full space-y-6 shadow-2xl"
        >
            <div className="flex items-center gap-3 border-b border-white/5 pb-4">
                <div className="w-10 h-10 rounded-2xl bg-white/5 border border-white/10 flex items-center justify-center text-[#ccff00]">
                    <GamepadIcon className="w-5 h-5" />
                </div>
                <div>
                    <h2 className="text-xs font-black uppercase tracking-widest text-white/45">CHESS CHALLENGE</h2>
                    <h1 className="text-sm font-black uppercase tracking-wider text-white">Join Stake Match</h1>
                </div>
            </div>

            <div className="rounded-2xl border border-white/5 bg-black/30 p-4 space-y-4">
                <div className="grid grid-cols-2 gap-4">
                    <div>
                        <span className="block text-[8px] font-black uppercase tracking-widest text-white/40 mb-0.5">Game Host</span>
                        <span className="block text-xs font-mono font-bold text-white truncate">
                            {game.creatorAddress}
                        </span>
                    </div>
                    <div>
                        <span className="block text-[8px] font-black uppercase tracking-widest text-white/40 mb-0.5">Stake Pot</span>
                        <span className="block text-xs font-black text-[#ccff00]">
                            ${(stakeAmountUsdc * 2).toFixed(2)} USDC
                        </span>
                    </div>
                </div>

                <div className="border-t border-white/5 pt-3 flex justify-between text-[10px] text-white/45 font-bold uppercase tracking-wider">
                    <span>Your Stake: ${(stakeAmountUsdc).toFixed(2)}</span>
                    <span>Treasury: 10%</span>
                </div>
            </div>

            <div className="rounded-2xl border border-[#ccff00]/10 bg-[#ccff00]/[0.02] p-4 flex gap-3">
                <Award className="w-5 h-5 text-[#ccff00] shrink-0 mt-0.5" />
                <div className="text-[10px] leading-relaxed text-white/60 font-bold uppercase tracking-wider">
                    <p className="text-white font-black mb-0.5">Pot Settlement Rules:</p>
                    Winner claims 90% of the total stakes. The remaining 10% is routed to the SubScript Treasury. Max game limit is 24 hours.
                </div>
            </div>

            {errorMessage && (
                <div className="rounded-2xl border border-red-500/20 bg-red-500/5 px-4 py-3 flex gap-2 text-[10px] font-black uppercase tracking-[0.14em] text-red-300">
                    <AlertCircle className="w-4 h-4 shrink-0" />
                    <span>{errorMessage}</span>
                </div>
            )}

            {!isConnected ? (
                <button
                    onClick={handleConnect}
                    className="relative flex w-full items-center justify-center gap-2 overflow-hidden rounded-full bg-white py-3.5 text-center text-xs font-black uppercase tracking-[0.16em] text-black hover:opacity-95 transition-all"
                >
                    <Wallet className="w-4 h-4" />
                    Connect Wallet
                </button>
            ) : chainId !== ARC_TESTNET_CHAIN_ID ? (
                <button
                    onClick={async () => {
                        setActionLoading(true);
                        try {
                            await switchChainAsync({ chainId: ARC_TESTNET_CHAIN_ID });
                        } catch (err: any) {
                            setErrorMessage(err.message || "Failed to switch networks");
                        } finally {
                            setActionLoading(false);
                        }
                    }}
                    disabled={actionLoading}
                    className="relative flex w-full items-center justify-center gap-2 overflow-hidden rounded-full bg-red-600 py-3.5 text-center text-xs font-black uppercase tracking-[0.16em] text-white hover:bg-red-700 transition-all"
                >
                    {actionLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                    Switch to Arc Testnet
                </button>
            ) : (
                <button
                    onClick={handleJoinGame}
                    disabled={actionLoading || isCheckingAllowance}
                    className="relative flex w-full items-center justify-center gap-2 overflow-hidden rounded-full bg-[#ccff00] py-3.5 text-center text-xs font-black uppercase tracking-[0.16em] text-black hover:opacity-90 disabled:opacity-50 transition-all shadow-[0_8px_32px_0_rgba(204,255,0,0.2)]"
                >
                    {actionLoading || isCheckingAllowance ? (
                        <>
                            <Loader2 className="w-4 h-4 animate-spin" />
                            <span>{statusMessage || "Processing..."}</span>
                        </>
                    ) : (
                        <span>
                            {allowance < stakeAmount ? "Approve & Deposit Stake" : "Join Game & Stake"}
                        </span>
                    )}
                </button>
            )}
        </motion.div>
    );
}
