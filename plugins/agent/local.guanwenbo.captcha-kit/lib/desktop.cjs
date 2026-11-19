/**
 * Captcha Kit — macOS 桌面通道：screencapture 截图 + Quartz 键鼠。
 * 截图像素为物理像素；点击/拖拽坐标为屏幕逻辑点。scale = 像素/点（Retina=2）。
 * Windows 桌面请走 computer-use 插件（本模块直接拒绝并指路）。
 */
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { execFile } = require("node:child_process");
const env = require("./env.cjs");
const { tmpFile } = require("./recognize.cjs");

function assertDarwin() {
  if (process.platform !== "darwin") {
    throw new Error("captcha_desktop is macOS only. On Windows use the computer-use plugin (screenshot + mouse/keyboard via cua-driver); recognition tools work on both.");
  }
}

/** PNG IHDR 宽高（免依赖）。 */
function pngSize(file) {
  const fd = fs.openSync(file, "r");
  try {
    const buf = Buffer.alloc(24);
    fs.readSync(fd, buf, 0, 24, 0);
    if (buf.readUInt32BE(0) !== 0x89504e47) return null;
    return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
  } finally { fs.closeSync(fd); }
}

function screencapture(savePath, region) {
  return new Promise((resolve, reject) => {
    const args = ["-x"];
    if (region) args.push("-R", `${region.x},${region.y},${region.width},${region.height}`);
    args.push(savePath);
    execFile("/usr/sbin/screencapture", args, { timeout: 15000 }, (err) => {
      if (err) return reject(new Error(`screencapture failed: ${err.message} (grant Screen Recording permission to PI-Desktop if denied)`));
      resolve();
    });
  });
}

async function desktop(args) {
  assertDarwin();
  const action = String(args?.action || "");

  if (action === "screenshot") {
    const savePath = String(args?.savePath || tmpFile("desktop"));
    fs.mkdirSync(path.dirname(savePath), { recursive: true });
    const region = args?.region && Number.isFinite(Number(args.region.x)) ? {
      x: Number(args.region.x), y: Number(args.region.y),
      width: Number(args.region.width), height: Number(args.region.height),
    } : null;
    await screencapture(savePath, region);
    const size = pngSize(savePath);
    let scale = null;
    if (env.venvExists()) {
      try { scale = (await env.runWorker("scale", {}, { timeoutMs: 20000 })).scale; } catch { /* 环境未就绪时给降级提示 */ }
    }
    const origin = region ? { x: region.x, y: region.y } : { x: 0, y: 0 };
    return {
      content: [{
        type: "text",
        text: JSON.stringify({
          saved: savePath, pixels: size, region: region || "full screen", scale,
          mapping: scale
            ? `screen_point_x = ${origin.x} + image_x / ${scale}; screen_point_y = ${origin.y} + image_y / ${scale}`
            : "scale unknown (runtime not ready) — run captcha_env setup first; on Retina assume scale=2",
          next: "pass saved path to captcha_recognize; map image-pixel coordinates to screen points with the formula, then captcha_desktop click/drag/type",
        }, null, 2),
      }],
    };
  }

  if (!env.venvExists()) throw new Error("runtime not ready: call captcha_env action=setup first (Quartz input needs the venv)");

  if (action === "click") {
    const r = await env.runWorker("click", { x: Number(args?.x), y: Number(args?.y) }, { timeoutMs: 20000 });
    return { content: [{ type: "text", text: JSON.stringify(r) }] };
  }
  if (action === "drag") {
    const points = Array.isArray(args?.points) ? args.points : null;
    if (!points || points.length < 2) throw new Error("drag requires points: absolute screen-point coordinates [{x,y,t}] (convert a captcha_slide_track relative track by adding the start point)");
    const r = await env.runWorker("drag", { points }, { timeoutMs: 60000 });
    return { content: [{ type: "text", text: JSON.stringify(r) }] };
  }
  if (action === "type") {
    const r = await env.runWorker("type", { text: String(args?.text ?? "") }, { timeoutMs: 20000 });
    return { content: [{ type: "text", text: JSON.stringify(r) }] };
  }
  throw new Error(`unknown action: ${action} (use screenshot|click|drag|type)`);
}

module.exports = { desktop };