import QRCode from "qrcode";

/* Shared QR matrix used by both the SVG (display) and canvas (export) rounded renderers,
   so an on-screen QR and its downloaded image are pixel-consistent. */
export type QrMatrix = {
    count: number;
    dark: (r: number, c: number) => boolean;
    inFinder: (r: number, c: number) => boolean;
};

export function createQrMatrix(value: string, level: "L" | "M" | "Q" | "H" = "H"): QrMatrix {
    const qr = QRCode.create(value && value.length ? value : " ", { errorCorrectionLevel: level });
    const count: number = qr.modules.size;
    const dark = (r: number, c: number) =>
        r >= 0 && c >= 0 && r < count && c < count ? Boolean(qr.modules.get(r, c)) : false;
    /* The three 7x7 position-detection patterns (top-left, top-right, bottom-left). Rendered
       as rounded frames rather than dots so scanners still lock on reliably. */
    const inFinder = (r: number, c: number) =>
        (r < 7 && c < 7) || (r < 7 && c >= count - 7) || (r >= count - 7 && c < 7);
    return { count, dark, inFinder };
}

/* Central logo excavation region (module bounds), or null when no logo. */
export function excavateBounds(
    count: number,
    marginModules: number,
    logoModules: number,
): { r0: number; r1: number; c0: number; c1: number } | null {
    if (logoModules <= 0) return null;
    const total = count + marginModules * 2;
    const center = total / 2;
    const half = logoModules / 2 + 0.5; // +0.5 module of breathing room
    return {
        r0: Math.floor(center - half) - marginModules,
        r1: Math.ceil(center + half) - marginModules,
        c0: Math.floor(center - half) - marginModules,
        c1: Math.ceil(center + half) - marginModules,
    };
}
