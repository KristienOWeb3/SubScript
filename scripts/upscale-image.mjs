#!/usr/bin/env node
/**
 * Upscale one or more images with sharp (already a project dependency).
 *
 * Usage:
 *   node scripts/upscale-image.mjs <input...> [options]
 *
 * Inputs can be files or folders (folders are scanned for images, not recursively).
 *
 * Options:
 *   -s, --scale <n>      Scale factor (default 2). Ignored if --width/--height is set.
 *   -w, --width <px>     Target width. Height follows the aspect ratio unless --height is set.
 *   -h, --height <px>    Target height. Width follows the aspect ratio unless --width is set.
 *   -k, --kernel <name>  nearest | linear | cubic | mitchell | lanczos2 | lanczos3 (default lanczos3).
 *                        Use "nearest" for pixel art.
 *   --sharpen [sigma]    Light unsharp pass after resizing (default sigma 1 when given).
 *   -o, --out <path>     Output file (single input) or folder (multiple inputs).
 *                        Default: next to the input as name@<scale>x.ext
 *   -f, --format <fmt>   png | jpeg | webp | avif. Default keeps the input format.
 *   -q, --quality <n>    Quality for jpeg/webp/avif (default 92).
 *   --force              Overwrite existing output files.
 *
 * Examples:
 *   node scripts/upscale-image.mjs public/logo.png
 *   node scripts/upscale-image.mjs photo.jpg -s 4 --sharpen
 *   node scripts/upscale-image.mjs icons/ -w 1024 -o icons-big/ -f webp
 *   node scripts/upscale-image.mjs sprite.png -s 8 -k nearest
 */
import sharp from "sharp";
import { existsSync, mkdirSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

const IMAGE_EXTS = new Set([".png", ".jpg", ".jpeg", ".webp", ".avif", ".gif", ".tif", ".tiff"]);
const KERNELS = new Set(["nearest", "linear", "cubic", "mitchell", "lanczos2", "lanczos3"]);
const FORMATS = new Set(["png", "jpeg", "webp", "avif"]);

function fail(msg) {
  console.error(`Error: ${msg}`);
  process.exit(1);
}

function parseArgs(argv) {
  const opts = { scale: 2, kernel: "lanczos3", quality: 92, inputs: [], force: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => {
      const v = argv[++i];
      if (v === undefined) fail(`${a} needs a value`);
      return v;
    };
    switch (a) {
      case "-s": case "--scale": opts.scale = Number(next()); break;
      case "-w": case "--width": opts.width = parseInt(next(), 10); break;
      case "-h": case "--height": opts.height = parseInt(next(), 10); break;
      case "-k": case "--kernel": opts.kernel = next(); break;
      case "-o": case "--out": opts.out = next(); break;
      case "-f": case "--format": opts.format = next().toLowerCase().replace("jpg", "jpeg"); break;
      case "-q": case "--quality": opts.quality = parseInt(next(), 10); break;
      case "--force": opts.force = true; break;
      case "--sharpen": {
        const v = argv[i + 1];
        opts.sharpen = v !== undefined && !v.startsWith("-") && !Number.isNaN(Number(v)) ? Number(argv[++i]) : 1;
        break;
      }
      case "--help": printHelp(); process.exit(0);
      default:
        if (a.startsWith("-")) fail(`unknown option ${a}`);
        opts.inputs.push(a);
    }
  }

  if (!opts.inputs.length) { printHelp(); process.exit(1); }
  if (!(opts.scale > 0)) fail("--scale must be a positive number");
  if (opts.width !== undefined && !(opts.width > 0)) fail("--width must be a positive integer");
  if (opts.height !== undefined && !(opts.height > 0)) fail("--height must be a positive integer");
  if (!KERNELS.has(opts.kernel)) fail(`--kernel must be one of: ${[...KERNELS].join(", ")}`);
  if (opts.format && !FORMATS.has(opts.format)) fail(`--format must be one of: ${[...FORMATS].join(", ")}`);
  if (!(opts.quality >= 1 && opts.quality <= 100)) fail("--quality must be 1-100");
  return opts;
}

function printHelp() {
  console.log("Usage: node scripts/upscale-image.mjs <input...> [-s scale | -w px | -h px] [-k kernel] [--sharpen [sigma]] [-o out] [-f format] [-q quality] [--force]");
  console.log("Run with no arguments or see the header of this file for details.");
}

function collectFiles(inputs) {
  const files = [];
  for (const input of inputs) {
    if (!existsSync(input)) fail(`not found: ${input}`);
    if (statSync(input).isDirectory()) {
      for (const name of readdirSync(input)) {
        const full = path.join(input, name);
        if (statSync(full).isFile() && IMAGE_EXTS.has(path.extname(name).toLowerCase())) files.push(full);
      }
    } else {
      files.push(input);
    }
  }
  if (!files.length) fail("no images found in the given inputs");
  return files;
}

function outputPath(file, opts, multi, label) {
  const ext = opts.format ? `.${opts.format === "jpeg" ? "jpg" : opts.format}` : path.extname(file);
  const base = path.basename(file, path.extname(file));
  if (opts.out) {
    const outIsDir = multi || opts.out.endsWith("/") || opts.out.endsWith("\\") ||
      (existsSync(opts.out) && statSync(opts.out).isDirectory());
    if (outIsDir) {
      mkdirSync(opts.out, { recursive: true });
      return path.join(opts.out, `${base}${ext}`);
    }
    mkdirSync(path.dirname(path.resolve(opts.out)), { recursive: true });
    return opts.out;
  }
  return path.join(path.dirname(file), `${base}@${label}${ext}`);
}

async function upscale(file, opts, multi) {
  const meta = await sharp(file).metadata();
  const srcW = meta.width, srcH = meta.height;

  let width, height;
  if (opts.width || opts.height) {
    width = opts.width ?? Math.round(srcW * (opts.height / srcH));
    height = opts.height ?? Math.round(srcH * (opts.width / srcW));
  } else {
    width = Math.round(srcW * opts.scale);
    height = Math.round(srcH * opts.scale);
  }

  const label = opts.width || opts.height ? `${width}x${height}` : `${opts.scale}x`;
  const out = outputPath(file, opts, multi, label);
  if (path.resolve(out) === path.resolve(file)) fail(`output would overwrite the input: ${file}`);
  if (existsSync(out) && !opts.force) {
    console.warn(`skip  ${file} -> ${out} (exists, use --force)`);
    return;
  }

  // animated: true keeps every frame of GIF/WebP animations.
  let img = sharp(file, { animated: true }).resize(width, height, {
    kernel: opts.kernel,
    fit: opts.width && opts.height ? "fill" : "inside",
  });
  if (opts.sharpen) img = img.sharpen({ sigma: opts.sharpen });

  const fmt = opts.format ?? (meta.format === "jpg" ? "jpeg" : meta.format);
  if (fmt === "jpeg") img = img.jpeg({ quality: opts.quality, mozjpeg: true });
  else if (fmt === "webp") img = img.webp({ quality: opts.quality });
  else if (fmt === "avif") img = img.avif({ quality: opts.quality });
  else if (fmt === "png") img = img.png({ compressionLevel: 9 });

  await img.toFile(out);
  console.log(`done  ${file} (${srcW}x${srcH}) -> ${out} (${width}x${height})`);
}

const opts = parseArgs(process.argv.slice(2));
const files = collectFiles(opts.inputs);
let failed = 0;
for (const file of files) {
  try {
    await upscale(file, opts, files.length > 1);
  } catch (err) {
    failed++;
    console.error(`fail  ${file}: ${err.message}`);
  }
}
if (failed) process.exit(1);
