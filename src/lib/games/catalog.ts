export type GameSlug =
    | "chess"
    | "checkers"
    | "connect-four"
    | "battleship"
    | "backgammon"
    | "tic-tac-toe";

export type GameCatalogItem = {
    slug: GameSlug;
    name: string;
    symbol: string;
    status: "PLAYABLE" | "COMING_SOON";
    description: string;
};

export const GAME_CATALOG: readonly GameCatalogItem[] = [
    {
        slug: "chess",
        name: "Chess",
        symbol: "♞",
        status: "PLAYABLE",
        description: "Outplay your opponent before the fixed 24-hour deadline.",
    },
    {
        slug: "checkers",
        name: "Checkers",
        symbol: "⛀",
        status: "COMING_SOON",
        description: "Classic diagonal strategy.",
    },
    {
        slug: "connect-four",
        name: "Connect Four",
        symbol: "◉",
        status: "COMING_SOON",
        description: "Four in a row wins.",
    },
    {
        slug: "battleship",
        name: "Battleship",
        symbol: "⚓",
        status: "COMING_SOON",
        description: "Find and sink the fleet.",
    },
    {
        slug: "backgammon",
        name: "Backgammon",
        symbol: "⚄",
        status: "COMING_SOON",
        description: "Race every checker home.",
    },
    {
        slug: "tic-tac-toe",
        name: "Tic-Tac-Toe",
        symbol: "✕",
        status: "COMING_SOON",
        description: "Small board, sharp decisions.",
    },
] as const;

export const PLAYABLE_GAME = GAME_CATALOG[0];

