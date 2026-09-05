import fs from "fs";
import path from "path";
import sharp from "sharp";

const width = 1200;
const height = 400;
const userBgSrc = "C:/Users/Kristien/.gemini/antigravity/brain/e51b14f6-0fe1-4520-8fa8-fc69d13671a1/.user_uploaded/media_1788617993630.png";
const bannersDir = path.join("public", "email", "banners");

if (!fs.existsSync(bannersDir)) {
    fs.mkdirSync(bannersDir, { recursive: true });
}

// 1. Copy user background to public directory
fs.copyFileSync(userBgSrc, path.join(bannersDir, "subscript-bg.png"));

// 2. Ethereum Emblem SVG on transparent canvas
function buildEthereumSvg() {
    const scale = 255 / 1277.39;
    const offsetX = 600 - (784.37 * scale) / 2;
    const offsetY = 195 - (1277.39 * scale) / 2;

    return `
    <svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
      <defs>
        <!-- Chrome & Platinum Metallic Shading -->
        <linearGradient id="topLt" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="#ffffff" />
          <stop offset="25%" stop-color="#f1f5f9" />
          <stop offset="60%" stop-color="#cbd5e1" />
          <stop offset="100%" stop-color="#94a3b8" />
        </linearGradient>

        <linearGradient id="topRt" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="#94a3b8" />
          <stop offset="45%" stop-color="#475569" />
          <stop offset="100%" stop-color="#1e293b" />
        </linearGradient>

        <linearGradient id="midLt" x1="0%" y1="100%" x2="100%" y2="0%">
          <stop offset="0%" stop-color="#64748b" />
          <stop offset="45%" stop-color="#94a3b8" />
          <stop offset="100%" stop-color="#f8fafc" />
        </linearGradient>

        <linearGradient id="midRt" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="#334155" />
          <stop offset="55%" stop-color="#1e293b" />
          <stop offset="100%" stop-color="#0f172a" />
        </linearGradient>

        <linearGradient id="botLt" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="#cbd5e1" />
          <stop offset="50%" stop-color="#64748b" />
          <stop offset="100%" stop-color="#334155" />
        </linearGradient>

        <linearGradient id="botRt" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="#334155" />
          <stop offset="55%" stop-color="#1e293b" />
          <stop offset="100%" stop-color="#090e17" />
        </linearGradient>

        <!-- Specular Highlight Edge -->
        <linearGradient id="rim" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="#ffffff" stop-opacity="0.95" />
          <stop offset="50%" stop-color="#cbd5e1" stop-opacity="0.5" />
          <stop offset="100%" stop-color="#475569" stop-opacity="0.1" />
        </linearGradient>

        <filter id="ethShadow" x="-30%" y="-30%" width="160%" height="160%">
          <feDropShadow dx="0" dy="16" stdDeviation="18" flood-color="#09111c" flood-opacity="0.75" />
          <feDropShadow dx="0" dy="4" stdDeviation="6" flood-color="#000000" flood-opacity="0.35" />
        </filter>
        <filter id="floorShadow" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="16" />
        </filter>
      </defs>

      <!-- Soft Ambient Glow & Floor Occlusion Shadow -->
      <ellipse cx="600" cy="350" rx="140" ry="18" fill="rgba(15, 23, 42, 0.45)" filter="url(#floorShadow)" />
      <ellipse cx="600" cy="350" rx="80" ry="8" fill="rgba(255, 255, 255, 0.3)" filter="url(#floorShadow)" />

      <!-- Ethereum 3D Monolith -->
      <g transform="translate(${offsetX}, ${offsetY}) scale(${scale})" filter="url(#ethShadow)">
        <polygon points="392.07,0 383.5,29.11 383.5,873.74 392.07,882.29 784.13,650.54" fill="url(#topRt)" stroke="url(#rim)" stroke-width="1.5" />
        <polygon points="392.07,0 0,650.54 392.07,882.29 392.07,472.33" fill="url(#topLt)" stroke="url(#rim)" stroke-width="2" />
        <polygon points="0,650.54 392.07,882.29 392.07,472.33" fill="url(#midLt)" opacity="0.95" />
        <polygon points="392.07,882.29 784.13,650.54 392.07,472.33" fill="url(#midRt)" opacity="0.95" />
        <polygon points="392.07,1277.38 392.07,956.52 0,724.89" fill="url(#botLt)" stroke="url(#rim)" stroke-width="1.5" />
        <polygon points="392.07,956.52 387.24,962.41 387.24,1263.28 392.07,1277.38 784.37,724.89" fill="url(#botRt)" stroke="rgba(255,255,255,0.2)" stroke-width="1" />
      </g>
    </svg>
    `;
}

// 3. Solana Emblem SVG
function buildSolanaSvg() {
    const scale = 220 / 311.7;
    const offsetX = 600 - (397.7 * scale) / 2;
    const offsetY = 200 - (311.7 * scale) / 2;

    return `
    <svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
      <defs>
        <linearGradient id="solGrad1" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stop-color="#00FFA3" />
          <stop offset="50%" stop-color="#14F195" />
          <stop offset="100%" stop-color="#DC1FFF" />
        </linearGradient>

        <linearGradient id="solGrad2" x1="100%" y1="0%" x2="0%" y2="0%">
          <stop offset="0%" stop-color="#DC1FFF" />
          <stop offset="50%" stop-color="#14F195" />
          <stop offset="100%" stop-color="#00FFA3" />
        </linearGradient>

        <linearGradient id="solRim" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="#ffffff" stop-opacity="0.95" />
          <stop offset="50%" stop-color="#00FFA3" stop-opacity="0.5" />
          <stop offset="100%" stop-color="#DC1FFF" stop-opacity="0.3" />
        </linearGradient>

        <filter id="solShadow" x="-30%" y="-30%" width="160%" height="160%">
          <feDropShadow dx="0" dy="14" stdDeviation="16" flood-color="#09111c" flood-opacity="0.7" />
          <feDropShadow dx="0" dy="2" stdDeviation="6" flood-color="#000000" flood-opacity="0.3" />
        </filter>
        <filter id="floorShadow" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="16" />
        </filter>
      </defs>

      <ellipse cx="600" cy="345" rx="145" ry="16" fill="rgba(15, 23, 42, 0.45)" filter="url(#floorShadow)" />
      <ellipse cx="600" cy="345" rx="85" ry="8" fill="rgba(255, 255, 255, 0.3)" filter="url(#floorShadow)" />

      <g transform="translate(${offsetX}, ${offsetY}) scale(${scale})" filter="url(#solShadow)">
        <path d="M64.6,237.9c2.4-2.4,5.7-3.8,9.2-3.8h317.4c5.8,0,8.7,7,4.6,11.1l-62.7,62.7c-2.4,2.4-5.7,3.8-9.2,3.8H6.5c-5.8,0-8.7-7-4.6-11.1L64.6,237.9z" fill="url(#solGrad1)" stroke="url(#solRim)" stroke-width="1.5" />
        <path d="M64.6,3.8C67.1,1.4,70.4,0,73.8,0h317.4c5.8,0,8.7,7,4.6,11.1l-62.7,62.7c-2.4,2.4-5.7,3.8-9.2,3.8H6.5c-5.8,0-8.7-7-4.6-11.1L64.6,3.8z" fill="url(#solGrad2)" stroke="url(#solRim)" stroke-width="1.5" />
        <path d="M333.1,120.1c-2.4-2.4-5.7-3.8-9.2-3.8H6.5c-5.8,0-8.7,7-4.6,11.1l62.7,62.7c2.4,2.4,5.7,3.8,9.2,3.8h317.4c5.8,0,8.7-7,4.6-11.1L333.1,120.1z" fill="url(#solGrad1)" stroke="url(#solRim)" stroke-width="1.5" />
      </g>
    </svg>
    `;
}

// 4. Arc Network Portal Emblem SVG
function buildArcSvg() {
    const rawSvg = fs.readFileSync("public/chains/arc.svg", "utf8");
    const pathMatch = rawSvg.match(/<path[^>]+d="([^"]+)"/);
    const pathD = pathMatch ? pathMatch[1] : "";
    const scale = 230 / 24;
    const offsetX = 600 - (24 * scale) / 2;
    const offsetY = 200 - (24 * scale) / 2;

    return `
    <svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
      <defs>
        <linearGradient id="arcGrad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="#182680" />
          <stop offset="50%" stop-color="#4f46e5" />
          <stop offset="100%" stop-color="#842D56" />
        </linearGradient>

        <linearGradient id="arcRim" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="#ffffff" stop-opacity="0.9" />
          <stop offset="50%" stop-color="#818cf8" stop-opacity="0.5" />
          <stop offset="100%" stop-color="#f43f5e" stop-opacity="0.3" />
        </linearGradient>

        <filter id="arcShadow" x="-30%" y="-30%" width="160%" height="160%">
          <feDropShadow dx="0" dy="16" stdDeviation="18" flood-color="#09111c" flood-opacity="0.75" />
        </filter>
        <filter id="floorShadow" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="16" />
        </filter>
      </defs>

      <ellipse cx="600" cy="340" rx="140" ry="16" fill="rgba(15, 23, 42, 0.45)" filter="url(#floorShadow)" />
      <ellipse cx="600" cy="340" rx="80" ry="8" fill="rgba(255, 255, 255, 0.3)" filter="url(#floorShadow)" />

      <g transform="translate(${offsetX}, ${offsetY}) scale(${scale})" filter="url(#arcShadow)">
        <path d="${pathD}" fill="url(#arcGrad)" stroke="url(#arcRim)" stroke-width="0.3" />
      </g>
    </svg>
    `;
}

// 5. USDC Universal Coin Emblem SVG
function buildUsdcSvg() {
    const scale = 230 / 2000;
    const offsetX = 600 - (2000 * scale) / 2;
    const offsetY = 200 - (2000 * scale) / 2;

    return `
    <svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
      <defs>
        <linearGradient id="usdcBlue" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="#2775ca" />
          <stop offset="50%" stop-color="#1f62ab" />
          <stop offset="100%" stop-color="#144275" />
        </linearGradient>
        <linearGradient id="coinRim" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="#ffffff" stop-opacity="0.95" />
          <stop offset="50%" stop-color="#93c5fd" stop-opacity="0.6" />
          <stop offset="100%" stop-color="#1d4ed8" stop-opacity="0.2" />
        </linearGradient>
        <filter id="coinShadow" x="-30%" y="-30%" width="160%" height="160%">
          <feDropShadow dx="0" dy="16" stdDeviation="18" flood-color="#09111c" flood-opacity="0.75" />
        </filter>
        <filter id="floorShadow" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="16" />
        </filter>
      </defs>

      <ellipse cx="600" cy="345" rx="140" ry="16" fill="rgba(15, 23, 42, 0.45)" filter="url(#floorShadow)" />
      <ellipse cx="600" cy="345" rx="80" ry="8" fill="rgba(255, 255, 255, 0.3)" filter="url(#floorShadow)" />

      <g transform="translate(${offsetX}, ${offsetY}) scale(${scale})" filter="url(#coinShadow)">
        <path d="M1000 2000c554.17 0 1000-445.83 1000-1000S1554.17 0 1000 0 0 445.83 0 1000s445.83 1000 1000 1000z" fill="url(#usdcBlue)" stroke="url(#coinRim)" stroke-width="12" />
        <path d="M1275 1158.33c0-145.83-87.5-195.83-262.5-216.66-125-16.67-150-50-150-108.34s41.67-95.83 125-95.83c75 0 116.67 25 137.5 87.5 4.17 12.5 16.67 20.83 29.17 20.83h66.66c16.67 0 29.17-12.5 29.17-29.16v-4.17c-16.67-91.67-91.67-162.5-187.5-170.83v-100c0-16.67-12.5-29.17-33.33-33.34h-62.5c-16.67 0-29.17 12.5-33.34 33.34v95.83c-125 16.67-204.16 100-204.16 204.17 0 137.5 83.33 191.66 258.33 212.5 116.67 20.83 154.17 45.83 154.17 112.5s-58.34 112.5-137.5 112.5c-108.34 0-145.84-45.84-158.34-108.34-4.16-16.66-16.66-25-29.16-25h-70.84c-16.66 0-29.16 12.5-29.16 29.17v4.17c16.66 104.16 83.33 179.16 220.83 200v100c0 16.66 12.5 29.16 33.33 33.33h62.5c16.67 0 29.17-12.5 33.34-33.33v-100c125-20.84 208.33-108.34 208.33-220.84z" fill="#fff" />
        <path d="M787.5 1595.83c-325-116.66-491.67-479.16-370.83-800 62.5-175 200-308.33 370.83-370.83 16.67-8.33 25-20.83 25-41.67V325c0-16.67-8.33-29.17-25-33.33-4.17 0-12.5 0-16.67 4.16-395.83 125-612.5 545.84-487.5 941.67 75 233.33 254.17 412.5 487.5 487.5 16.67 8.33 33.34 0 37.5-16.67 4.17-4.16 4.17-8.33 4.17-16.66v-58.34c0-12.5-12.5-29.16-25-37.5zM1229.17 295.83c-16.67-8.33-33.34 0-37.5 16.67-4.17 4.17-4.17 8.33-4.17 16.67v58.33c0 16.67 12.5 33.33 25 41.67 325 116.66 491.67 479.16 370.83 800-62.5 175-200 308.33-370.83 370.83-16.67 8.33-25 20.83-25 41.67V1700c0 16.67 8.33 29.17 25 33.33 4.17 0 12.5 0 16.67-4.16 395.83-125 612.5-545.84 487.5-941.67-75-237.5-258.34-416.67-487.5-491.67z" fill="#fff" />
      </g>
    </svg>
    `;
}

async function generateBanner(svgString, outputFileName) {
    const bg = await sharp(userBgSrc).resize(width, height, { fit: "cover" }).toBuffer();
    const emblem = await sharp(Buffer.from(svgString)).png().toBuffer();

    const outPath = path.join(bannersDir, outputFileName);
    await sharp(bg)
        .composite([{ input: emblem, blend: "over" }])
        .png({ quality: 100 })
        .toFile(outPath);

    console.log(`Successfully generated ${outputFileName}`);
}

async function main() {
    await generateBanner(buildEthereumSvg(), "eth-3d-banner.png");
    await generateBanner(buildSolanaSvg(), "solana-3d-banner.png");
    await generateBanner(buildArcSvg(), "arc-3d-banner.png");
    await generateBanner(buildUsdcSvg(), "usdc-3d-banner.png");
    console.log("\nAll banners generated with user-provided background!");
}

main().catch(console.error);
