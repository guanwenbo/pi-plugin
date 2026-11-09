#!/usr/bin/env node
/**
 * scripts/release.mjs — 发版：把插件打成 store-only .piplug 放进 releases/，并生成 latest.json。
 *
 * 这两个产物就是插件的更新通道：
 *   - 插件里的 updater.js 拉 https://raw.githubusercontent.com/<repo>/main/latest.json
 *   - 按 id 找到自己的版本；比当前新 → 下载 url、校验 sha256/size、解包替换自身文件
 * 所以 releases/ 下的 .piplug 必须提交进仓库（.gitignore 里给了例外）。
 *
 * 用法：
 *   node scripts/release.mjs                 # 发布 plugins/ 下所有插件
 *   node scripts/release.mjs <目录>...       # 只发布指定插件目录
 *   node scripts/release.mjs --notes "说明"  # 给本次发布的插件写一句更新说明
 */

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { REPO_ROOT, collectFiles, findPluginDirs, validatePlugin } from "./check.mjs";
import { buildStoreOnlyZip, verifyStoreOnlyZip } from "./pack.mjs";

const RELEASES_DIR = path.join(REPO_ROOT, "releases");
const LATEST_PATH = path.join(REPO_ROOT, "latest.json");
const RAW_BASE = "https://raw.githubusercontent.com/guanwenbo/pi-plugin/main";
const UPDATER_COPIES = [
  "plugins/diagram/local.guanwenbo.archify/updater.js",
  "plugins/diagram/local.guanwenbo.excalidraw-studio/updater.js",
];

function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

/** 附件里的 updater.js 必须完全一致，否则两份实现会漂。 */
function assertUpdaterCopiesIdentical() {
  const present = UPDATER_COPIES.filter((rel) => existsSync(path.join(REPO_ROOT, rel)));
  if (present.length < 2) return;
  const hashes = present.map((rel) => sha256(readFileSync(path.join(REPO_ROOT, rel))));
  if (new Set(hashes).size !== 1) {
    throw new Error(`updater.js 副本不一致，请先同步：\n${present.map((rel, i) => `  ${rel}  ${hashes[i].slice(0, 12)}`).join("\n")}`);
  }
}

function parseArgs(argv) {
  let notes = null;
  const dirs = [];
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--notes") {
      notes = argv[index + 1] ?? null;
      index += 1;
      continue;
    }
    dirs.push(arg);
  }
  return { notes, dirs };
}

function readPreviousManifest() {
  if (!existsSync(LATEST_PATH)) return { schemaVersion: 1, plugins: {} };
  try {
    const parsed = JSON.parse(readFileSync(LATEST_PATH, "utf8"));
    return { schemaVersion: parsed.schemaVersion ?? 1, plugins: parsed.plugins ?? {} };
  } catch {
    return { schemaVersion: 1, plugins: {} };
  }
}

function main() {
  const { notes, dirs } = parseArgs(process.argv.slice(2));
  assertUpdaterCopiesIdentical();

  const targets = dirs.length
    ? dirs.map((dir) => path.resolve(REPO_ROOT, dir))
    : findPluginDirs(path.join(REPO_ROOT, "plugins"));

  if (!targets.length) {
    console.error("没有找到可发布的插件（plugins/ 下没有 manifest.json）");
    return 1;
  }

  mkdirSync(RELEASES_DIR, { recursive: true });
  const previous = readPreviousManifest();
  const plugins = { ...previous.plugins };
  const published = [];

  for (const target of targets) {
    const report = validatePlugin(target);
    if (report.errors.length) {
      console.error(`✗ ${path.relative(REPO_ROOT, target)} 校验没通过，跳过：`);
      for (const error of report.errors) console.error(`    ${error}`);
      continue;
    }
    const manifest = JSON.parse(readFileSync(path.join(target, "manifest.json"), "utf8"));
    const { files, symlinks } = collectFiles(target);
    if (symlinks.length) {
      console.error(`✗ ${manifest.id} 含符号链接，跳过`);
      continue;
    }

    const archive = buildStoreOnlyZip(files);
    verifyStoreOnlyZip(archive);

    // 同一个插件只保留当前版本，避免 releases/ 越滚越大
    for (const name of readdirSync(RELEASES_DIR)) {
      if (name.startsWith(`${manifest.id}-`) && name.endsWith(".piplug")) {
        rmSync(path.join(RELEASES_DIR, name), { force: true });
      }
    }

    const fileName = `${manifest.id}-${manifest.version}.piplug`;
    writeFileSync(path.join(RELEASES_DIR, fileName), archive);

    plugins[manifest.id] = {
      version: manifest.version,
      url: `${RAW_BASE}/releases/${fileName}`,
      sha256: sha256(archive),
      size: archive.length,
      notes: notes ?? previous.plugins?.[manifest.id]?.notes ?? null,
    };
    published.push({ id: manifest.id, version: manifest.version, fileName, size: archive.length });
  }

  const latest = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    plugins,
  };
  writeFileSync(LATEST_PATH, `${JSON.stringify(latest, null, 2)}\n`);

  for (const item of published) {
    console.log(`✓ ${item.id}@${item.version}  ${(item.size / 1024 / 1024).toFixed(2)}MB  → releases/${item.fileName}`);
  }
  if (!published.length) console.log("没有发布任何插件。");
  console.log(`✓ latest.json（${Object.keys(plugins).length} 个插件条目）`);
  console.log("\n下一步：git add releases latest.json && git commit && git push（插件里的 updater 会读 main 分支上的 latest.json）");
  return published.length ? 0 : 1;
}

const invokedDirectly =
  process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (invokedDirectly) process.exit(main());
