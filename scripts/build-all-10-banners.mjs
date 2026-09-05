import fs from "fs";
import path from "path";
import sharp from "sharp";

const width = 1200;
const height = 400;
const userBgSrc = "C:/Users/Kristien/.gemini/antigravity/brain/e51b14f6-0fe1-4520-8fa8-fc69d13671a1/.user_uploaded/media_1788617993630.png";
const outDir = path.join("public", "email", "banners");

if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true });
}

// Common floor shadow and specular definitions
const commonDefs = `
  <defs>
    <filter id="shadow" x="-40%" y="-40%" width="180%" height="180%">
      <feDropShadow dx="0" dy="16" stdDeviation="18" flood-color="#070c14" flood-opacity="0.8" />
      <feDropShadow dx="0" dy="4" stdDeviation="6" flood-color="#000000" flood-opacity="0.4" />
    </filter>
    <filter id="floorShadow" x="-50%" y="-50%" width="200%" height="200%">
      <feGaussianBlur stdDeviation="16" />
    </filter>
  </defs>
  <ellipse cx="600" cy="348" rx="145" ry="17" fill="rgba(11, 18, 30, 0.55)" filter="url(#floorShadow)" />
  <ellipse cx="600" cy="348" rx="80" ry="9" fill="rgba(255, 255, 255, 0.25)" filter="url(#floorShadow)" />
`;

// 1. Ethereum: eth-3d-banner.png
function ethSvg() {
    const scale = 250 / 1277.39;
    const ox = 600 - (784.37 * scale) / 2;
    const oy = 195 - (1277.39 * scale) / 2;
    return `
    <svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
      ${commonDefs}
      <linearGradient id="ethTopLt" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="#ffffff" />
        <stop offset="25%" stop-color="#e2e8f0" />
        <stop offset="60%" stop-color="#94a3b8" />
        <stop offset="100%" stop-color="#64748b" />
      </linearGradient>
      <linearGradient id="ethTopRt" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="#94a3b8" />
        <stop offset="45%" stop-color="#475569" />
        <stop offset="100%" stop-color="#1e293b" />
      </linearGradient>
      <linearGradient id="ethMidLt" x1="0%" y1="100%" x2="100%" y2="0%">
        <stop offset="0%" stop-color="#64748b" />
        <stop offset="50%" stop-color="#94a3b8" />
        <stop offset="100%" stop-color="#f8fafc" />
      </linearGradient>
      <linearGradient id="ethMidRt" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="#334155" />
        <stop offset="60%" stop-color="#1e293b" />
        <stop offset="100%" stop-color="#0f172a" />
      </linearGradient>
      <linearGradient id="ethBotLt" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="#cbd5e1" />
        <stop offset="50%" stop-color="#64748b" />
        <stop offset="100%" stop-color="#334155" />
      </linearGradient>
      <linearGradient id="ethBotRt" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="#334155" />
        <stop offset="60%" stop-color="#1e293b" />
        <stop offset="100%" stop-color="#090e17" />
      </linearGradient>
      <linearGradient id="ethRim" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="#ffffff" stop-opacity="0.95" />
        <stop offset="50%" stop-color="#cbd5e1" stop-opacity="0.5" />
        <stop offset="100%" stop-color="#475569" stop-opacity="0.1" />
      </linearGradient>
      <g transform="translate(${ox}, ${oy}) scale(${scale})" filter="url(#shadow)">
        <polygon points="392.07,0 383.5,29.11 383.5,873.74 392.07,882.29 784.13,650.54" fill="url(#ethTopRt)" stroke="url(#ethRim)" stroke-width="1.5" />
        <polygon points="392.07,0 0,650.54 392.07,882.29 392.07,472.33" fill="url(#ethTopLt)" stroke="url(#ethRim)" stroke-width="2" />
        <polygon points="0,650.54 392.07,882.29 392.07,472.33" fill="url(#ethMidLt)" opacity="0.95" />
        <polygon points="392.07,882.29 784.13,650.54 392.07,472.33" fill="url(#ethMidRt)" opacity="0.95" />
        <polygon points="392.07,1277.38 392.07,956.52 0,724.89" fill="url(#ethBotLt)" stroke="url(#ethRim)" stroke-width="1.5" />
        <polygon points="392.07,956.52 387.24,962.41 387.24,1263.28 392.07,1277.38 784.37,724.89" fill="url(#ethBotRt)" stroke="rgba(255,255,255,0.2)" stroke-width="1" />
      </g>
    </svg>
    `;
}

// 2. Solana: solana-3d-banner.png
function solanaSvg() {
    const scale = 220 / 311.7;
    const ox = 600 - (397.7 * scale) / 2;
    const oy = 200 - (311.7 * scale) / 2;
    return `
    <svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
      ${commonDefs}
      <linearGradient id="solG1" x1="0%" y1="0%" x2="100%" y2="0%">
        <stop offset="0%" stop-color="#00FFA3" />
        <stop offset="50%" stop-color="#14F195" />
        <stop offset="100%" stop-color="#DC1FFF" />
      </linearGradient>
      <linearGradient id="solG2" x1="100%" y1="0%" x2="0%" y2="0%">
        <stop offset="0%" stop-color="#DC1FFF" />
        <stop offset="50%" stop-color="#14F195" />
        <stop offset="100%" stop-color="#00FFA3" />
      </linearGradient>
      <linearGradient id="solRim" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="#ffffff" stop-opacity="0.95" />
        <stop offset="50%" stop-color="#00FFA3" stop-opacity="0.5" />
        <stop offset="100%" stop-color="#DC1FFF" stop-opacity="0.3" />
      </linearGradient>
      <g transform="translate(${ox}, ${oy}) scale(${scale})" filter="url(#shadow)">
        <path d="M64.6,237.9c2.4-2.4,5.7-3.8,9.2-3.8h317.4c5.8,0,8.7,7,4.6,11.1l-62.7,62.7c-2.4,2.4-5.7,3.8-9.2,3.8H6.5c-5.8,0-8.7-7-4.6-11.1L64.6,237.9z" fill="url(#solG1)" stroke="url(#solRim)" stroke-width="1.5" />
        <path d="M64.6,3.8C67.1,1.4,70.4,0,73.8,0h317.4c5.8,0,8.7,7,4.6,11.1l-62.7,62.7c-2.4,2.4-5.7,3.8-9.2,3.8H6.5c-5.8,0-8.7-7-4.6-11.1L64.6,3.8z" fill="url(#solG2)" stroke="url(#solRim)" stroke-width="1.5" />
        <path d="M333.1,120.1c-2.4-2.4-5.7-3.8-9.2-3.8H6.5c-5.8,0-8.7,7-4.6,11.1l62.7,62.7c2.4,2.4,5.7,3.8,9.2,3.8h317.4c5.8,0,8.7-7,4.6-11.1L333.1,120.1z" fill="url(#solG1)" stroke="url(#solRim)" stroke-width="1.5" />
      </g>
    </svg>
    `;
}

// 3. Arc Network: arc-3d-banner.png — Authentic #182680 to #842D56 gradient from public/chains/arc.svg
function arcSvg() {
    const rawSvg = fs.readFileSync("public/chains/arc.svg", "utf8");
    const pathMatch = rawSvg.match(/<path[^>]+d="([^"]+)"/);
    const pathD = pathMatch ? pathMatch[1] : "";
    const scale = 230 / 24;
    const ox = 600 - (24 * scale) / 2;
    const oy = 195 - (24 * scale) / 2;
    return `
    <svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
      ${commonDefs}
      <linearGradient id="arcExact" x1="12.088" x2="12.088" y1="3" y2="21" gradientUnits="userSpaceOnUse">
        <stop offset="0%" stop-color="#182680" />
        <stop offset="100%" stop-color="#842D56" />
      </linearGradient>
      <linearGradient id="arcRim" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="#ffffff" stop-opacity="0.85" />
        <stop offset="40%" stop-color="#818cf8" stop-opacity="0.5" />
        <stop offset="100%" stop-color="#842D56" stop-opacity="0.2" />
      </linearGradient>
      <g transform="translate(${ox}, ${oy}) scale(${scale})" filter="url(#shadow)">
        <path d="${pathD}" fill="url(#arcExact)" stroke="url(#arcRim)" stroke-width="0.3" />
      </g>
    </svg>
    `;
}

// 4. Base: base-3d-banner.png — Authentic Base Blue Square ("The Square") from public/chains/base.svg
function baseSvg() {
    const scale = 220 / 249;
    const ox = 600 - (249 * scale) / 2;
    const oy = 195 - (249 * scale) / 2;
    return `
    <svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
      ${commonDefs}
      <linearGradient id="baseBlueGrad" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="#0052FF" />
        <stop offset="60%" stop-color="#0045d8" />
        <stop offset="100%" stop-color="#0035a8" />
      </linearGradient>
      <linearGradient id="baseRim" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="#ffffff" stop-opacity="0.95" />
        <stop offset="45%" stop-color="#60a5fa" stop-opacity="0.6" />
        <stop offset="100%" stop-color="#0052FF" stop-opacity="0.2" />
      </linearGradient>
      <g transform="translate(${ox}, ${oy}) scale(${scale})" filter="url(#shadow)">
        <path d="M0 19.671C0 12.9332 0 9.56425 1.26956 6.97276C2.48511 4.49151 4.49151 2.48511 6.97276 1.26956C9.56425 0 12.9332 0 19.671 0H229.329C236.067 0 239.436 0 242.027 1.26956C244.508 2.48511 246.515 4.49151 247.73 6.97276C249 9.56425 249 12.9332 249 19.671V229.329C249 236.067 249 239.436 247.73 242.027C246.515 244.508 244.508 246.515 242.027 247.73C239.436 249 236.067 249 229.329 249H19.671C12.9332 249 9.56425 249 6.97276 247.73C4.49151 246.515 2.48511 244.508 1.26956 242.027C0 239.436 0 236.067 0 229.329V19.671Z" fill="url(#baseBlueGrad)" stroke="url(#baseRim)" stroke-width="2" />
      </g>
    </svg>
    `;
}

// 5. Arbitrum: arbitrum-3d-banner.png — Authentic Arbitrum Vector from public/chains/arbitrum.svg
function arbitrumSvg() {
    const scale = 230 / 2500;
    const ox = 600 - (2500 * scale) / 2;
    const oy = 195 - (2500 * scale) / 2;
    return `
    <svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
      ${commonDefs}
      <linearGradient id="arbRim" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="#ffffff" stop-opacity="0.9" />
        <stop offset="50%" stop-color="#9DCCED" stop-opacity="0.6" />
        <stop offset="100%" stop-color="#12AAFF" stop-opacity="0.2" />
      </linearGradient>
      <g transform="translate(${ox}, ${oy}) scale(${scale})" filter="url(#shadow)">
        <!-- Outer hexagon background -->
        <path fill="#213147" stroke="url(#arbRim)" stroke-width="12" d="M226,760v980c0,63,33,120,88,152l849,490c54,31,121,31,175,0l849-490c54-31,88-89,88-152V760 c0-63-33-120-88-152l-849-490c-54-31-121-31-175,0L314,608c-54,31-87,89-87,152H226z" />
        <!-- Inner cyan slashes -->
        <path fill="#12AAFF" d="M1435,1440l-121,332c-3,9-3,19,0,29l208,571l241-139l-289-793C1467,1422,1442,1422,1435,1440z" />
        <path fill="#12AAFF" d="M1678,882c-7-18-32-18-39,0l-121,332c-3,9-3,19,0,29l341,935l241-139L1678,883V882z" />
        <!-- Hex frame line -->
        <path fill="#9DCCED" d="M1250,155c6,0,12,2,17,5l918,530c11,6,17,18,17,30v1060c0,12-7,24-17,30l-918,530c-5,3-11,5-17,5 s-12-2-17-5l-918-530c-11-6-17-18-17-30V719c0-12,7-24,17-30l918-530c5-3,11-5,17-5l0,0V155z M1250,0c-33,0-65,8-95,25L237,555 c-59,34-95,96-95,164v1060c0,68,36,130,95,164l918,530c29,17,62,25,95,25s65-8,95-25l918-530c59-34,95-96,95-164V719 c0-68-36-130-95-164L1344,25c-29-17-62-25-95-25l0,0H1250z" />
        <polygon fill="#213147" points="642,2179 727,1947 897,2088 738,2234" />
        <!-- White bridge slashes -->
        <path fill="#FFFFFF" d="M1172,644H939c-17,0-33,11-39,27L401,2039l241,139l550-1507c5-14-5-28-19-28L1172,644z" />
        <path fill="#FFFFFF" d="M1580,644h-233c-17,0-33,11-39,27L738,2233l241,139l620-1701c5-14-5-28-19-28V644z" />
      </g>
    </svg>
    `;
}

// 6. Polygon: polygon-3d-banner.png — Authentic Möbius Hex Link from public/chains/polygon.svg
function polygonSvg() {
    const scale = 215 / 161;
    const ox = 600 - (178 * scale) / 2;
    const oy = 195 - (161 * scale) / 2;
    return `
    <svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
      ${commonDefs}
      <linearGradient id="polyGrad" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="#8247E5" />
        <stop offset="60%" stop-color="#6C00F6" />
        <stop offset="100%" stop-color="#5500c4" />
      </linearGradient>
      <linearGradient id="polyRim" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="#ffffff" stop-opacity="0.9" />
        <stop offset="50%" stop-color="#c084fc" stop-opacity="0.5" />
        <stop offset="100%" stop-color="#6C00F6" stop-opacity="0.2" />
      </linearGradient>
      <g transform="translate(${ox}, ${oy}) scale(${scale})" filter="url(#shadow)">
        <path fill="url(#polyGrad)" stroke="url(#polyRim)" stroke-width="1.5" d="M66.8,54.7l-16.7-9.7L0,74.1v58l50.1,29l50.1-29V41.9L128,25.8l27.8,16.1v32.2L128,90.2l-16.7-9.7v25.8 l16.7,9.7l50.1-29V29L128,0L77.9,29v90.2l-27.8,16.1l-27.8-16.1V86.9l27.8-16.1l16.7,9.7V54.7z" />
      </g>
    </svg>
    `;
}

// 7. Avalanche: avalanche-3d-banner.png — Authentic Mountain Chevrons from public/chains/avalanche.svg
function avalancheSvg() {
    const scale = 230 / 1504;
    const ox = 600 - (1503 * scale) / 2;
    const oy = 195 - (1504 * scale) / 2;
    return `
    <svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
      ${commonDefs}
      <linearGradient id="avaxRim" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="#ffffff" stop-opacity="0.95" />
        <stop offset="50%" stop-color="#fca5a5" stop-opacity="0.6" />
        <stop offset="100%" stop-color="#b91c1c" stop-opacity="0.2" />
      </linearGradient>
      <g transform="translate(${ox}, ${oy}) scale(${scale})" filter="url(#shadow)">
        <!-- White background backing for cutout -->
        <rect x="287" y="258" width="928" height="844" fill="#ffffff" />
        <path fill-rule="evenodd" clip-rule="evenodd" d="M1502.5 752C1502.5 1166.77 1166.27 1503 751.5 1503C336.734 1503 0.5 1166.77 0.5 752C0.5 337.234 336.734 1 751.5 1C1166.27 1 1502.5 337.234 1502.5 752ZM538.688 1050.86H392.94C362.314 1050.86 347.186 1050.86 337.962 1044.96C327.999 1038.5 321.911 1027.8 321.173 1015.99C320.619 1005.11 328.184 991.822 343.312 965.255L703.182 330.935C718.495 303.999 726.243 290.531 736.021 285.55C746.537 280.2 759.083 280.2 769.599 285.55C779.377 290.531 787.126 303.999 802.438 330.935L876.42 460.079L876.797 460.738C893.336 489.635 901.723 504.289 905.385 519.669C909.443 536.458 909.443 554.169 905.385 570.958C901.695 586.455 893.393 601.215 876.604 630.549L687.573 964.702L687.084 965.558C670.436 994.693 661.999 1009.46 650.306 1020.6C637.576 1032.78 622.263 1041.63 605.474 1046.62C590.161 1050.86 573.004 1050.86 538.688 1050.86ZM906.75 1050.86H1115.59C1146.4 1050.86 1161.9 1050.86 1171.13 1044.78C1181.09 1038.32 1187.36 1027.43 1187.92 1015.63C1188.45 1005.1 1181.05 992.33 1166.55 967.307C1166.05 966.455 1165.55 965.588 1165.04 964.706L1060.43 785.75L1059.24 783.735C1044.54 758.877 1037.12 746.324 1027.59 741.472C1017.08 736.121 1004.71 736.121 994.199 741.472C984.605 746.453 976.857 759.552 961.544 785.934L857.306 964.891L856.949 965.507C841.69 991.847 834.064 1005.01 834.614 1015.81C835.352 1027.62 841.44 1038.5 851.402 1044.96C860.443 1050.86 875.94 1050.86 906.75 1050.86Z" fill="#E84142" stroke="url(#avaxRim)" stroke-width="6" />
      </g>
    </svg>
    `;
}

// 8. Optimism: optimism-3d-banner.png — Authentic Forward-Slanted OP Vector from public/chains/optimism.svg
function optimismSvg() {
    const scale = 230 / 1037;
    const ox = 600 - (1037 * scale) / 2;
    const oy = 195 - (1037 * scale) / 2;
    return `
    <svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
      ${commonDefs}
      <linearGradient id="opRim" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="#ffffff" stop-opacity="0.95" />
        <stop offset="50%" stop-color="#fca5a5" stop-opacity="0.6" />
        <stop offset="100%" stop-color="#dc2626" stop-opacity="0.2" />
      </linearGradient>
      <g transform="translate(${ox}, ${oy}) scale(${scale})" filter="url(#shadow)">
        <circle cx="518.5" cy="518.5" r="518.5" fill="#FF0420" stroke="url(#opRim)" stroke-width="8" />
        <!-- Authentic OP letters vector -->
        <path fill="#FAFAF9" d="M761.8,365.3H576.3l-43.7,309.6h88.8l10.5-75h101c91.2,0,136.7-36.6,147-114.9 C890.6,404.3,852.4,365.3,761.8,365.3L761.8,365.3L761.8,365.3z M790,479.6c-3.6,33.3-22.7,47.8-60.9,47.8h-86.9l12.6-89.5h90.9 C780.3,437.8,793.3,449.6,790,479.6L790,479.6z M357.4,358c-120.9,0-184.3,50.8-199.2,159.6c-15.2,111.3,37,164.5,161,164.5 c124,0,184-50.8,198.9-159.6C533.2,411.2,481.4,358,357.4,358L357.4,358z M427.8,517.7c-8.2,61.4-39.1,88.9-103.7,88.9 c-60.6,0-83.4-24.2-75.5-84.1c8.2-61.7,39.7-88.9,103.7-88.9S435.6,458.1,427.8,517.7z" />
      </g>
    </svg>
    `;
}

// 9. USDC: usdc-3d-banner.png — Authentic Circle USDC Medallion from public/chains/usdc.svg
function usdcSvg() {
    const scale = 230 / 2000;
    const ox = 600 - (2000 * scale) / 2;
    const oy = 195 - (2000 * scale) / 2;
    return `
    <svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
      ${commonDefs}
      <linearGradient id="usdcB" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="#2775ca" />
        <stop offset="50%" stop-color="#1f62ab" />
        <stop offset="100%" stop-color="#144275" />
      </linearGradient>
      <linearGradient id="coinRim" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="#ffffff" stop-opacity="0.95" />
        <stop offset="50%" stop-color="#93c5fd" stop-opacity="0.6" />
        <stop offset="100%" stop-color="#1d4ed8" stop-opacity="0.2" />
      </linearGradient>
      <g transform="translate(${ox}, ${oy}) scale(${scale})" filter="url(#shadow)">
        <path d="M1000 2000c554.17 0 1000-445.83 1000-1000S1554.17 0 1000 0 0 445.83 0 1000s445.83 1000 1000 1000z" fill="url(#usdcB)" stroke="url(#coinRim)" stroke-width="12" />
        <path d="M1275 1158.33c0-145.83-87.5-195.83-262.5-216.66-125-16.67-150-50-150-108.34s41.67-95.83 125-95.83c75 0 116.67 25 137.5 87.5 4.17 12.5 16.67 20.83 29.17 20.83h66.66c16.67 0 29.17-12.5 29.17-29.16v-4.17c-16.67-91.67-91.67-162.5-187.5-170.83v-100c0-16.67-12.5-29.17-33.33-33.34h-62.5c-16.67 0-29.17 12.5-33.34 33.34v95.83c-125 16.67-204.16 100-204.16 204.17 0 137.5 83.33 191.66 258.33 212.5 116.67 20.83 154.17 45.83 154.17 112.5s-58.34 112.5-137.5 112.5c-108.34 0-145.84-45.84-158.34-108.34-4.16-16.66-16.66-25-29.16-25h-70.84c-16.66 0-29.16 12.5-29.16 29.17v4.17c16.66 104.16 83.33 179.16 220.83 200v100c0 16.66 12.5 29.16 33.33 33.33h62.5c16.67 0 29.17-12.5 33.34-33.33v-100c125-20.84 208.33-108.34 208.33-220.84z" fill="#fff" />
        <path d="M787.5 1595.83c-325-116.66-491.67-479.16-370.83-800 62.5-175 200-308.33 370.83-370.83 16.67-8.33 25-20.83 25-41.67V325c0-16.67-8.33-29.17-25-33.33-4.17 0-12.5 0-16.67 4.16-395.83 125-612.5 545.84-487.5 941.67 75 233.33 254.17 412.5 487.5 487.5 16.67 8.33 33.34 0 37.5-16.67 4.17-4.16 4.17-8.33 4.17-16.66v-58.34c0-12.5-12.5-29.16-25-37.5zM1229.17 295.83c-16.67-8.33-33.34 0-37.5 16.67-4.17 4.17-4.17 8.33-4.17 16.67v58.33c0 16.67 12.5 33.33 25 41.67 325 116.66 491.67 479.16 370.83 800-62.5 175-200 308.33-370.83 370.83-16.67 8.33-25 20.83-25 41.67V1700c0 16.67 8.33 29.17 25 33.33 4.17 0 12.5 0 16.67-4.16 395.83-125 612.5-545.84 487.5-941.67-75-237.5-258.34-416.67-487.5-491.67z" fill="#fff" />
      </g>
    </svg>
    `;
}

// 10. Bank Transfer / Off-Ramp: bank-3d-banner.png — Platinum Bank Medallion
function bankSvg() {
    return `
    <svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
      ${commonDefs}
      <linearGradient id="bankPlatinum" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="#ffffff" />
        <stop offset="40%" stop-color="#cbd5e1" />
        <stop offset="100%" stop-color="#64748b" />
      </linearGradient>
      <linearGradient id="bankRim" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="#ffffff" stop-opacity="0.95" />
        <stop offset="50%" stop-color="#94a3b8" stop-opacity="0.5" />
        <stop offset="100%" stop-color="#334155" stop-opacity="0.2" />
      </linearGradient>
      <g transform="translate(600, 195)" filter="url(#shadow)">
        <circle cx="0" cy="0" r="110" fill="url(#bankPlatinum)" stroke="url(#bankRim)" stroke-width="4" />
        <circle cx="0" cy="0" r="85" fill="#0f172a" opacity="0.85" />
        <!-- Bank Temple Pediment & Pillars -->
        <polygon points="0,-55 55,-25 -55,-25" fill="#ffffff" />
        <rect x="-45" y="-18" width="90" height="8" fill="#ffffff" />
        <rect x="-42" y="-5" width="14" height="42" fill="#ffffff" />
        <rect x="-17" y="-5" width="14" height="42" fill="#ffffff" />
        <rect x="8" y="-5" width="14" height="42" fill="#ffffff" />
        <rect x="33" y="-5" width="14" height="42" fill="#ffffff" />
        <rect x="-50" y="42" width="100" height="10" fill="#ffffff" />
      </g>
    </svg>
    `;
}

const chains = [
    { name: "eth-3d-banner.png", fn: ethSvg },
    { name: "solana-3d-banner.png", fn: solanaSvg },
    { name: "arc-3d-banner.png", fn: arcSvg },
    { name: "base-3d-banner.png", fn: baseSvg },
    { name: "arbitrum-3d-banner.png", fn: arbitrumSvg },
    { name: "polygon-3d-banner.png", fn: polygonSvg },
    { name: "avalanche-3d-banner.png", fn: avalancheSvg },
    { name: "optimism-3d-banner.png", fn: optimismSvg },
    { name: "usdc-3d-banner.png", fn: usdcSvg },
    { name: "bank-3d-banner.png", fn: bankSvg },
];

async function main() {
    console.log("Loading user background...");
    const bgBuffer = await sharp(userBgSrc).resize(width, height, { fit: "cover" }).toBuffer();

    for (const chain of chains) {
        console.log(`Generating ${chain.name}...`);
        const svgContent = chain.fn();
        const emblemBuffer = await sharp(Buffer.from(svgContent)).png().toBuffer();
        const outPath = path.join(outDir, chain.name);

        await sharp(bgBuffer)
            .composite([{ input: emblemBuffer, blend: "over" }])
            .png({ quality: 100 })
            .toFile(outPath);
        console.log(` -> Saved ${outPath}`);
    }

    console.log("\nAll 10 authentic chain banners generated successfully!");
}

main().catch(console.error);
