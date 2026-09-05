import fs from "fs";
import path from "path";
import sharp from "sharp";

const width = 1200;
const height = 400;

// Solana viewBox is 397.7 x 311.7. Scale to height 220, center at (600, 200)
const scale = 220 / 311.7;
const offsetX = 600 - (397.7 * scale) / 2;
const offsetY = 200 - (311.7 * scale) / 2;

const svg = `
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <defs>
    <!-- SubScript Brand Theme Background Gradients (#00d2b4 / #082824 / #031412) -->
    <radialGradient id="subscriptBg" cx="50%" cy="50%" r="65%">
      <stop offset="0%" stop-color="#0c3631" stop-opacity="0.95" />
      <stop offset="45%" stop-color="#06221f" stop-opacity="0.98" />
      <stop offset="100%" stop-color="#020e0d" stop-opacity="1" />
    </radialGradient>
    
    <!-- SubScript Signature Mint/Teal Aura (#00d2b4) -->
    <radialGradient id="subscriptAura" cx="50%" cy="48%" r="42%">
      <stop offset="0%" stop-color="#00d2b4" stop-opacity="0.38" />
      <stop offset="45%" stop-color="#00a892" stop-opacity="0.20" />
      <stop offset="100%" stop-color="#00d2b4" stop-opacity="0" />
    </radialGradient>

    <!-- Solana Signature 3D Luminous Neon Gradients (#00FFA3 to #DC1FFF) -->
    <linearGradient id="solGrad1" x1="0%" y1="0%" x2="100%" y2="0%">
      <stop offset="0%" stop-color="#00FFA3" />
      <stop offset="45%" stop-color="#00d2b4" />
      <stop offset="100%" stop-color="#DC1FFF" />
    </linearGradient>

    <linearGradient id="solGrad2" x1="100%" y1="0%" x2="0%" y2="0%">
      <stop offset="0%" stop-color="#DC1FFF" />
      <stop offset="55%" stop-color="#00d2b4" />
      <stop offset="100%" stop-color="#00FFA3" />
    </linearGradient>

    <!-- Glass Rim Highlight -->
    <linearGradient id="rimHighlight" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#ffffff" stop-opacity="0.9" />
      <stop offset="50%" stop-color="#00FFA3" stop-opacity="0.5" />
      <stop offset="100%" stop-color="#DC1FFF" stop-opacity="0.3" />
    </linearGradient>

    <filter id="solGlow" x="-30%" y="-30%" width="160%" height="160%">
      <feDropShadow dx="0" dy="12" stdDeviation="16" flood-color="#000000" flood-opacity="0.8" />
      <feDropShadow dx="0" dy="0" stdDeviation="14" flood-color="#00d2b4" flood-opacity="0.4" />
      <feDropShadow dx="0" dy="0" stdDeviation="8" flood-color="#DC1FFF" flood-opacity="0.3" />
    </filter>
    
    <filter id="floorShadow" x="-50%" y="-50%" width="200%" height="200%">
      <feGaussianBlur stdDeviation="20" />
    </filter>
  </defs>

  <!-- Background Base: SubScript Deep Obsidian Teal -->
  <rect width="${width}" height="${height}" fill="#020e0d" />
  <rect width="${width}" height="${height}" fill="url(#subscriptBg)" />

  <!-- SubScript Ambient Mint/Teal Glow Spotlight -->
  <circle cx="600" cy="200" r="320" fill="url(#subscriptAura)" />

  <!-- Ambient Subtle Grid / Concentric Rings -->
  <g stroke="rgba(0, 210, 180, 0.08)" stroke-width="1">
    <circle cx="600" cy="200" r="160" fill="none" stroke-dasharray="4 8" />
    <circle cx="600" cy="200" r="230" fill="none" stroke-dasharray="6 12" />
    <circle cx="600" cy="200" r="300" fill="none" stroke-dasharray="8 16" />
  </g>

  <!-- Floor Ambient SubScript Mint Reflection -->
  <ellipse cx="600" cy="358" rx="150" ry="16" fill="rgba(0,0,0,0.75)" filter="url(#floorShadow)" />
  <ellipse cx="600" cy="358" rx="90" ry="10" fill="rgba(0, 210, 180, 0.35)" filter="url(#floorShadow)" />

  <!-- Solana 3D Metallic Emblem (Exact Vector Paths) -->
  <g transform="translate(${offsetX}, ${offsetY}) scale(${scale})" filter="url(#solGlow)">
    <!-- Bottom Bar -->
    <path d="M64.6,237.9c2.4-2.4,5.7-3.8,9.2-3.8h317.4c5.8,0,8.7,7,4.6,11.1l-62.7,62.7c-2.4,2.4-5.7,3.8-9.2,3.8H6.5c-5.8,0-8.7-7-4.6-11.1L64.6,237.9z" fill="url(#solGrad1)" stroke="url(#rimHighlight)" stroke-width="1.5" />
    
    <!-- Top Bar -->
    <path d="M64.6,3.8C67.1,1.4,70.4,0,73.8,0h317.4c5.8,0,8.7,7,4.6,11.1l-62.7,62.7c-2.4,2.4-5.7,3.8-9.2,3.8H6.5c-5.8,0-8.7-7-4.6-11.1L64.6,3.8z" fill="url(#solGrad2)" stroke="url(#rimHighlight)" stroke-width="1.5" />
    
    <!-- Middle Bar -->
    <path d="M333.1,120.1c-2.4-2.4-5.7-3.8-9.2-3.8H6.5c-5.8,0-8.7,7-4.6,11.1l62.7,62.7c2.4,2.4,5.7,3.8,9.2,3.8h317.4c5.8,0,8.7-7,4.6-11.1L333.1,120.1z" fill="url(#solGrad1)" stroke="url(#rimHighlight)" stroke-width="1.5" />
  </g>
</svg>
`;

async function main() {
    const outPath = path.join("public", "email", "banners", "solana-3d-banner.png");
    await sharp(Buffer.from(svg))
        .png({ quality: 100 })
        .toFile(outPath);
    console.log("Successfully generated SubScript-themed Solana banner at", outPath);
}

main().catch(console.error);
