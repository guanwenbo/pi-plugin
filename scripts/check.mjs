#!/usr/bin/env node
/**
 * scripts/check.mjs — PI-Desktop 插件的离线预检（零依赖）。
 *
 * 覆盖的是「会让 installer 直接拒绝」和「装上了也跑不对」的规则：
 *   manifest 必填字段 / id 与版本格式 / 贡献的文件必须存在且不越出插件目录 /
 *   permissions 与 fs、net 声明自洽 / fs.write 与 fs.delete 不得声明整树 /
 *   技能 front matter、数量与体积上限 / 打包约束（文件数、总大小、不许有符号链接）。
 *
 * 用法：
 *   node scripts/check.mjs                 # 检查 plugins/* 与 templates/*
 *   node scripts/check.mjs plugins/foo     # 只检查指定目录（可多个）
 *
 * 退出码：0 = 无错误（警告不影响），1 = 有错误。
 *
 * 注意：PI-Desktop 内置的 PluginCheck 是权威校验，这个脚本是无依赖的离线等价物，
 * 方便在终端和 CI 里跑；两者结论不一致时以内置的为准。
 */

import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(HERE, "..");

export const LIMITS = {
  maxFiles: 2000,
  maxBytes: 50 * 1024 * 1024,
  maxSkills: 32,
  maxSkillBytes: 128 * 1024,
  maxSkillDescription: 240,
};

/** 打包时排除的目录与文件，和官方 packer 保持一致。 */
export const SKIP_DIRS = new Set([".git", "node_modules", "dist"]);
export const SKIP_FILES = new Set([".DS_Store", "Thumbs.db"]);
/**
 * 只排除「插件根目录」里的开发用文件，子目录里的同名文件要保留——
 * vendor 进来的 runtime/package.json（如 archify 的 Archify 3.2.0）是 ESM 依赖的一部分，
 * 全局排除会把它一起删掉。插件运行只认 manifest.json，根 package.json 从不加载。
 */
export const SKIP_ROOT_FILES = new Set([
  "package.json",
  "package-lock.json",
  "npm-shrinkwrap.json",
  "yarn.lock",
  "pnpm-lock.yaml",
]);

/** 宿主认识的权限名。未知的只报警告，因为宿主版本可能更新。 */
export const PERMISSION_RISK = {
  "net.fetch": "high",
  "fs.write": "high",
  "fs.delete": "high",
  "agent.prompt.inject": "high",
  "agent.tool.register": "high",
  "agent.complete": "high",
  "renderer.extension": "high",
  "session.read": "high",
  "mcp.server.local": "high",
  "mcp.server.remote": "high",
  "agent.extension": "high",
  "fs.read": "medium",
  "clipboard.read": "medium",
  "clipboard.write": "medium",
  "shell.openExternal": "medium",
  "background.service": "medium",
  "bus.publish": "medium",
  "bus.subscribe": "medium",
  "models.list": "medium",
  "usage.read": "medium",
  "ui.panel": "low",
  "ui.theme": "low",
  notify: "low",
  // 旧命名：仍能加载，但宿主会把范围降到「什么都不能」。
  "fs.read.workspace": "legacy",
  "fs.write.workspace": "legacy",
  "fs.delete.workspace": "legacy",
};

const ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/;
const SEMVER_PATTERN = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

/** 递归收集文件；不跟随符号链接，遇到就单独记下来。 */
export function collectFiles(dir, base = dir, acc = { files: [], symlinks: [] }) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const abs = path.join(dir, entry.name);
    const rel = path.relative(base, abs).split(path.sep).join("/");
    if (entry.isSymbolicLink()) {
      acc.symlinks.push(rel);
      continue;
    }
    if (entry.isDirectory()) {
      collectFiles(abs, base, acc);
      continue;
    }
    if (!entry.isFile()) continue;
    if (SKIP_FILES.has(entry.name)) continue;
    // 插件根目录的开发用文件不进包：package.json 的 "type": "module" 会让宿主
    // 按 ESM 解析 CJS 的 main.js（报 require is not defined），lock 文件纯属累赘。
    if (dir === base && SKIP_ROOT_FILES.has(entry.name)) continue;
    if (entry.name.endsWith(".piplug")) continue;
    acc.files.push({ rel, abs, size: statSync(abs).size });
  }
  return acc;
}

function isInside(parent, child) {
  const rel = path.relative(parent, child);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

function readJson(file, errors) {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch (error) {
    errors.push(`manifest.json 不是合法 JSON：${error.message}`);
    return null;
  }
}

/** 极简 front matter 解析：只认顶层 `key: value`，够用且不会把正文吃掉。 */
export function parseFrontMatter(text) {
  const normalized = text.replace(/^\uFEFF/, "");
  const lines = normalized.split(/\r?\n/);
  if (lines[0]?.trim() !== "---") return null;
  const close = lines.findIndex((line, index) => index > 0 && line.trim() === "---");
  if (close === -1) return null;
  const fields = {};
  for (const line of lines.slice(1, close)) {
    const match = /^([A-Za-z0-9_-]+)\s*:\s*(.*)$/.exec(line);
    if (!match) continue;
    let value = match[2].trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    fields[match[1]] = value;
  }
  return fields;
}

function isWholeTreeScope(scope) {
  return scope.some((raw) => {
    const pattern = String(raw).trim().replace(/^\.\//, "").replace(/\/+$/, "");
    return pattern === "*" || pattern === "**" || pattern === "**/*" || pattern === "*/*";
  });
}

function asStringArray(value) {
  if (!Array.isArray(value)) return [];
  return value.filter((item) => typeof item === "string");
}

/**
 * 校验一个插件目录。
 * @returns {{ dir: string, id: string|null, errors: string[], warnings: string[], stats: object }}
 */
export function validatePlugin(dirInput) {
  const dir = path.resolve(dirInput);
  const errors = [];
  const warnings = [];
  const result = { dir, id: null, errors, warnings, stats: null };

  const manifestPath = path.join(dir, "manifest.json");
  if (!existsSync(manifestPath)) {
    errors.push("缺少 manifest.json");
    return result;
  }

  const manifest = readJson(manifestPath, errors);
  if (!manifest) return result;
  result.id = typeof manifest.id === "string" ? manifest.id : null;

  // —— 必填字段 ——
  for (const key of ["schemaVersion", "id", "name", "version", "main"]) {
    if (manifest[key] === undefined || manifest[key] === null || manifest[key] === "") {
      errors.push(`缺少必填字段 \`${key}\``);
    }
  }
  if (manifest.schemaVersion !== undefined && manifest.schemaVersion !== 1) {
    errors.push(`schemaVersion 必须是 1，当前是 ${JSON.stringify(manifest.schemaVersion)}`);
  }
  if (typeof manifest.id === "string" && !ID_PATTERN.test(manifest.id)) {
    errors.push(
      `id \`${manifest.id}\` 不合法：只能包含字母、数字、点、下划线、连字符，且必须以字母或数字开头`,
    );
  }
  if (typeof manifest.id === "string" && !manifest.id.startsWith("local.") && !manifest.id.startsWith("io.github.")) {
    warnings.push(`个人插件建议用 \`local.<你的名字>.<名字>\` 命名，当前是 \`${manifest.id}\``);
  }
  if (typeof manifest.version === "string" && !SEMVER_PATTERN.test(manifest.version)) {
    errors.push(`version \`${manifest.version}\` 不是 semver（形如 0.1.0）`);
  }

  // —— 贡献路径都要存在且在插件目录内 ——
  const declaredPaths = [];
  const addPath = (value, label) => {
    if (typeof value !== "string" || !value.trim()) {
      errors.push(`${label} 必须是非空字符串路径`);
      return;
    }
    declaredPaths.push({ value, label });
  };
  if (manifest.main !== undefined) addPath(manifest.main, "main");
  if (manifest.ui?.panel !== undefined) addPath(manifest.ui.panel, "ui.panel");
  if (manifest.renderer !== undefined) addPath(manifest.renderer, "renderer");

  const contributes = manifest.contributes ?? {};
  for (const [index, item] of (Array.isArray(contributes.skills) ? contributes.skills : []).entries()) {
    if (typeof item === "string") addPath(item, `contributes.skills[${index}]`);
    else errors.push(`contributes.skills[${index}] 必须是字符串路径`);
  }
  for (const [index, item] of (Array.isArray(contributes.themes) ? contributes.themes : []).entries()) {
    const value = typeof item === "string" ? item : item?.path;
    if (typeof value === "string") addPath(value, `contributes.themes[${index}]`);
    else errors.push(`contributes.themes[${index}] 必须带路径`);
  }

  for (const { value, label } of declaredPaths) {
    if (path.isAbsolute(value)) {
      errors.push(`${label} 必须是相对路径，当前是 \`${value}\``);
      continue;
    }
    const abs = path.resolve(dir, value);
    if (!isInside(dir, abs)) {
      errors.push(`${label} \`${value}\` 越出了插件目录`);
      continue;
    }
    if (!existsSync(abs)) errors.push(`${label} \`${value}\` 指向的文件不存在`);
  }

  // —— 权限 ——
  const permissions = asStringArray(manifest.permissions);
  if (manifest.permissions !== undefined && !Array.isArray(manifest.permissions)) {
    errors.push("permissions 必须是数组");
  }
  for (const permission of permissions) {
    if (!(permission in PERMISSION_RISK)) {
      warnings.push(`未知权限 \`${permission}\`（宿主版本可能更新，确认拼写）`);
    } else if (PERMISSION_RISK[permission] === "legacy") {
      warnings.push(`\`${permission}\` 是旧命名，宿主会把范围降级为「什么都不能」，改用 \`${permission.split(".").slice(0, 2).join(".")}\` + manifest.fs`);
    }
  }

  const has = (permission) => permissions.includes(permission);
  const fsBlock = manifest.fs ?? {};

  for (const mode of ["read", "write", "delete"]) {
    const block = fsBlock[mode];
    if (block === undefined) continue;
    const permission = `fs.${mode}`;
    if (!has(permission) && !has(`${permission}.workspace`)) {
      errors.push(`manifest.fs.${mode} 声明了范围，但 permissions 里没有 \`${permission}\``);
    }
  }

  for (const mode of ["write", "delete"]) {
    const scope = asStringArray(fsBlock[mode]?.scope);
    if (scope.length && isWholeTreeScope(scope)) {
      errors.push(`manifest.fs.${mode}.scope 不能声明整树（${scope.join(", ")}）：写入和删除必须有具体范围`);
    }
    if (!scope.length && fsBlock[mode]?.own !== true && fsBlock[mode] !== undefined) {
      const root = fsBlock[mode]?.root;
      if (root !== "userSelected") {
        warnings.push(`manifest.fs.${mode} 既没有 scope 也没有 own:true，实际什么都${mode === "write" ? "写" : "删"}不了`);
      }
    }
  }

  if (has("fs.read") && fsBlock.read === undefined) {
    warnings.push("声明了 fs.read 但没有 manifest.fs.read，读文件时会逐次弹用户授权");
  }

  // —— 网络 ——
  const domains = asStringArray(manifest.net?.domains);
  if (has("net.fetch") && !domains.length) {
    errors.push("声明了 net.fetch 但 manifest.net.domains 为空：等于出不了网，装了也没用");
  }
  if (domains.length && !has("net.fetch")) {
    warnings.push("manifest.net.domains 有内容但没有 net.fetch 权限，声明不生效");
  }

  // —— 技能 ——
  const skills = asStringArray(contributes.skills);
  if (skills.length && !has("agent.prompt.inject")) {
    warnings.push("contributes.skills 需要 agent.prompt.inject 权限，否则这些文件会被静默忽略");
  }
  if (skills.length > LIMITS.maxSkills) {
    errors.push(`技能数量 ${skills.length} 超过上限 ${LIMITS.maxSkills}`);
  }
  for (const skillRef of skills.slice(0, LIMITS.maxSkills)) {
    const abs = path.resolve(dir, skillRef);
    if (!isInside(dir, abs) || !existsSync(abs)) continue; // 上面已报过
    const text = readFileSync(abs, "utf8");
    const bytes = Buffer.byteLength(text, "utf8");
    if (bytes > LIMITS.maxSkillBytes) {
      errors.push(`技能 \`${skillRef}\` ${(bytes / 1024).toFixed(1)}KiB 超过上限 ${LIMITS.maxSkillBytes / 1024}KiB`);
    }
    const fields = parseFrontMatter(text);
    if (!fields) {
      errors.push(`技能 \`${skillRef}\` 缺少 \`---\` front matter 块`);
      continue;
    }
    if (!fields.name) errors.push(`技能 \`${skillRef}\` 的 front matter 缺少 name`);
    if (!fields.description) {
      errors.push(`技能 \`${skillRef}\` 的 front matter 缺少 description（模型靠它决定何时加载）`);
    } else if (fields.description.length > LIMITS.maxSkillDescription) {
      errors.push(
        `技能 \`${skillRef}\` 的 description ${fields.description.length} 字符，超过 ${LIMITS.maxSkillDescription}`,
      );
    }
  }

  // —— 打包约束 ——
  const { files, symlinks } = collectFiles(dir);
  const totalBytes = files.reduce((sum, file) => sum + file.size, 0);
  result.stats = { files: files.length, bytes: totalBytes, skills: skills.length, permissions };

  if (symlinks.length) {
    errors.push(`包含符号链接，installer 会拒：${symlinks.join(", ")}`);
  }
  if (files.length > LIMITS.maxFiles) {
    errors.push(`文件数 ${files.length} 超过上限 ${LIMITS.maxFiles}`);
  }
  if (totalBytes > LIMITS.maxBytes) {
    errors.push(`总大小 ${(totalBytes / 1024 / 1024).toFixed(1)}MB 超过上限 ${LIMITS.maxBytes / 1024 / 1024}MB`);
  }

  return result;
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KiB`;
  return `${(bytes / 1024 / 1024).toFixed(1)}MiB`;
}

/** 递归找出「含 manifest.json 的目录」：支持 plugins/<分类>/<插件>/ 两层结构。 */
export function findPluginDirs(root, depth = 0, acc = []) {
  if (depth > 3 || !existsSync(root)) return acc;
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    if (SKIP_DIRS.has(entry.name)) continue;
    const dir = path.join(root, entry.name);
    if (existsSync(path.join(dir, "manifest.json"))) {
      acc.push(dir);
      continue;
    }
    findPluginDirs(dir, depth + 1, acc);
  }
  return acc;
}

function defaultTargets() {
  const targets = [
    ...findPluginDirs(path.join(REPO_ROOT, "plugins")),
    ...findPluginDirs(path.join(REPO_ROOT, "templates")),
  ];
  return targets.sort();
}

function main() {
  const args = process.argv.slice(2).filter((arg) => !arg.startsWith("-"));
  const targets = args.length ? args.map((arg) => path.resolve(REPO_ROOT, arg)) : defaultTargets();

  if (!targets.length) {
    console.log("没有找到任何插件目录（plugins/<分类>/<插件>/ 或 templates/<模板>/ 里要有 manifest.json）。");
    return 0;
  }

  let failed = 0;
  let warned = 0;
  for (const target of targets) {
    const label = path.relative(REPO_ROOT, target) || target;
    const report = validatePlugin(target);
    const stats = report.stats;
    const head = `${report.id ?? "(no id)"}  ${label}`;
    if (report.errors.length) {
      failed += 1;
      console.log(`✗ ${head}`);
    } else if (report.warnings.length) {
      warned += 1;
      console.log(`! ${head}`);
    } else {
      console.log(`✓ ${head}`);
    }
    if (stats) {
      console.log(
        `  ${stats.files} 个文件 / ${formatBytes(stats.bytes)} / ${stats.skills} 个技能 / 权限 ${stats.permissions.length}`,
      );
    }
    for (const error of report.errors) console.log(`  error   ${error}`);
    for (const warning of report.warnings) console.log(`  warning ${warning}`);
  }

  console.log(
    `\n${targets.length} 个目录：${targets.length - failed} 通过，${failed} 有错误，${warned} 有警告。`,
  );
  return failed ? 1 : 0;
}

const invokedDirectly =
  process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (invokedDirectly) process.exit(main());
