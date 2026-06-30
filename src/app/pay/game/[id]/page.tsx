import { Metadata } from "next";
import { prisma } from "@/lib/prisma";
import GameInviteClient from "./GameInviteClient";
import { notFound } from "next/navigation";

type Props = {
    params: Promise<{ id: string }>;
};

// Generates dynamic Open Graph tags for game invite links (Twitter/Telegram/iMessage preview)
export async function generateMetadata({ params }: Props): Promise<Metadata> {
    const { id } = await params;
    try {
        const game = await prisma.dmGame.findUnique({
            where: { id },
        });

        if (!game) {
            return {
                title: "Game Not Found - SubScript Games",
                description: "This game invite does not exist or has expired.",
            };
        }

        const stake = (Number(game.stakePerPlayerUsdc) / 1_000_000).toLocaleString("en-US", {
            style: "currency",
            currency: "USD",
        });

        return {
            title: `Play Chess on SubScript`,
            description: `You are invited to play chess, the stakes are ${stake}, winner takes home more!`,
            openGraph: {
                title: "Play Chess on SubScript",
                description: `You are invited to play chess, the stakes are ${stake}, winner takes home more!`,
                images: [
                    {
                        url: "/chess-og.png",
                        width: 1200,
                        height: 630,
                        alt: "SubScript Chess stakes game",
                    },
                ],
            },
            twitter: {
                card: "summary_large_image",
                title: "Play Chess on SubScript",
                description: `You are invited to play chess, the stakes are ${stake}, winner takes home more!`,
                images: ["/chess-og.png"],
            },
        };
    } catch (err) {
        return {
            title: "Play Chess on SubScript",
            description: "Join the game, stake USDC on-chain, and win the pot!",
        };
    }
}

export default async function Page({ params }: Props) {
    const { id } = await params;
    const game = await prisma.dmGame.findUnique({
        where: { id },
    });

    if (!game) {
        notFound();
    }

    // Convert fields for client serialization
    const serializedGame = {
        id: game.id,
        creatorAddress: game.creatorAddress,
        opponentAddress: game.opponentAddress,
        contractGameId: game.contractGameId,
        stakePerPlayerUsdc: game.stakePerPlayerUsdc.toString(),
        status: game.status,
        settlementStatus: game.settlementStatus,
    };

    return (
        <main className="min-h-screen bg-[#060608] text-white flex items-center justify-center p-4">
            <GameInviteClient game={serializedGame} />
        </main>
    );
}
