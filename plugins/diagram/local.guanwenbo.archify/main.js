/**
 * Archify 校验式图表 — 宿主侧入口。
 *
 * 两部分贡献：
 *   1. agent 工具：archify_types / archify_examples / archify_validate / archify_finalize
 *   2. 命令面板命令：自检、校验最新候选、出图、打开最新成品、检查更新、更新插件
 *
 * 关键约束（都是实测得出的，不是猜的）：
 *   - CLI 只认 process.argv，没有导出，必须起子进程；
 *   - 插件进程里 process.execPath 指向 Electron 二进制，必须带 ELECTRON_RUN_AS_NODE=1 才以 Node 身份执行；
 *   - 插件进程拿不到宿主的环境变量，PATH 可能很干净，所以按候选列表探测；
 *   - finalize 带真实浏览器门禁，本机实测 ~3.7s；
 *   - 宿主的 market.applyUpdates 只覆盖 marketplace 来源的插件，本地来源的更新自己做（见 updater.js）。
 */

const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");
const { execFile } = require("node:child_process");
const updater = require("./updater.js");

const PLUGIN_DIR = __dirname;
const RUNTIME_DIR = path.join(PLUGIN_DIR, "runtime");
const BIN = path.join(RUNTIME_DIR, "bin", "archify.mjs");
const EXAMPLES_DIR = path.join(RUNTIME_DIR, "examples");
const OWN_MANIFEST = JSON.parse(fs.readFileSync(path.join(PLUGIN_DIR, "manifest.json"), "utf8"));

const DIAGRAM_TYPES = [
  { id: "architecture", when: "组件、服务、存储、系统边界；有明确坐标（pos/size），可直接导入 Excalidraw 画布手改" },
  { id: "workflow", when: "CI/CD、审批、工具调用、Runbook；有参与者、顺序、分支、异常" },
  { id: "sequence", when: "API 调用、缓存回源、鉴权、异步链路；有调用方、被调用方、返回" },
  { id: "dataflow", when: "数据管线、血缘、PII、下游消费者" },
  { id: "lifecycle", when: "状态机、重试、等待、终态" },
  { id: "erd", when: "数据库结构：表、字段、键、基数关系（表格优先）" },
  { id: "class", when: "类、接口、成员、继承与实现、组合依赖" },
  { id: "tree", when: "单一父级的层级：仓库、模块、能力拆解" },
  { id: "timeline", when: "何时发生什么：故障复盘、发布历史" },
  { id: "waterfall", when: "一次请求/一次运行的耗时分布：Span、嵌套、时长" },
  { id: "explainer", when: "把答案做成一页：结论先行 + 分面板讲理由（不是图表）" },
];

// —— Node 探测 ——————————————————————————————————————————————

let nodeRuntime = null;

function nodeCandidates() {
  const list = [];
  if (process.env.ARCHIFY_NODE) list.push({ bin: process.env.ARCHIFY_NODE, electron: false });
  if (process.execPath) list.push({ bin: process.execPath, electron: true });
  for (const candidate of ["/opt/homebrew/bin/node", "/usr/local/bin/node", "/usr/bin/node"]) {
    list.push({ bin: candidate, electron: false });
  }
  list.push({ bin: "node", electron: false });
  return list;
}

function probeNode(candidate) {
  return new Promise((resolve) => {
    const env = { ...process.env };
    if (candidate.electron) env.ELECTRON_RUN_AS_NODE = "1";
    execFile(
      candidate.bin,
      ["-e", "process.stdout.write(process.versions.node)"],
      { env, timeout: 15000, maxBuffer: 1024 * 1024 },
      (error, stdout) => {
        const version = String(stdout || "").trim();
        resolve(!error && /^\d+\.\d+\.\d+$/.test(version) ? { ...candidate, env, version } : null);
      },
    );
  });
}

async function resolveNode() {
  if (nodeRuntime) return nodeRuntime;
  for (const candidate of nodeCandidates()) {
    const probed = await probeNode(candidate);
    if (!probed) continue;
    if (Number(probed.version.split(".")[0]) < 18) {
      throw new Error(`archify 需要 Node >= 18，当前找到的是 ${probed.version}（${probed.bin}）`);
    }
    nodeRuntime = probed;
    return probed;
  }
  throw new Error(
    "找不到可用的 Node（>=18）。已尝试 ARCHIFY_NODE、process.execPath(ELECTRON_RUN_AS_NODE)、/opt/homebrew/bin/node、/usr/local/bin/node、/usr/bin/node、PATH 里的 node。",
  );
}

// —— 执行 ————————————————————————————————————————————————

function parseJsonOutput(text) {
  const trimmed = String(text || "").trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start === -1 || end <= start) return null;
    try {
      return JSON.parse(trimmed.slice(start, end + 1));
    } catch {
      return null;
    }
  }
}

async function workspaceRoot() {
  try {
    const workspace = await pi.workspace.get();
    if (workspace && workspace.path) return workspace.path;
  } catch {
    // 没有工作区时退回进程 cwd
  }
  return process.cwd();
}

async function runCli(args, { timeoutMs = 100000 } = {}) {
  const node = await resolveNode();
  const cwd = await workspaceRoot();
  return new Promise((resolve) => {
    execFile(
      node.bin,
      [BIN, ...args],
      {
        cwd,
        env: { ...node.env, ...(node.electron ? { ELECTRON_RUN_AS_NODE: "1" } : {}) },
        timeout: timeoutMs,
        maxBuffer: 64 * 1024 * 1024,
      },
      (error, stdout, stderr) => {
        resolve({
          cwd,
          ok: !error,
          exitCode: error && typeof error.code === "number" ? error.code : error ? 1 : 0,
          timedOut: Boolean(error && error.killed),
          json: parseJsonOutput(stdout),
          raw: String(stdout || "").trim(),
          stderrTail: String(stderr || "").trim().split("\n").slice(-6).join("\n") || null,
        });
      },
    );
  });
}

/** finalize/validate 的输出体积可能很大，只回传结论、门禁和有限条诊断。 */
function summarize(result, { diagnosticLimit = 12 } = {}) {
  const payload = result.json;
  if (!payload) {
    return {
      ok: false,
      reason: result.timedOut
        ? "命令超时（finalize 含真实浏览器门禁，通常需要数秒；超时请重跑一次）"
        : "命令没有输出可解析的 JSON",
      exitCode: result.exitCode,
      stderrTail: result.stderrTail,
    };
  }
  const diagnostics = Array.isArray(payload.diagnostics) ? payload.diagnostics : [];
  return {
    ok: payload.ok === true,
    command: payload.command,
    stage: payload.stage ?? null,
    status: payload.status ?? null,
    type: payload.type ?? null,
    quality: payload.quality ?? null,
    gates: payload.gates ?? null,
    artifact: payload.artifact ?? null,
    durationMs: payload.durationMs ?? null,
    diagnostics: diagnostics.slice(0, diagnosticLimit).map((item) => ({
      code: item.code,
      severity: item.severity,
      message: String(item.message || "").slice(0, 600),
      subject: item.subject ?? null,
      supportedFixes: item.supportedFixes ?? null,
    })),
    diagnosticsTruncated: diagnostics.length > diagnosticLimit ? diagnostics.length - diagnosticLimit : 0,
    evidence: payload.evidence ?? null,
    updateNotice: payload.update?.noticeRequired ? payload.update.noticeText : null,
    exitCode: result.exitCode,
  };
}

function assertType(type) {
  const match = DIAGRAM_TYPES.find((item) => item.id === type);
  if (!match) {
    throw new Error(`未知图表类型 \`${type}\`，可用：${DIAGRAM_TYPES.map((item) => item.id).join(", ")}`);
  }
  return match;
}

/** 输出必须落在 diagrams/ 下：和 manifest 的写范围一致，也避免写到工作区之外。 */
function assertOutputPath(output) {
  const value = String(output || "").trim();
  if (!value) throw new Error("output 不能为空，例如 diagrams/order-api.architecture.html");
  if (path.isAbsolute(value)) throw new Error("output 请用相对工作区根的路径，例如 diagrams/order-api.architecture.html");
  if (!value.startsWith("diagrams/")) throw new Error("output 必须放在 diagrams/ 下（插件的写范围就是 diagrams/**）");
  return value;
}

function assertCandidatePath(candidate) {
  const value = String(candidate || "").trim();
  if (!value) throw new Error("candidate 不能为空，例如 diagrams/archify/order-api/candidate.json");
  if (path.isAbsolute(value)) throw new Error("candidate 请用相对工作区根的路径");
  return value;
}

// —— agent 工具实现 ————————————————————————————————————————————

async function listTypes() {
  const ready = fs.existsSync(BIN);
  return {
    ok: ready,
    version: OWN_MANIFEST.version,
    runtime: {
      dir: RUNTIME_DIR,
      bin: BIN,
      skillDoc: path.join(RUNTIME_DIR, "SKILL.md"),
      references: path.join(RUNTIME_DIR, "references"),
      schemas: path.join(RUNTIME_DIR, "schemas"),
      examples: EXAMPLES_DIR,
      ready,
      ...(ready ? {} : { problem: "runtime/bin/archify.mjs 缺失，插件文件不完整" }),
    },
    types: DIAGRAM_TYPES,
    workflow: [
      "1. 选类型（本工具返回的 types）",
      "2. archify_examples 拿同类型示例的绝对路径，读它的结构（注意：示例只教形状，不要照抄事实）",
      "3. 把 candidate.json 写到 diagrams/archify/<type>-<slug>/candidate.json",
      "4. archify_finalize（或先 archify_validate）跑门禁",
      "5. 失败了只改 diagnostics 里 subject 指向的对象，最多两轮",
      "6. 成功后告诉用户 HTML 路径；需要手改时用 Excalidraw 插件导入 architecture 候选 JSON",
    ],
  };
}

async function listExamples(type) {
  if (!fs.existsSync(EXAMPLES_DIR)) {
    return { ok: false, problem: `示例目录不存在：${EXAMPLES_DIR}（插件文件可能不完整）` };
  }
  const suffix = type ? `.${type}.json` : ".json";
  const files = fs
    .readdirSync(EXAMPLES_DIR)
    .filter((name) => name.endsWith(suffix))
    .sort()
    .map((name) => path.join(EXAMPLES_DIR, name));
  return {
    ok: files.length > 0,
    type: type ?? null,
    count: files.length,
    files,
    note: "这些是 Archify 官方示例，用来说明 JSON IR 的形状；写自己的候选时用新 id、新文案、符合实际的结构。",
  };
}

async function validateCandidate(args) {
  const type = assertType(args.type).id;
  const candidate = assertCandidatePath(args.candidate);
  const result = await runCli(["validate", type, candidate, "--json"], { timeoutMs: 45000 });
  return summarize(result);
}

async function finalizeCandidate(args) {
  const type = assertType(args.type).id;
  const candidate = assertCandidatePath(args.candidate);
  const output = assertOutputPath(args.output);
  const quality = args.quality === "standard" ? "standard" : "showcase";
  const result = await runCli(["finalize", type, candidate, output, "--quality", quality, "--json"], {
    timeoutMs: 100000,
  });
  return summarize(result);
}

// —— 命令面板 ————————————————————————————————————————————

/** 在 diagrams/ 下找出最新的候选 JSON（按 mtime），给「校验/出图最新候选」用。 */
async function findLatestCandidate() {
  const root = await workspaceRoot();
  let globbed;
  try {
    globbed = await pi.fs.glob("diagrams/**/*.json");
  } catch (error) {
    throw new Error(`读 diagrams/ 失败（插件需要 fs.read 权限）：${error && error.message}`);
  }
  const list = Array.isArray(globbed) ? globbed : (globbed && (globbed.entries ?? globbed.files)) || [];
  const names = list
    .map((item) => (typeof item === "string" ? item : (item.name ?? item.path ?? "")))
    .filter((name) => name.endsWith(".json"))
    .filter((name) => !name.endsWith("package.json"));
  if (!names.length) throw new Error("diagrams/ 下没有候选 JSON");
  const withTime = names.map((name) => {
    const abs = path.isAbsolute(name) ? name : path.join(root, name);
    let mtime = 0;
    try {
      mtime = fs.statSync(abs).mtimeMs;
    } catch {
      mtime = 0;
    }
    return { relative: path.isAbsolute(name) ? path.relative(root, name) : name, mtime };
  });
  withTime.sort((left, right) => right.mtime - left.mtime);
  return withTime[0].relative.split(path.sep).join("/");
}

/** 从候选里判断 diagram_type（字段优先，其次文件名后缀）。 */
async function detectType(relativePath) {
  let doc = {};
  try {
    const text = await pi.fs.readText(relativePath);
    doc = JSON.parse(text);
  } catch {
    doc = {};
  }
  if (doc && typeof doc.diagram_type === "string" && DIAGRAM_TYPES.some((t) => t.id === doc.diagram_type)) {
    return doc.diagram_type;
  }
  const match = /\.([a-z]+)\.json$/i.exec(relativePath);
  if (match && DIAGRAM_TYPES.some((t) => t.id === match[1].toLowerCase())) return match[1].toLowerCase();
  throw new Error(
    `无法判断图表类型：${relativePath}（文件里没有 diagram_type，文件名也不是 <name>.<type>.json）`,
  );
}

function outputForCandidate(candidate, type) {
  const base = candidate.replace(/\.json$/i, "");
  const stripped = base.replace(new RegExp(`\\.${type}$`), "");
  return `${stripped}.html`;
}

async function commandDoctor() {
  const result = await runCli(["doctor"], { timeoutMs: 45000 });
  const failing = result.raw
    .split("\n")
    .filter((line) => line.trim().startsWith("[") && !line.includes("[ok]"));
  await pi.ui.showToast(
    result.ok && !failing.length
      ? `Archify 自检通过（${OWN_MANIFEST.version}）`
      : `Archify 自检有问题：${failing.slice(0, 2).join(" / ") || result.stderrTail || "见日志"}`,
  );
  return { ok: result.ok && !failing.length, failing };
}

async function commandValidateLatest() {
  const candidate = await findLatestCandidate();
  const type = await detectType(candidate);
  const summary = await validateCandidate({ type, candidate });
  await pi.ui.showToast(
    summary.ok
      ? `校验通过：${candidate}（${type}）`
      : `校验未通过：${candidate}，${(summary.diagnostics || []).length} 条诊断`,
  );
  return summary;
}

async function commandFinalizeLatest() {
  const candidate = await findLatestCandidate();
  const type = await detectType(candidate);
  const output = outputForCandidate(candidate, type);
  const summary = await finalizeCandidate({ type, candidate, output });
  await pi.ui.showToast(
    summary.ok
      ? `已出图：${output}（门禁全过）`
      : `出图失败：${(summary.diagnostics || []).map((d) => d.code).slice(0, 2).join(", ") || "见诊断"}`,
  );
  return summary;
}

async function commandOpenLatestHtml() {
  const root = await workspaceRoot();
  const globbed = await pi.fs.glob("diagrams/**/*.html");
  const list = Array.isArray(globbed) ? globbed : (globbed && (globbed.entries ?? globbed.files)) || [];
  const names = list
    .map((item) => (typeof item === "string" ? item : (item.name ?? item.path ?? "")))
    .filter((name) => name.endsWith(".html"));
  if (!names.length) throw new Error("diagrams/ 下没有 HTML 成品");
  const newest = names
    .map((name) => {
      const abs = path.isAbsolute(name) ? name : path.join(root, name);
      let mtime = 0;
      try {
        mtime = fs.statSync(abs).mtimeMs;
      } catch {
        mtime = 0;
      }
      return { relative: path.isAbsolute(name) ? path.relative(root, name) : name, mtime };
    })
    .sort((left, right) => right.mtime - left.mtime)[0];
  await pi.fs.openInBrowser(newest.relative.split(path.sep).join("/"));
  await pi.ui.showToast(`已打开 ${newest.relative}`);
  return { ok: true, path: newest.relative };
}

// —— 自更新 ————————————————————————————————————————————————

const BACKUP_DIR = path.join(os.tmpdir(), "pi-archify-update");

async function commandCheckUpdate() {
  const info = await updater.checkForUpdate(OWN_MANIFEST.id, OWN_MANIFEST.version);
  await pi.ui.showToast(
    info.latest === null
      ? "更新清单里没有这个插件，跳过检查"
      : info.available
        ? `${OWN_MANIFEST.name} 有新版本 ${info.latest}（当前 ${info.current}），运行命令「Archify: 更新插件」安装`
        : `${OWN_MANIFEST.name} 已是最新（${info.current}）`,
  );
  return info;
}

async function commandApplyUpdate() {
  const info = await updater.checkForUpdate(OWN_MANIFEST.id, OWN_MANIFEST.version);
  if (!info.available) {
    await pi.ui.showToast(`${OWN_MANIFEST.name} 已是最新（${info.current}）`);
    return { ok: true, updated: false, current: info.current };
  }
  const stagingDir = path.join(BACKUP_DIR, `staging-${info.latest}`);
  const staged = await updater.downloadAndStage(info.entry, stagingDir);
  updater.applyStaged(staged.stagingDir, PLUGIN_DIR, path.join(BACKUP_DIR, `previous-${info.current}`));
  await pi.ui.showToast(`已更新到 ${staged.version}，重启 PI-Desktop 生效`);
  return { ok: true, updated: true, from: info.current, to: staged.version };
}

function safeBackgroundCheck() {
  updater
    .checkForUpdate(OWN_MANIFEST.id, OWN_MANIFEST.version)
    .then(async (info) => {
      if (info.available) {
        await pi.ui.notify(
          `${OWN_MANIFEST.name} 有新版本 ${info.latest}，命令面板执行「Archify: 更新插件」即可升级`,
        );
      }
    })
    .catch(() => {
      // 离线或清单不可达：静默
    });
}

// —— 生命周期 ——————————————————————————————————————————————

const TOOL_NAMES = ["archify_types", "archify_examples", "archify_validate", "archify_finalize"];
const COMMANDS = [
  { id: "archify.doctor", title: "Archify: 自检（doctor）", keywords: ["archify", "doctor", "自检"], run: commandDoctor },
  { id: "archify.checkUpdate", title: "Archify: 检查更新", keywords: ["archify", "update"], run: commandCheckUpdate },
  { id: "archify.applyUpdate", title: "Archify: 更新插件", keywords: ["archify", "update", "升级"], run: commandApplyUpdate },
  { id: "archify.validateLatest", title: "Archify: 校验最新候选 JSON", keywords: ["archify", "validate"], run: commandValidateLatest },
  { id: "archify.finalizeLatest", title: "Archify: 用最新候选出图", keywords: ["archify", "finalize", "出图"], run: commandFinalizeLatest },
  { id: "archify.openLatestHtml", title: "Archify: 打开最新 HTML 成品", keywords: ["archify", "open", "html"], run: commandOpenLatestHtml },
];

async function onLoad() {
  await pi.agent.registerTool({
    name: "archify_types",
    description:
      "List Archify's diagram types with when-to-use guidance, plus absolute paths of the bundled runtime (SKILL/references/schemas/examples). Call this first for architecture, workflow, sequence, dataflow, lifecycle, ERD, class, tree, timeline or waterfall diagrams, or a one-page explainer.",
    risk: "low",
    schema: {
      type: "object",
      additionalProperties: false,
      properties: { action: { type: "string", enum: ["list"] } },
      required: ["action"],
    },
    execute: listTypes,
  });

  await pi.agent.registerTool({
    name: "archify_examples",
    description:
      "List Archify's bundled JSON-IR example files (optionally filtered by diagram type) with absolute paths, so you can copy their exact shape before authoring a candidate.",
    risk: "low",
    schema: {
      type: "object",
      additionalProperties: false,
      properties: {
        action: { type: "string", enum: ["list"] },
        type: { type: "string" },
      },
      required: ["action"],
    },
    execute: (args) => listExamples(args && args.type ? String(args.type) : null),
  });

  await pi.agent.registerTool({
    name: "archify_validate",
    description:
      "Validate an Archify candidate JSON against its schema and layout rules without writing output. Read `diagnostics[].subject` and `supportedFixes`; fix only those objects.",
    risk: "low",
    schema: {
      type: "object",
      additionalProperties: false,
      properties: {
        action: { type: "string", enum: ["validate"] },
        type: { type: "string" },
        candidate: { type: "string" },
      },
      required: ["action", "type", "candidate"],
    },
    execute: validateCandidate,
  });

  await pi.agent.registerTool({
    name: "archify_finalize",
    description:
      "Run the full Archify gate (validate → deliver → strict check → real-browser check) and atomically write the standalone HTML. Only a passing result proves the artifact is good; on failure repair the named objects, at most two rounds.",
    risk: "medium",
    schema: {
      type: "object",
      additionalProperties: false,
      properties: {
        action: { type: "string", enum: ["finalize"] },
        type: { type: "string" },
        candidate: { type: "string" },
        output: { type: "string" },
        quality: { type: "string", enum: ["showcase", "standard"] },
      },
      required: ["action", "type", "candidate", "output"],
    },
    execute: finalizeCandidate,
  });

  for (const command of COMMANDS) {
    await pi.commands.register({
      id: command.id,
      title: command.title,
      keywords: command.keywords,
      run: async () => {
        try {
          return await command.run();
        } catch (error) {
          await pi.ui.showToast(`${command.title} 失败：${(error && error.message) || error}`);
          return { ok: false, error: String((error && error.message) || error) };
        }
      },
    });
  }

  safeBackgroundCheck();
}

async function onUnload() {
  for (const name of TOOL_NAMES) {
    try {
      await pi.agent.unregisterTool(name);
    } catch {
      // 未注册成功时忽略
    }
  }
  for (const command of COMMANDS) {
    try {
      await pi.commands.unregister(command.id);
    } catch {
      // 未注册成功时忽略
    }
  }
}

module.exports = { onLoad, onUnload };
