#!/usr/bin/env node
/**
 * scripts/new.mjs — 从 templates/ 复制一个新插件到 plugins/<分类>/<插件 id>/。
 *
 * 只做三件事：复制目录、改写 manifest 的 id / name、提示还需手工改的地方。
 * 不做命令 id 之类的字符串替换——那些得你自己想清楚叫什么。
 *
 * 用法：
 *   node scripts/new.mjs agent-tool dev/local.guanwenbo.my-tool
 *   node scripts/new.mjs panel writing/local.guanwenbo.my-panel --name "我的面板"
 *   node scripts/new.mjs skill-pack local.guanwenbo.my-skill-pack   # 不给分类 → misc
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, copyFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { REPO_ROOT, collectFiles } from "./check.mjs";

const ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/;
const DEFAULT_CATEGORY = "misc";

function listTemplates() {
  const dir = path.join(REPO_ROOT, "templates");
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && existsSync(path.join(dir, entry.name, "manifest.json")))
    .map((entry) => entry.name);
}

/** 分类 = plugins/ 下「本身不是插件」的一级目录。 */
function listCategories() {
  const dir = path.join(REPO_ROOT, "plugins");
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .filter((entry) => !existsSync(path.join(dir, entry.name, "manifest.json")))
    .map((entry) => entry.name);
}

function usage() {
  console.log(
    [
      "用法：node scripts/new.mjs <模板名> [<分类>/]<插件 id> [--name <显示名>]",
      "",
      `  可用模板：${listTemplates().join(", ") || "(templates/ 里没有模板)"}`,
      `  可用分类：${listCategories().join(", ") || "(plugins/ 下没有分类目录)"}`,
      "",
      "  不给分类时落到 misc/。插件 id 以字母或数字开头，只含字母、数字、点、下划线、连字符，",
      "  个人插件统一 local.<你的名字>.<名字>。",
      "",
      "示例：node scripts/new.mjs panel dev/local.guanwenbo.my-dev-tool --name \"我的开发小工具\"",
    ].join("\n"),
  );
}

function copyTree(from, to) {
  mkdirSync(to, { recursive: true });
  for (const entry of readdirSync(from, { withFileTypes: true })) {
    const src = path.join(from, entry.name);
    const dest = path.join(to, entry.name);
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) {
      copyTree(src, dest);
      continue;
    }
    if (!entry.isFile()) continue;
    copyFileSync(src, dest);
  }
}

function main() {
  const argv = process.argv.slice(2);
  if (argv.length < 2 || argv.includes("-h") || argv.includes("--help")) {
    usage();
    return argv.length >= 2 ? 0 : 1;
  }

  const templateName = argv[0];
  let target = argv[1];
  let displayName = null;
  const nameFlag = argv.indexOf("--name");
  if (nameFlag !== -1) {
    const value = argv[nameFlag + 1];
    if (!value) {
      console.error("--name 之后要跟一个显示名");
      return 1;
    }
    displayName = value;
  }

  // <分类>/<插件 id> —— 只切第一个斜杠，插件 id 本身不含斜杠。
  let category = DEFAULT_CATEGORY;
  let pluginId = target;
  const slash = target.indexOf("/");
  if (slash !== -1) {
    category = target.slice(0, slash);
    pluginId = target.slice(slash + 1);
  }

  if (!ID_PATTERN.test(pluginId)) {
    console.error(`✗ 插件 id \`${pluginId}\` 不合法：只能包含字母、数字、点、下划线、连字符，且以字母或数字开头`);
    return 1;
  }
  if (!pluginId.startsWith("local.")) {
    console.warn(`  warning 个人插件建议以 local. 开头，当前是 \`${pluginId}\``);
  }

  const categories = listCategories();
  if (!categories.includes(category)) {
    console.error(`✗ 分类 \`plugins/${category}\` 不存在`);
    console.error(`  可用分类：${categories.join(", ") || "(无)"}`);
    console.error("  新建分类：mkdir -p plugins/<分类> && 写一个 README.md 说明放什么");
    return 1;
  }

  const templateDir = path.join(REPO_ROOT, "templates", templateName);
  if (!existsSync(path.join(templateDir, "manifest.json"))) {
    console.error(`✗ templates/${templateName} 不存在（或没有 manifest.json）`);
    usage();
    return 1;
  }

  const targetDir = path.join(REPO_ROOT, "plugins", category, pluginId);
  const relDir = path.posix.join("plugins", category, pluginId);
  if (existsSync(targetDir)) {
    console.error(`✗ ${relDir} 已存在，不覆盖`);
    return 1;
  }

  copyTree(templateDir, targetDir);

  const manifestPath = path.join(targetDir, "manifest.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const previousId = manifest.id;
  manifest.id = pluginId;
  manifest.name = displayName ?? pluginId;
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

  const { files } = collectFiles(targetDir);
  console.log(`✓ 已创建 ${relDir}（来自 templates/${templateName}）`);
  console.log(`  分类：${category}`);
  console.log(`  id:   ${pluginId}`);
  console.log(`  name: ${manifest.name}`);

  // 提示还没改的地方：命令 id、工具名一般还带着模板前缀。
  const leftovers = files
    .filter((file) => /\.(json|js|mjs|md|html)$/.test(file.rel))
    .filter((file) => readFileSync(file.abs, "utf8").includes(templateName))
    .map((file) => file.rel)
    .filter((rel) => rel !== "manifest.json");
  if (leftovers.length) {
    console.log(`\n  还要手工改（里面还带着模板痕迹 ${previousId} / ${templateName}）：`);
    for (const rel of leftovers) console.log(`    ${relDir}/${rel}`);
  }

  console.log(`\n  下一步：node scripts/check.mjs ${relDir}`);
  return 0;
}

const invokedDirectly =
  process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (invokedDirectly) process.exit(main());
