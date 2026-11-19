/**
 * Captcha Kit 验证码助手 — PI-Desktop plugin entry.
 *
 * 五个 Agent 工具：
 *   captcha_env          识别环境自检 / 后台安装（ddddocr venv）
 *   captcha_recognize    字符 OCR / 滑块缺口 / 点选辅助（原图+网格回传视觉模型）
 *   captcha_slide_track  类人拖拽轨迹生成
 *   captcha_browser      工作面板浏览器：截验证码图 / 拖拽 / 点击 / 填写（pi.browser.cdp）
 *   captcha_desktop      macOS 桌面：截图 / 点击 / 拖拽 / 键入（screencapture + Quartz）
 *
 * 仅用于用户拥有或已获授权的站点/环境；技能文档规定授权前置与重试上限。
 */
"use strict";

const env = require("./lib/env.cjs");
const { recognize } = require("./lib/recognize.cjs");
const { generateTrack } = require("./lib/track.cjs");
const { browser } = require("./lib/browser.cjs");
const { desktop } = require("./lib/desktop.cjs");

const TOOLS = [
  {
    name: "captcha_env",
    description:
      "Check or install the local captcha recognition runtime (private Python venv with ddddocr at ~/.pi-desktop/captcha-kit/venv). " +
      "action=check returns ready/probe info; action=setup starts a background pip install (returns immediately, poll check every ~20s). " +
      "Optional index overrides the pip mirror (default: Tsinghua TUNA). Call check before any recognition; if not ready, run setup once.",
    risk: "high",
    schema: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["check", "setup"] },
        index: { type: "string", description: "Optional pip index URL for setup." },
      },
      required: ["action"],
    },
    execute: async (args) => {
      const action = String(args?.action || "check");
      if (action === "check") return { content: [{ type: "text", text: JSON.stringify(await env.check(), null, 2) }] };
      if (action === "setup") return { content: [{ type: "text", text: JSON.stringify(env.setup(args || {}), null, 2) }] };
      throw new Error(`unknown action: ${action}`);
    },
  },
  {
    name: "captcha_recognize",
    description:
      "Recognize a captcha image file. type=text: local ddddocr OCR returns the character string. " +
      "type=slide: mode=match needs path (background with gap) + target (slider piece image); mode=comparison needs path (with gap) + background (without gap); returns gap x/y in background-image pixels. " +
      "type=click: attaches the original image plus a coordinate-grid copy — YOU (the vision model) must read them and output ordered click points in original-image pixels; pass the captcha's instruction via prompt. " +
      "Only for sites you own or are authorized to test. Requires captcha_env ready.",
    risk: "medium",
    schema: {
      type: "object",
      properties: {
        type: { type: "string", enum: ["text", "slide", "click"] },
        path: { type: "string", description: "Captcha image file path (png/jpg/jpeg/webp/gif/bmp, <=10MB)." },
        mode: { type: "string", enum: ["match", "comparison"], description: "Slide mode (default match)." },
        target: { type: "string", description: "Slider piece image path (slide mode=match)." },
        background: { type: "string", description: "Full background WITHOUT gap (slide mode=comparison)." },
        prompt: { type: "string", description: "Click-task instruction, e.g. 请依次点击：猫、汽车 (type=click)." },
        step: { type: "number", description: "Grid step px for click assist (default 50)." },
      },
      required: ["type", "path"],
    },
    execute: recognize,
  },
  {
    name: "captcha_slide_track",
    description:
      "Generate a human-like slider drag trajectory: relative offsets [{x,y,t}] from the start point (t = ms wait before this move), " +
      "with ease-out, slight overshoot-and-return and tiny vertical jitter. Feed points to captcha_browser drag (relative) or convert to absolute screen points for captcha_desktop drag.",
    risk: "low",
    schema: {
      type: "object",
      properties: {
        distance: { type: "number", description: "Horizontal drag distance in page/screen units." },
        duration: { type: "number", description: "Total ms (300–4000, default 900)." },
      },
      required: ["distance"],
    },
    execute: async (args) => ({
      content: [{ type: "text", text: JSON.stringify(generateTrack(args?.distance, { duration: args?.duration }), null, 2) }],
    }),
  },
  {
    name: "captcha_browser",
    description:
      "Operate a captcha in the work-panel browser via host CDP. action=capture {selector,savePath?}: save the captcha element image (canvas export, screenshot fallback) and return rect + pixel→CSS mapping. " +
      "action=drag {x,y,track}: drag from (x,y) along a captcha_slide_track relative track. action=click {x,y}: click page CSS pixels. action=fill {selector,text}: focus+select+insert text. " +
      "All coordinates are page CSS pixels (viewport). A page must be open in the work-panel browser. Only for authorized sites.",
    risk: "high",
    schema: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["capture", "drag", "click", "fill"] },
        selector: { type: "string", description: "CSS selector (capture/fill)." },
        savePath: { type: "string", description: "Where to save the captured image (capture)." },
        x: { type: "number" }, y: { type: "number" },
        track: { type: "array", items: { type: "object" }, description: "Relative trajectory from captcha_slide_track (drag)." },
        text: { type: "string", description: "Text to fill (fill)." },
      },
      required: ["action"],
    },
    execute: browser,
  },
  {
    name: "captcha_desktop",
    description:
      "macOS desktop captcha channel. action=screenshot {savePath?,region?}: screencapture full screen or region (points), returns pixel size + scale + pixel→point mapping. " +
      "action=click {x,y} / action=type {text} / action=drag {points:[{x,y,t}] absolute screen points}: Quartz mouse/keyboard (needs Accessibility permission for PI-Desktop). " +
      "macOS only — on Windows use the computer-use plugin for desktop operation. Only for authorized apps/sites.",
    risk: "high",
    schema: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["screenshot", "click", "drag", "type"] },
        savePath: { type: "string" },
        region: { type: "object", description: "Optional {x,y,width,height} in screen points (screenshot)." },
        x: { type: "number" }, y: { type: "number" },
        points: { type: "array", items: { type: "object" }, description: "Absolute screen-point trajectory (drag)." },
        text: { type: "string", description: "Text to type (type)." },
      },
      required: ["action"],
    },
    execute: desktop,
  },
];

async function onLoad() {
  const pi = globalThis.pi;
  if (!pi) throw new Error("captcha-kit: globalThis.pi missing at onLoad");
  for (const tool of TOOLS) await pi.agent.registerTool(tool);
}

async function onUnload() {
  const pi = globalThis.pi;
  if (!pi?.agent) return;
  for (const tool of TOOLS) {
    try { await pi.agent.unregisterTool(tool.name); } catch { /* 宿主回收 */ }
  }
}

module.exports = { onLoad, onUnload };