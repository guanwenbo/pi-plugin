#!/usr/bin/env node
/**
 * scripts/pack.mjs — 把插件目录打成可安装的 `.piplug`（零依赖）。
 *
 * `.piplug` 就是 **store-only（不压缩）的 zip**：installer 会拒绝 deflate 条目，
 * 所以这里手写 ZIP 结构（method = 0），不用 `zip` / `tar`。
 *
 * 打完之后脚本会把产物读回来逐条校验（方法位、CRC32、字节数），
 * 校验不过就删掉产物并以退出码 1 结束。
 *
 * 用法：
 *   node scripts/pack.mjs plugins/local.guanwenbo.my-tool
 *   node scripts/pack.mjs templates/panel --out /tmp/piplugs
 *
 * 打包前会先跑一遍 scripts/check.mjs 的校验，有 error 直接拒绝打包。
 *
 * 注意：PI-Desktop 内置的 PluginPack 是权威打包器；这个脚本是无依赖的离线等价物，
 * 给终端和 CI 用。
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync, rmSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { REPO_ROOT, LIMITS, collectFiles, validatePlugin } from "./check.mjs";

// —— CRC32 ——
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

/** 固定的 DOS 时间戳（1980-01-01），让同一个目录每次打出来的字节一致。 */
/** 固定时间戳（全 0）：官方 packer 就是这么写的，同一个目录每次打出来的字节完全一致。 */
const DOS_TIME = 0;
const DOS_DATE = 0;
/**
 * 生成 store-only zip。
 * @param {{ rel: string, abs: string }[]} files
 * @returns {Buffer}
 */
export function buildStoreOnlyZip(files) {
  const entries = files
    .map((file) => ({ rel: file.rel, data: readFileSync(file.abs) }))
    .sort((a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0));

  const locals = [];
  const centrals = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBytes = Buffer.from(entry.rel, "utf8");
    // 文件名全是 ASCII 时不置 UTF-8 标志位，字节输出与官方 packer 完全一致；
    // 名字里有中文等非 ASCII 字符时才置位，避免解包端按 CP437 解析。
    const flags = /[^\x00-\x7f]/.test(entry.rel) ? 0x0800 : 0;
    const crc = crc32(entry.data);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); // 局部文件头签名
    local.writeUInt16LE(20, 4); // 解压所需版本
    local.writeUInt16LE(flags, 6); // 通用标志位：文件名是否 UTF-8
    local.writeUInt16LE(0, 8); // 压缩方法：0 = store
    local.writeUInt16LE(DOS_TIME, 10);
    local.writeUInt16LE(DOS_DATE, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(entry.data.length, 18); // 压缩后大小（store 时等于原始大小）
    local.writeUInt32LE(entry.data.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    local.writeUInt16LE(0, 28); // 扩展字段长度
    locals.push(local, nameBytes, entry.data);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0); // 中央目录签名
    central.writeUInt16LE(20, 4); // 生成者：MS-DOS / 2.0（与官方 packer 一致）
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(flags, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt16LE(DOS_TIME, 12);
    central.writeUInt16LE(DOS_DATE, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(entry.data.length, 20);
    central.writeUInt32LE(entry.data.length, 24);
    central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt16LE(0, 30); // 扩展字段
    central.writeUInt16LE(0, 32); // 注释
    central.writeUInt16LE(0, 34); // 起始磁盘号
    central.writeUInt16LE(0, 36); // 内部属性
    central.writeUInt32LE(0, 38); // 外部属性：与官方 packer 一致（不写 POSIX 权限位）
    central.writeUInt32LE(offset, 42);
    centrals.push(central, nameBytes);

    offset += local.length + nameBytes.length + entry.data.length;
  }

  const centralBuffer = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0); // 中央目录结束签名
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralBuffer.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([...locals, centralBuffer, eocd]);
}

/**
 * 把产物读回来校验：必须是 store-only，且每条数据的 CRC32 与记录一致。
 * @param {Buffer} buffer
 * @returns {{ entries: number, bytes: number }}
 */
export function verifyStoreOnlyZip(buffer) {
  const eocdOffset = buffer.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (eocdOffset === -1) throw new Error("找不到中央目录结束记录（EOCD），不是合法 zip");
  const entriesTotal = buffer.readUInt16LE(eocdOffset + 10);
  const centralSize = buffer.readUInt32LE(eocdOffset + 12);
  const centralOffset = buffer.readUInt32LE(eocdOffset + 16);
  if (centralOffset + centralSize > buffer.length) throw new Error("中央目录越界，不是合法 zip");

  let cursor = centralOffset;
  let payloadBytes = 0;
  for (let index = 0; index < entriesTotal; index += 1) {
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

    if (method !== 0) throw new Error(`条目 ${name} 用了压缩（method=${method}），installer 会拒绝`);
    if (compressedSize !== uncompressedSize) throw new Error(`条目 ${name} 压缩前后大小不一致`);

    if (buffer.readUInt32LE(localOffset) !== 0x04034b50) {
      throw new Error(`条目 ${name} 的局部文件头签名错误`);
    }
    const dataStart = localOffset + 30 + buffer.readUInt16LE(localOffset + 26) + buffer.readUInt16LE(localOffset + 28);
    const data = buffer.subarray(dataStart, dataStart + uncompressedSize);
    if (data.length !== uncompressedSize) throw new Error(`条目 ${name} 数据被截断`);
    if (crc32(data) !== crc) throw new Error(`条目 ${name} 的 CRC32 不匹配`);

    payloadBytes += uncompressedSize;
    cursor += 46 + nameLength + extraLength + commentLength;
  }

  return { entries: entriesTotal, bytes: payloadBytes };
}

function usage() {
  console.log(
    [
      "用法：node scripts/pack.mjs <插件目录> [--out <输出目录>]",
      "",
      "  <插件目录>      含 manifest.json 的目录，例如 plugins/local.guanwenbo.my-tool",
      "  --out <目录>    产物目录，默认 dist/",
      "",
      "产物：<输出目录>/<id>-<version>.piplug（store-only zip）",
    ].join("\n"),
  );
}

function main() {
  const argv = process.argv.slice(2);
  if (!argv.length || argv.includes("-h") || argv.includes("--help")) {
    usage();
    return argv.length ? 0 : 1;
  }

  let outDir = path.join(REPO_ROOT, "dist");
  const positional = [];
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--out") {
      const value = argv[index + 1];
      if (!value) {
        console.error("--out 之后要跟一个目录");
        return 1;
      }
      outDir = path.resolve(REPO_ROOT, value);
      index += 1;
      continue;
    }
    if (arg.startsWith("--out=")) {
      outDir = path.resolve(REPO_ROOT, arg.slice("--out=".length));
      continue;
    }
    positional.push(arg);
  }

  if (positional.length !== 1) {
    console.error("一次只打一个插件目录。");
    usage();
    return 1;
  }

  const pluginDir = path.resolve(REPO_ROOT, positional[0]);
  if (!existsSync(path.join(pluginDir, "manifest.json"))) {
    console.error(`✗ ${positional[0]} 里没有 manifest.json`);
    return 1;
  }

  const report = validatePlugin(pluginDir);
  if (report.errors.length) {
    console.error(`✗ 校验没通过，不打包：${positional[0]}`);
    for (const error of report.errors) console.error(`  error   ${error}`);
    console.error("  先跑 `node scripts/check.mjs` 把错误修掉。");
    return 1;
  }
  for (const warning of report.warnings) console.warn(`  warning ${warning}`);

  const manifest = JSON.parse(readFileSync(path.join(pluginDir, "manifest.json"), "utf8"));
  const { files, symlinks } = collectFiles(pluginDir);
  if (symlinks.length) {
    console.error(`✗ 含符号链接，installer 会拒：${symlinks.join(", ")}`);
    return 1;
  }
  if (files.length > LIMITS.maxFiles) {
    console.error(`✗ 文件数 ${files.length} 超过上限 ${LIMITS.maxFiles}`);
    return 1;
  }

  const archive = buildStoreOnlyZip(files);
  if (archive.length > LIMITS.maxBytes) {
    console.error(`✗ 产物 ${archive.length} 字节超过上限 ${LIMITS.maxBytes}`);
    return 1;
  }

  mkdirSync(outDir, { recursive: true });
  const target = path.join(outDir, `${manifest.id}-${manifest.version}.piplug`);
  writeFileSync(target, archive);

  try {
    const verified = verifyStoreOnlyZip(readFileSync(target));
    if (verified.entries !== files.length) {
      throw new Error(`条目数 ${verified.entries} 与文件数 ${files.length} 不一致`);
    }
  } catch (error) {
    rmSync(target, { force: true });
    console.error(`✗ 产物自检失败，已删除：${error.message}`);
    return 1;
  }

  console.log(`✓ ${manifest.id}@${manifest.version}`);
  console.log(`  ${files.length} 个文件 / ${(archive.length / 1024).toFixed(1)}KiB / store-only zip（已回读校验 CRC）`);
  console.log(`  → ${path.relative(REPO_ROOT, target) || target}`);
  console.log(`  （${path.relative(process.cwd(), target) || target}）`);
  return 0;
}

const invokedDirectly =
  process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (invokedDirectly) process.exit(main());
