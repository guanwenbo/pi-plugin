/**
 * Archify 校验式图表 — 宿主侧入口。
 *
 * 把 Archify 的零依赖 CLI（runtime/bin/archify.mjs）包成 agent 工具：
 *   archify_types / archify_examples / archify_validate / archify_finalize
 *
 * 关键约束（都是实测得出的，不是猜的）：
 *   - CLI 只认 process.argv，没有导出，必须起子进程；
 *   - 插件进程里 process.execPath 指向 Electron 二进制，直接用会再开一个应用，
 *     必须带 ELECTRON_RUN_AS_NODE=1 才会以 Node 身份执行（本机实测 Node 24）；
 *   - 插件进程拿不到宿主的环境变量，PATH 可能很干净，所以要按候选列表探测；
 *   - finalize 带真实浏览器门禁，本机实测约 3.7s（含 browser-check）。
 */

const path = require("node:path");
const fs = require("node:fs");
const { execFile } = require("node:child_process");

const RUNTIME_DIR = path.join(__dirname, "runtime");
const BIN = path.join(RUNTIME_DIR, "bin", "archify.mjs");
const EXAMPLES_DIR = path.join(RUNTIME_DIR, "examples");

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

// —— 执行 —— ——————————————————————————————————————————————

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
    // 没有工作区时退回进程 cwd，命令仍能跑（只是相对路径解析到别处）。
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

// —— 工具实现 —— ——————————————————————————————————————————————

async function listTypes() {
  const ready = fs.existsSync(BIN);
  return {
    ok: ready,
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

// —— 生命周期 —— ——————————————————————————————————————————————

const TOOL_NAMES = ["archify_types", "archify_examples", "archify_validate", "archify_finalize"];

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
}

async function onUnload() {
  for (const name of TOOL_NAMES) {
    try {
      await pi.agent.unregisterTool(name);
    } catch {
      // 工具没注册成功时忽略。
    }
  }
}

module.exports = { onLoad, onUnload };
