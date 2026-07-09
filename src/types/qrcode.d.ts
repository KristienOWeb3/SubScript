/* Minimal type shim for the `qrcode` core generator (no @types package installed).
   Only the surface our rounded renderer uses. */
declare module "qrcode" {
    export interface QRBitMatrix {
        readonly size: number;
        get(row: number, col: number): number;
    }
    export interface QRCodeData {
        modules: QRBitMatrix;
    }
    export interface QRCodeCreateOptions {
        errorCorrectionLevel?: "L" | "M" | "Q" | "H" | "low" | "medium" | "quartile" | "high";
        version?: number;
        maskPattern?: number;
    }
    export function create(text: string, options?: QRCodeCreateOptions): QRCodeData;
    const _default: { create: typeof create };
    export default _default;
}
