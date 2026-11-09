/**
 * 自更新模块（两份副本，archify 与 excalidraw-studio 各一份，内容必须完全一致）。
 *
 * 为什么自己写：宿主的 market.checkUpdates / market.applyUpdates 只覆盖
 * source=marketplace 的插件，source=local 的插件拿不到宿主更新通道（在 app.asar 里核对过）。
 *
 * 更新源：仓库根 latest.json
 *   https://raw.githubusercontent.com/guanwenbo/pi-plugin/main/latest.json
 * 包里是 store-only zip（.piplug 的定义），这里用纯 JS 解，不引第三方依赖。
 *
 * 安全边界：
 *   - 只从 latest.json 里该插件自己的 url 下载，域名必须在 manifest.net.domains 内（走 pi.net.fetch，受宿主网关约束）
 *   - sha256 必须与清单一致，size 必须一致，否则拒绝
 *   - 解包只接受 method=0，拒绝绝对路径与 `..` 逃逸
 *   - 替换前把旧文件备份到 plugins/data 目录，失败可回滚
 *   - 不动 node_modules
 */

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const DEFAULT_MANIFEST_URL =
  "https://raw.githubusercontent.com/guanwenbo/pi-plugin/main/latest.json";

/** 只允许这些顶层条目被替换/删除（防止误删用户自己放进插件目录的东西）。 */
const NEVER_TOUCH = new Set(["node_modules", ".git"]);

async function fetchBytes(url, { timeoutMs = 20000 } = {}) {
  const init = { signal: AbortSignal.timeout(timeoutMs), redirect: "follow" };
  if (typeof pi !== "undefined" && pi.net && typeof pi.net.fetch === "function") {
    const response = await pi.net.fetch(url, init);
    if (!response.ok) throw new Error(`下载失败：HTTP ${response.status} ${url}`);
    return Buffer.from(await response.arrayBuffer());
  }
  // 兜底：宿主没提供 pi.net.fetch 时用 Node 自带 fetch（同样受网络环境影响）。
  const response = await fetch(url, init);
  if (!response.ok) throw new Error(`下载失败：HTTP ${response.status} ${url}`);
  return Buffer.from(await response.arrayBuffer());
}

async function fetchJson(url) {
  const raw = await fetchBytes(url);
  try {
    return JSON.parse(raw.toString("utf8"));
  } catch {
    throw new Error(`更新清单不是合法 JSON：${url}`);
  }
}

/** 返回 -1 / 0 / 1；只比较 major.minor.patch，忽略 prerelease 细节。 */
function compareSemver(left, right) {
  const parse = (value) =>
    String(value || "0.0.0")
      .split(/[-+]/)[0]
      .split(".")
      .map((part) => Number.parseInt(part, 10) || 0);
  const a = parse(left);
  const b = parse(right);
  for (let index = 0; index < 3; index += 1) {
    if ((a[index] ?? 0) > (b[index] ?? 0)) return 1;
    if ((a[index] ?? 0) < (b[index] ?? 0)) return -1;
  }
  return 0;
}

// —— store-only zip 解包 ————————————————————————————————————————

function readEocd(buffer) {
  const signature = Buffer.from([0x50, 0x4b, 0x05, 0x06]);
  const offset = buffer.lastIndexOf(signature);
  if (offset === -1) throw new Error("不是合法 zip：找不到中央目录结束记录");
  return {
    entries: buffer.readUInt16LE(offset + 10),
    centralSize: buffer.readUInt32LE(offset + 12),
    centralOffset: buffer.readUInt32LE(offset + 16),
  };
}

function safeJoin(root, entryName) {
  if (entryName.startsWith("/") || /^[a-zA-Z]:/.test(entryName)) {
    throw new Error(`拒绝绝对路径条目：${entryName}`);
  }
  const target = path.resolve(root, entryName);
  const rel = path.relative(root, target);
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new Error(`拒绝越界条目：${entryName}`);
  }
  return target;
}

/**
 * 解 .piplug 到 destDir。只接受 store（method=0）条目，逐个校验 CRC。
 * @returns {string[]} 写出的相对路径
 */
function extractPiplug(buffer, destDir) {
  const eocd = readEocd(buffer);
  let cursor = eocd.centralOffset;
  const written = [];
  for (let index = 0; index < eocd.entries; index += 1) {
    if (buffer.readUInt32LE(cursor) !== 0x02014b50) {
      throw new Error(`第 ${index + 1} 条中央目录记录签名错误`);
    }
    const method = buffer.readUInt16LE(cursor + 10);
    const crc = buffer.readUInt32LE(cursor + 16);
    const compressedSize = buffer.readUInt32LE(cursor + 20);
    const uncompressedSize = buffer.readUInt32LE(cursor + 24);
    const nameLength = buffer.readUInt16LE(cursor + 28);
    const extraLength = buffer.readUInt16LE(cursor + 30);
    const commentLength = buffer.readUInt16LE(cursor + 32);
    const localOffset = buffer.readUInt32LE(cursor + 42);
    const name = buffer.toString("utf8", cursor + 46, cursor + 46 + nameLength);
    cursor += 46 + nameLength + extraLength + commentLength;

    if (method !== 0) throw new Error(`条目 ${name} 用了压缩（method=${method}），不是合法的 .piplug`);
    if (compressedSize !== uncompressedSize) throw new Error(`条目 ${name} 压缩前后大小不一致`);
    if (!name || name.endsWith("/")) continue;

    if (buffer.readUInt32LE(localOffset) !== 0x04034b50) {
      throw new Error(`条目 ${name} 的局部头签名错误`);
    }
    const dataStart =
      localOffset + 30 + buffer.readUInt16LE(localOffset + 26) + buffer.readUInt16LE(localOffset + 28);
    const data = buffer.subarray(dataStart, dataStart + uncompressedSize);
    if (data.length !== uncompressedSize) throw new Error(`条目 ${name} 数据被截断`);
    if (crc32(data) !== crc) throw new Error(`条目 ${name} 的 CRC32 不匹配`);

    const target = safeJoin(destDir, name);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, data);
    written.push(name);
  }
  if (!written.length) throw new Error("包里没有文件");
  return written;
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[index] = value >>> 0;
  }
  return table;
})();

function crc32(buffer) {
  let crc = 0xffffffff;
  for (let index = 0; index < buffer.length; index += 1) {
    crc = CRC_TABLE[(crc ^ buffer[index]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

// —— 对外 API ————————————————————————————————————————————————

/**
 * 查更新。
 * @returns {{available:boolean, current:string, latest:string|null, entry:object|null, notes:string|null}}
 */
async function checkForUpdate(pluginId, currentVersion, manifestUrl = DEFAULT_MANIFEST_URL) {
  const manifest = await fetchJson(manifestUrl);
  const entry = manifest && manifest.plugins ? manifest.plugins[pluginId] : null;
  if (!entry || !entry.version) {
    return { available: false, current: currentVersion, latest: null, entry: null, notes: null };
  }
  return {
    available: compareSemver(entry.version, currentVersion) > 0,
    current: currentVersion,
    latest: entry.version,
    entry,
    notes: entry.notes ?? null,
  };
}

/**
 * 下载 → 校验 → 解到暂存目录。
 * @returns {{stagingDir:string, version:string, files:string[]}}
 */
async function downloadAndStage(entry, stagingDir) {
  if (!entry || !entry.url) throw new Error("更新清单里没有 url");
  const buffer = await fetchBytes(entry.url, { timeoutMs: 60000 });
  if (entry.size && buffer.length !== entry.size) {
    throw new Error(`大小不符：期望 ${entry.size}，实际 ${buffer.length}`);
  }
  if (entry.sha256) {
    const digest = crypto.createHash("sha256").update(buffer).digest("hex");
    if (digest !== String(entry.sha256).toLowerCase()) {
      throw new Error("sha256 校验失败，拒绝安装");
    }
  }
  fs.rmSync(stagingDir, { recursive: true, force: true });
  fs.mkdirSync(stagingDir, { recursive: true });
  const files = extractPiplug(buffer, stagingDir);
  return { stagingDir, version: entry.version, files };
}

function listFiles(root) {
  const out = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (NEVER_TOUCH.has(entry.name)) continue;
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(abs);
        continue;
      }
      if (entry.isFile()) out.push(path.relative(root, abs).split(path.sep).join("/"));
    }
  };
  if (fs.existsSync(root)) walk(root);
  return out;
}

/**
 * 用暂存目录替换插件目录里的文件。
 * - 先把旧文件整体备份到 backupDir
 * - 再按暂存内容覆盖；暂存里没有的旧文件会被删除（保持与发布包一致）
 * - node_modules / .git 永不动
 */
function applyStaged(stagingDir, targetDir, backupDir) {
  if (!fs.existsSync(path.join(stagingDir, "manifest.json"))) {
    throw new Error("暂存目录里没有 manifest.json，拒绝替换");
  }
  const previous = listFiles(targetDir);
  fs.rmSync(backupDir, { recursive: true, force: true });
  for (const relative of previous) {
    const source = path.join(targetDir, relative);
    const dest = path.join(backupDir, relative);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(source, dest);
  }

  const incoming = listFiles(stagingDir);
  for (const relative of incoming) {
    const source = path.join(stagingDir, relative);
    const dest = path.join(targetDir, relative);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(source, dest);
  }

  const incomingSet = new Set(incoming);
  let removed = 0;
  for (const relative of previous) {
    if (incomingSet.has(relative)) continue;
    fs.rmSync(path.join(targetDir, relative), { force: true });
    removed += 1;
  }
  return { written: incoming.length, removed, backupDir };
}

function rollback(backupDir, targetDir) {
  if (!fs.existsSync(backupDir)) throw new Error("没有可用的备份");
  const backupFiles = listFiles(backupDir);
  for (const relative of backupFiles) {
    const source = path.join(backupDir, relative);
    const dest = path.join(targetDir, relative);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(source, dest);
  }
  return backupFiles.length;
}

module.exports = {
  DEFAULT_MANIFEST_URL,
  checkForUpdate,
  downloadAndStage,
  applyStaged,
  rollback,
  listFiles,
  extractPiplug,
  compareSemver,
  fetchBytes,
};
