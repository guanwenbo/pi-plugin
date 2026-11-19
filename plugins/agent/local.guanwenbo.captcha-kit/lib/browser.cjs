/**
 * Captcha Kit — 工作面板浏览器操作（宿主 pi.browser.cdp 通道）。
 * capture: 截取验证码元素图片（canvas 导出优先，Page.captureScreenshot 兜底）
 * drag/click/fill: CDP Input 事件。坐标均为页面 CSS 像素（视口坐标）。
 */
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { tmpFile } = require("./recognize.cjs");

function cdp(method, params) {
  const pi = globalThis.pi;
  if (!pi?.browser?.cdp) throw new Error("pi.browser.cdp unavailable — open a page in the work-panel browser first, and ensure browser.cdp permission is granted");
  return pi.browser.cdp({ method, params });
}

async function evaluate(expression) {
  const r = await cdp("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (r?.exceptionDetails) {
    throw new Error(`page evaluate failed: ${r.exceptionDetails.exception?.description || r.exceptionDetails.text}`);
  }
  return r?.result?.value;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 截验证码元素：返回 {savePath, rect, dpr, naturalWidth, naturalHeight} */
async function capture(args) {
  const selector = String(args?.selector || "");
  if (!selector) throw new Error("capture requires selector (CSS selector of the captcha img/canvas/container)");
  const info = await evaluate(`(() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    if (!el) return { error: "selector not found" };
    const r = el.getBoundingClientRect();
    const img = el.tagName === "IMG" ? el : el.querySelector("img");
    const canvas = el.tagName === "CANVAS" ? el : el.querySelector("canvas");
    let dataUrl = null, naturalWidth = null, naturalHeight = null;
    const src = img || canvas;
    if (src) {
      naturalWidth = src.naturalWidth || src.width;
      naturalHeight = src.naturalHeight || src.height;
      try {
        const c = document.createElement("canvas");
        c.width = naturalWidth; c.height = naturalHeight;
        c.getContext("2d").drawImage(src, 0, 0);
        dataUrl = c.toDataURL("image/png");
      } catch (e) { /* cross-origin taint → screenshot fallback */ }
    }
    return { rect: { x: r.x, y: r.y, width: r.width, height: r.height }, dpr: devicePixelRatio || 1, naturalWidth, naturalHeight, dataUrl };
  })()`);
  if (!info || info.error) throw new Error(`capture: ${info?.error || "no result"} (selector=${selector})`);
  if (!(info.rect.width > 0 && info.rect.height > 0)) throw new Error("capture: element has zero size — is it visible?");

  let base64 = null;
  if (info.dataUrl && info.dataUrl.startsWith("data:image/png;base64,")) {
    base64 = info.dataUrl.slice("data:image/png;base64,".length);
  } else {
    // 兜底：CDP 截图（宿主 allowlist 可能拒绝，拒绝则报错并给出替代路径）
    try {
      const shot = await cdp("Page.captureScreenshot", {
        format: "png",
        clip: { x: info.rect.x, y: info.rect.y, width: info.rect.width, height: info.rect.height, scale: 1 },
      });
      base64 = shot?.data || null;
    } catch (e) {
      throw new Error(`capture: canvas export tainted and Page.captureScreenshot unavailable (${e.message}). Save the captcha image manually (right-click / drag to disk) and pass its path to captcha_recognize.`);
    }
  }
  if (!base64) throw new Error("capture: no image data obtained");
  const savePath = String(args?.savePath || tmpFile("browser-captcha"));
  fs.mkdirSync(path.dirname(savePath), { recursive: true });
  fs.writeFileSync(savePath, Buffer.from(base64, "base64"));
  const nw = info.naturalWidth || Math.round(info.rect.width * info.dpr);
  const nh = info.naturalHeight || Math.round(info.rect.height * info.dpr);
  return {
    content: [{
      type: "text",
      text: JSON.stringify({
        saved: savePath, rect: info.rect, dpr: info.dpr, imagePixels: { width: nw, height: nh },
        mapping: `page_css_x = rect.x + image_x * rect.width / ${nw}; page_css_y = rect.y + image_y * rect.height / ${nh}`,
        next: "pass saved path to captcha_recognize; map resulting image-pixel coordinates with the formula above before captcha_browser click/drag",
      }, null, 2),
    }],
  };
}

/** 沿相对轨迹拖拽：起点 (x,y) + track [{x,y,t}]（相对偏移） */
async function drag(args) {
  const x = Number(args?.x), y = Number(args?.y);
  const track = Array.isArray(args?.track) ? args.track : null;
  if (!Number.isFinite(x) || !Number.isFinite(y)) throw new Error("drag requires numeric x,y (page CSS pixels of the slider handle center)");
  if (!track || track.length < 2) throw new Error("drag requires track (generate with captcha_slide_track)");
  await cdp("Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
  await sleep(60);
  await cdp("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", buttons: 1, clickCount: 1 });
  let cx = x, cy = y;
  for (const p of track.slice(1)) {
    cx = x + Number(p.x || 0);
    cy = y + Number(p.y || 0);
    const t = Math.min(Math.max(Number(p.t) || 16, 0), 500);
    if (t) await sleep(t);
    await cdp("Input.dispatchMouseEvent", { type: "mouseMoved", x: cx, y: cy, button: "left", buttons: 1 });
  }
  await sleep(120);
  await cdp("Input.dispatchMouseEvent", { type: "mouseReleased", x: cx, y: cy, button: "left", buttons: 0, clickCount: 1 });
  return { content: [{ type: "text", text: JSON.stringify({ dragged: { from: [x, y], to: [cx, cy], points: track.length } }) }] };
}

async function click(args) {
  const x = Number(args?.x), y = Number(args?.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) throw new Error("click requires numeric x,y (page CSS pixels)");
  await cdp("Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
  await sleep(40);
  await cdp("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", buttons: 1, clickCount: 1 });
  await sleep(60);
  await cdp("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", buttons: 0, clickCount: 1 });
  return { content: [{ type: "text", text: JSON.stringify({ clicked: [x, y] }) }] };
}

async function fill(args) {
  const selector = String(args?.selector || "");
  const text = String(args?.text ?? "");
  if (!selector) throw new Error("fill requires selector");
  const ok = await evaluate(`(() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    if (!el) return "selector not found";
    el.focus();
    if (el.select) el.select();
    return null;
  })()`);
  if (ok) throw new Error(`fill: ${ok}`);
  await cdp("Input.insertText", { text });
  return { content: [{ type: "text", text: JSON.stringify({ filled: selector, length: text.length }) }] };
}

async function browser(args) {
  const action = String(args?.action || "");
  switch (action) {
    case "capture": return capture(args);
    case "drag": return drag(args);
    case "click": return click(args);
    case "fill": return fill(args);
    default: throw new Error(`unknown action: ${action} (use capture|drag|click|fill)`);
  }
}

module.exports = { browser };