import fs from "fs";
import path from "path";
import sharp from "sharp";

const ROOT = process.cwd();
const COLORED_SRC = path.join(ROOT, "Subscript Logo colored background.png");
const TRANS_SRC = path.join(ROOT, "Subscript Logo transparent background.png");
const PUBLIC_DIR = path.join(ROOT, "public");

function createGradientSquare(size) {
  const bg = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    const t = y / (size - 1);
    const baseR = 32 + (58 - 32) * t;
    const baseG = 47 + (71 - 47) * t;
    const baseB = 64 + (84 - 64) * t;
    for (let x = 0; x < size; x++) {
      const idx = (y * size + x) * 4;
      const dx = (x - size / 2) / (size / 2);
      const dy = (y - size / 2) / (size / 2);
      const dist = Math.min(1, Math.sqrt(dx * dx + dy * dy));
      const glow = (1 - dist) * 8;
      bg[idx] = Math.round(Math.min(255, baseR + glow));
      bg[idx + 1] = Math.round(Math.min(255, baseG + glow));
      bg[idx + 2] = Math.round(Math.min(255, baseB + glow));
      bg[idx + 3] = 255;
    }
  }
  return bg;
}

async function generateBrandAssets() {
  console.log("Generating brand assets from source logos...");

  // 1. Trimmed transparent logo
  const trimmedTransBuf = await sharp(TRANS_SRC)
    .trim()
    .toBuffer();

  const trimmedMeta = await sharp(trimmedTransBuf).metadata();
  console.log(`Trimmed transparent logo: ${trimmedMeta.width}x${trimmedMeta.height}`);

  // Save public/logo-transparent.png (trimmed)
  await sharp(trimmedTransBuf)
    .png({ quality: 100, compressionLevel: 9 })
    .toFile(path.join(PUBLIC_DIR, "logo-transparent.png"));
  console.log("Created public/logo-transparent.png");

  // 2. Square centered logo (public/logo.png) - 256x256 transparent square
  const scale = 200 / trimmedMeta.height;
  const targetW = Math.round(trimmedMeta.width * scale);
  const targetH = 200;
  const resizedMark = await sharp(trimmedTransBuf)
    .resize(targetW, targetH, {
      fit: "contain",
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .toBuffer();

  await sharp({
    create: {
      width: 256,
      height: 256,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite([
      {
        input: resizedMark,
        top: Math.round((256 - targetH) / 2),
        left: Math.round((256 - targetW) / 2),
      },
    ])
    .png({ quality: 100, compressionLevel: 9 })
    .toFile(path.join(PUBLIC_DIR, "logo.png"));
  console.log("Created public/logo.png (256x256 square transparent)");

  // 3. public/logo-colored.png - 256x256 square brand tile
  const colBg256 = createGradientSquare(256);
  const colMarkH = 180;
  const colMarkW = Math.round(trimmedMeta.width * (colMarkH / trimmedMeta.height));
  const colResizedMark = await sharp(trimmedTransBuf)
    .resize(colMarkW, colMarkH, {
      fit: "contain",
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .toBuffer();

  await sharp(colBg256, { raw: { width: 256, height: 256, channels: 4 } })
    .composite([
      {
        input: colResizedMark,
        top: Math.round((256 - colMarkH) / 2),
        left: Math.round((256 - colMarkW) / 2),
      },
    ])
    .png({ quality: 100, compressionLevel: 9 })
    .toFile(path.join(PUBLIC_DIR, "logo-colored.png"));
  console.log("Created public/logo-colored.png (256x256 square brand tile)");

  // 4. Square colored backgrounds for PWA and App icons (512x512)
  const bg512 = createGradientSquare(512);
  const mark512H = 360;
  const mark512W = Math.round(trimmedMeta.width * (mark512H / trimmedMeta.height));
  const mark512Resized = await sharp(trimmedTransBuf)
    .resize(mark512W, mark512H, {
      fit: "contain",
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .toBuffer();

  const icon512Buf = await sharp(bg512, { raw: { width: 512, height: 512, channels: 4 } })
    .composite([
      {
        input: mark512Resized,
        top: Math.round((512 - mark512H) / 2),
        left: Math.round((512 - mark512W) / 2),
      },
    ])
    .png({ quality: 100 })
    .toBuffer();

  await fs.promises.writeFile(path.join(PUBLIC_DIR, "icon-512.png"), icon512Buf);
  console.log("Created public/icon-512.png");

  // 5. Maskable icon 512x512 (with safe-zone: mark fits in central 60% of canvas)
  const maskableScale = (512 * 0.6) / trimmedMeta.height;
  const maskW = Math.round(trimmedMeta.width * maskableScale);
  const maskH = Math.round(512 * 0.6);
  const maskMark = await sharp(trimmedTransBuf)
    .resize(maskW, maskH, {
      fit: "contain",
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .toBuffer();

  await sharp(bg512, { raw: { width: 512, height: 512, channels: 4 } })
    .composite([
      {
        input: maskMark,
        top: Math.round((512 - maskH) / 2),
        left: Math.round((512 - maskW) / 2),
      },
    ])
    .png({ quality: 100 })
    .toFile(path.join(PUBLIC_DIR, "icon-maskable-512.png"));
  console.log("Created public/icon-maskable-512.png");

  // 6. icon-192.png
  await sharp(icon512Buf)
    .resize(192, 192, { fit: "contain" })
    .png()
    .toFile(path.join(PUBLIC_DIR, "icon-192.png"));
  console.log("Created public/icon-192.png");

  // 7. apple-touch-icon.png (180x180)
  await sharp(icon512Buf)
    .resize(180, 180, { fit: "contain" })
    .png()
    .toFile(path.join(PUBLIC_DIR, "apple-touch-icon.png"));
  console.log("Created public/apple-touch-icon.png");

  // 8. favicon-48x48.png
  const fav48Buf = await sharp(icon512Buf)
    .resize(48, 48, { fit: "contain" })
    .png()
    .toBuffer();
  await fs.promises.writeFile(path.join(PUBLIC_DIR, "favicon-48x48.png"), fav48Buf);
  console.log("Created public/favicon-48x48.png");

  // 9. Multi-resolution favicon.ico (16, 32, 48)
  const fav16Buf = await sharp(icon512Buf).resize(16, 16, { fit: "contain" }).png().toBuffer();
  const fav32Buf = await sharp(icon512Buf).resize(32, 32, { fit: "contain" }).png().toBuffer();

  const icoBuf = buildIco([
    { width: 16, height: 16, data: fav16Buf },
    { width: 32, height: 32, data: fav32Buf },
    { width: 48, height: 48, data: fav48Buf },
  ]);
  await fs.promises.writeFile(path.join(PUBLIC_DIR, "favicon.ico"), icoBuf);
  console.log("Created public/favicon.ico");

  console.log("All brand assets generated successfully!");
}

function buildIco(images) {
  const count = images.length;
  const headerLen = 6;
  const dirEntryLen = 16;
  let offset = headerLen + count * dirEntryLen;

  const header = Buffer.alloc(headerLen);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // ICO type
  header.writeUInt16LE(count, 4);

  const dirEntries = [];
  for (const img of images) {
    const entry = Buffer.alloc(dirEntryLen);
    entry.writeUInt8(img.width === 256 ? 0 : img.width, 0);
    entry.writeUInt8(img.height === 256 ? 0 : img.height, 1);
    entry.writeUInt8(0, 2); // color palette
    entry.writeUInt8(0, 3); // reserved
    entry.writeUInt16LE(1, 4); // color planes
    entry.writeUInt16LE(32, 6); // bits per pixel
    entry.writeUInt32LE(img.data.length, 8); // image size
    entry.writeUInt32LE(offset, 12); // image offset
    dirEntries.push(entry);
    offset += img.data.length;
  }

  return Buffer.concat([header, ...dirEntries, ...images.map((img) => img.data)]);
}

generateBrandAssets().catch((err) => {
  console.error("Asset generation error:", err);
  process.exit(1);
});
