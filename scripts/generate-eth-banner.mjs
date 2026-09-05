import fs from "fs";
import path from "path";
import sharp from "sharp";

const width = 1200;
const height = 400;

// The exact official Ethereum coordinates scaled to height 270, centered at (600, 200)
// Original viewBox is 784.37 x 1277.39
const scale = 270 / 1277.39;
const offsetX = 600 - (784.37 * scale) / 2;
const offsetY = 200 - (1277.39 * scale) / 2;

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

    <!-- Metallic & Prismatic 3D Shading for Ethereum Facets with SubScript Teal Specular Accents -->
    <linearGradient id="topLt" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#ffffff" />
      <stop offset="25%" stop-color="#e0f7f4" />
      <stop offset="60%" stop-color="#a3ded6" />
      <stop offset="100%" stop-color="#5fa9a0" />
    </linearGradient>

    <linearGradient id="topRt" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#a3ded6" />
      <stop offset="50%" stop-color="#3a756e" />
      <stop offset="100%" stop-color="#113632" />
    </linearGradient>

    <linearGradient id="midLt" x1="0%" y1="100%" x2="100%" y2="0%">
      <stop offset="0%" stop-color="#00d2b4" />
      <stop offset="50%" stop-color="#5eead4" />
      <stop offset="100%" stop-color="#ffffff" />
    </linearGradient>

    <linearGradient id="midRt" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#2a5752" />
      <stop offset="50%" stop-color="#113632" />
      <stop offset="100%" stop-color="#071e1b" />
    </linearGradient>

    <linearGradient id="botLt" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#99f6e4" />
      <stop offset="50%" stop-color="#459d92" />
      <stop offset="100%" stop-color="#1b4d47" />
    </linearGradient>

    <linearGradient id="botRt" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#1b4d47" />
      <stop offset="60%" stop-color="#0f332f" />
      <stop offset="100%" stop-color="#051715" />
    </linearGradient>

    <!-- SubScript Mint Reflection Rim -->
    <linearGradient id="rimGloss" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#ffffff" stop-opacity="0.95" />
      <stop offset="45%" stop-color="#00d2b4" stop-opacity="0.6" />
      <stop offset="100%" stop-color="#007f6e" stop-opacity="0.1" />
    </linearGradient>

    <filter id="ethGlow" x="-30%" y="-30%" width="160%" height="160%">
      <feDropShadow dx="0" dy="14" stdDeviation="18" flood-color="#000000" flood-opacity="0.8" />
      <feDropShadow dx="0" dy="0" stdDeviation="12" flood-color="#00d2b4" flood-opacity="0.35" />
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
  <ellipse cx="600" cy="358" rx="140" ry="16" fill="rgba(0,0,0,0.75)" filter="url(#floorShadow)" />
  <ellipse cx="600" cy="358" rx="80" ry="10" fill="rgba(0, 210, 180, 0.35)" filter="url(#floorShadow)" />

  <!-- Ethereum 3D Crystal Diamond (Exact Official Geometry) -->
  <g transform="translate(${offsetX}, ${offsetY}) scale(${scale})" filter="url(#ethGlow)">
    <!-- Top Right Facet -->
    <polygon points="392.07,0 383.5,29.11 383.5,873.74 392.07,882.29 784.13,650.54" fill="url(#topRt)" stroke="url(#rimGloss)" stroke-width="1.5" />
    
    <!-- Top Left Facet (Light catcher) -->
    <polygon points="392.07,0 0,650.54 392.07,882.29 392.07,472.33" fill="url(#topLt)" stroke="url(#rimGloss)" stroke-width="2" />
    
    <!-- Mid Left Facet (Reflective Core) -->
    <polygon points="0,650.54 392.07,882.29 392.07,472.33" fill="url(#midLt)" opacity="0.95" />

    <!-- Mid Right Facet -->
    <polygon points="392.07,882.29 784.13,650.54 392.07,472.33" fill="url(#midRt)" opacity="0.95" />

    <!-- Bottom Left Facet -->
    <polygon points="392.07,1277.38 392.07,956.52 0,724.89" fill="url(#botLt)" stroke="url(#rimGloss)" stroke-width="1.5" />

    <!-- Bottom Right Facet -->
    <polygon points="392.07,956.52 387.24,962.41 387.24,1263.28 392.07,1277.38 784.37,724.89" fill="url(#botRt)" stroke="rgba(0, 210, 180, 0.3)" stroke-width="1" />
  </g>
</svg>
`;

async function main() {
    const outPath = path.join("public", "email", "banners", "eth-3d-banner.png");
    await sharp(Buffer.from(svg))
        .png({ quality: 100 })
        .toFile(outPath);
    console.log("Successfully generated SubScript-themed Ethereum banner at", outPath);
}

main().catch(console.error);
