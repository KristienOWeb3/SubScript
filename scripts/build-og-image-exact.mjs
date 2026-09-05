import fs from "fs";
import sharp from "sharp";

async function main() {
    console.log("Loading original OG image and new background...");
    const { data: origData, info } = await sharp("public/og-original.png")
        .raw()
        .toBuffer({ resolveWithObject: true });

    const userBg = "public/email/banners/subscript-bg.png";
    const bg1200x630 = await sharp(userBg)
        .resize(1200, 630, { fit: "cover" })
        .raw()
        .toBuffer({ resolveWithObject: true });

    const bgData = bg1200x630.data;

    // Precompute background R channel at x=70 for the left bracket region
    const bgRAtY = [];
    for (let y = 0; y < 630; y++) {
        const idx = (y * 1200 + 70) * 4;
        bgRAtY.push(origData[idx]);
    }

    const outBuf = Buffer.alloc(1200 * 630 * 4);

    for (let y = 0; y < 630; y++) {
        for (let x = 0; x < 1200; x++) {
            const idx = (y * 1200 + x) * 4;
            const r = origData[idx];
            const g = origData[idx + 1];
            const b = origData[idx + 2];

            // Determine if pixel belongs to a foreground region:
            // 1. SubScript: y in [200, 250], x in [480, 720]
            // 2. EVERYTHING PAYMENT: y in [265, 350], x in [80, 1120]
            // 3. Right bracket: y in [140, 220], x >= 1150
            // 4. Left bracket: y in [370, 460], x <= 65

            let alpha = 0;
            let fgR = 191;
            let fgG = 199;
            let fgB = 198;

            if (y >= 200 && y <= 250 && x >= 480 && x <= 720) {
                // SubScript text (pure white #FFFFFF)
                fgR = 255;
                fgG = 255;
                fgB = 255;
                alpha = Math.min(1, Math.max(0, r / 255));
            } else if (y >= 265 && y <= 350 && x >= 80 && x <= 1120) {
                // EVERYTHING PAYMENT (original font text, solid fill #BFCCC6 = 191, 199, 198)
                fgR = 191;
                fgG = 199;
                fgB = 198;
                alpha = Math.min(1, Math.max(0, r / 191));
            } else if (y >= 140 && y <= 220 && x >= 1150) {
                // Right bracket (semi-transparent bracket)
                fgR = 191;
                fgG = 199;
                fgB = 198;
                alpha = Math.min(1, Math.max(0, r / 161));
            } else if (y >= 370 && y <= 460 && x <= 65) {
                // Left bracket
                const baseR = bgRAtY[y];
                fgR = 191;
                fgG = 199;
                fgB = 198;
                if (r > baseR) {
                    alpha = Math.min(1, Math.max(0, (r - baseR) / (163 - baseR)));
                }
            }

            if (alpha <= 0) {
                // Pure new background pixel
                outBuf[idx] = bgData[idx];
                outBuf[idx + 1] = bgData[idx + 1];
                outBuf[idx + 2] = bgData[idx + 2];
                outBuf[idx + 3] = 255;
            } else {
                // Perfect mathematical linear blend of original foreground over new background
                outBuf[idx] = Math.round(alpha * fgR + (1 - alpha) * bgData[idx]);
                outBuf[idx + 1] = Math.round(alpha * fgG + (1 - alpha) * bgData[idx + 1]);
                outBuf[idx + 2] = Math.round(alpha * fgB + (1 - alpha) * bgData[idx + 2]);
                outBuf[idx + 3] = 255;
            }
        }
    }

    await sharp(outBuf, { raw: { width: 1200, height: 630, channels: 4 } })
        .png({ quality: 100 })
        .toFile("public/og.png");

    console.log("Successfully generated public/og.png with EXACT original typography!");
}

main().catch(console.error);
