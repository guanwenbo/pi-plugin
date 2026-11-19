/**
 * Captcha Kit — 识别核心。
 * text/slide 走本地 ddddocr worker；click 无本地引擎，回传原图+坐标网格图，
 * 由会话视觉模型直接看图给出点击坐标（技能里规定输出格式）。
 */
"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const env = require("./env.cjs");

const MIME = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", gif: "image/gif", bmp: "image/bmp" };

function mimeOf(p) {
  return MIME[path.extname(p).slice(1).toLowerCase()] || null;
}

function assertImage(p, label) {
  if (!p || typeof p !== "string") throw new Error(`${label} is required (image file path)`);
  if (!fs.existsSync(p)) throw new Error(`${label} not found: ${p}`);
  if (!mimeOf(p)) throw new Error(`${label} unsupported type (png/jpg/jpeg/webp/gif/bmp): ${p}`);
  const size = fs.statSync(p).size;
  if (size > 10 * 1024 * 1024) throw new Error(`${label} too large (>10MB): ${p}`);
}

function imageBlock(p) {
  return { type: "image", mimeType: mimeOf(p), data: fs.readFileSync(p).toString("base64") };
}

function tmpFile(prefix, ext = ".png") {
  const dir = path.join(os.tmpdir(), "captcha-kit");
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1e6)}${ext}`);
}

async function recognize(args) {
  const type = String(args?.type || "text");
  const imgPath = String(args?.path || "");
  assertImage(imgPath, "path");
  if (!env.venvExists()) throw new Error("runtime not ready: call captcha_env action=setup first, then poll action=check");

  if (type === "text") {
    const r = await env.runWorker("ocr", { path: imgPath });
    return {
      content: [{
        type: "text",
        text: JSON.stringify({ type: "text", text: r.text, image: imgPath, note: "ddddocr usually returns lowercase; many sites are case-insensitive — if rejected, retry with uppercase. OCR may be wrong; verify after submit, refresh and retry on failure (max 3)." }, null, 2),
      }],
    };
  }

  if (type === "slide") {
    const mode = String(args?.mode || "match");
    let r;
    if (mode === "match") {
      assertImage(args?.target, "target (slider piece image)");
      r = await env.runWorker("slide_match", { background: imgPath, target: args.target });
    } else if (mode === "comparison") {
      assertImage(args?.background, "background (full image WITHOUT gap)");
      r = await env.runWorker("slide_compare", { with_gap: imgPath, without_gap: args.background });
    } else {
      throw new Error(`unknown slide mode: ${mode} (use match|comparison)`);
    }
    return {
      content: [{
        type: "text",
        text: JSON.stringify({
          type: "slide", mode, x: r.x, y: r.y, semantics: r.semantics, confidence: r.confidence ?? null,
          note: "x/y are the GAP CENTER in background-image pixels (ddddocr >=1.6 semantics). Drag distance = (gap_center_x - slider_piece_initial_center_x) * (displayed background width / background image pixel width). Low confidence (<0.4) means a dubious match — re-capture cleaner images or retry.",
        }, null, 2),
      }],
    };
  }

  if (type === "click") {
    const gridPath = tmpFile("grid");
    const g = await env.runWorker("grid", { path: imgPath, out: gridPath, step: args?.step || 50 });
    const prompt = String(args?.prompt || "identify the targets required by the captcha");
    const instruction = [
      `Click-type captcha. Task: ${prompt}.`,
      `Image pixel size: ${g.width}x${g.height}. Two images attached: (1) original, (2) same image with a magenta coordinate grid every ${g.step}px (labels are ORIGINAL-image pixel coordinates).`,
      `Look at both images and answer with a JSON array of click points IN ORDER, in ORIGINAL image pixels, e.g. [{"x":123,"y":45},...]. Use the grid to estimate coordinates precisely; aim at each target's center.`,
      `Then map to page/screen coordinates before acting (see capture/screenshot result for the mapping), and click each point in order.`,
    ].join("\n");
    return {
      content: [
        { type: "text", text: instruction },
        imageBlock(imgPath),
        imageBlock(gridPath),
      ],
    };
  }

  throw new Error(`unknown captcha type: ${type} (use text|slide|click)`);
}

module.exports = { recognize, assertImage, imageBlock, mimeOf, tmpFile };