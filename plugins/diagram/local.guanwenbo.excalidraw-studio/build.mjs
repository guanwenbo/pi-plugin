#!/usr/bin/env node
/**
 * 把 Excalidraw 面板打成一个自包含的前端包，产物全部落在 renderer/：
 *   renderer/app.js          src/panel.jsx 的打包结果（含 React、Excalidraw）
 *   renderer/app.css         面板自己的样式（来自 src/styles.css）
 *   renderer/excalidraw.css  Excalidraw 官方样式（从包里拷出来）
 *   renderer/fonts/          画布字体（不含 12MB 的 Xiaolai）
 *
 * 产物已提交进仓库，安装插件不需要构建。改了 src/ 之后跑 `node build.mjs`。
 */

import { build, context } from "esbuild";
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const RENDERER = path.join(HERE, "renderer");
const PKG_DIST = path.join(HERE, "node_modules/@excalidraw/excalidraw/dist/prod");

/** 12MB 的中文字体不打包：中文回落到系统字体，画布照样显示。 */
const SKIP_FONTS = new Set(["Xiaolai"]);

const OPTIONS = {
  entryPoints: [path.join(HERE, "src/panel.jsx")],
  outfile: path.join(RENDERER, "app.js"),
  bundle: true,
  format: "iife",
  target: ["chrome120"],
  jsx: "automatic",
  minify: true,
  sourcemap: false,
  legalComments: "none",
  define: { "process.env.NODE_ENV": '"production"' },
  logLevel: "warning",
};

function copyFile(from, to, label) {
  if (!existsSync(from)) {
    console.warn(`! 缺少 ${label}（先 npm install）`);
    return false;
  }
  cpSync(from, to);
  return true;
}

function copyFonts() {
  const source = path.join(PKG_DIST, "fonts");
  if (!existsSync(source)) {
    console.warn("! 缺少 Excalidraw 字体目录（先 npm install）");
    return 0;
  }
  const target = path.join(RENDERER, "fonts");
  rmSync(target, { recursive: true, force: true });
  mkdirSync(target, { recursive: true });
  let copied = 0;
  for (const name of readdirSync(source)) {
    if (SKIP_FONTS.has(name)) continue;
    cpSync(path.join(source, name), path.join(target, name), { recursive: true });
    copied += 1;
  }
  return copied;
}

async function main() {
  mkdirSync(RENDERER, { recursive: true });

  if (process.argv.includes("--watch")) {
    const ctx = await context(OPTIONS);
    await ctx.watch();
    console.log("watching src/ …（改完请再手动拷一次 css / fonts，或重跑不带 --watch）");
    return;
  }

  await build(OPTIONS);
  const css = copyFile(path.join(PKG_DIST, "index.css"), path.join(RENDERER, "excalidraw.css"), "Excalidraw 样式");
  const fonts = copyFonts();
  const size = statSync(path.join(RENDERER, "app.js")).size;

  console.log(`✓ renderer/app.js  ${(size / 1024 / 1024).toFixed(2)}MB`);
  console.log(`✓ excalidraw.css   ${css ? "已拷贝" : "缺失"}`);
  console.log(`✓ renderer/fonts   ${fonts} 个字体目录`);
}

await main();
