/**
 * Captcha Kit — Python 环境管理与 worker 进程通道。
 * venv 固定放 ~/.pi-desktop/captcha-kit/venv（插件包外，重装不丢）。
 * setup 以 detached 后台进程跑 pip，日志写 setup.log；check 轮询。
 */
"use strict";

const os = require("node:os");
const path = require("node:path");
const fs = require("node:fs");
const { spawn, execFile } = require("node:child_process");

const RUNTIME_DIR = path.join(os.homedir(), ".pi-desktop", "captcha-kit");
const VENV_PY = path.join(RUNTIME_DIR, "venv", "bin", "python");
const SETUP_LOG = path.join(RUNTIME_DIR, "setup.log");
const WORKER = path.join(__dirname, "..", "scripts", "captcha_worker.py");
const DEFAULT_INDEX = "https://pypi.tuna.tsinghua.edu.cn/simple";

function venvExists() {
  try { fs.accessSync(VENV_PY, fs.constants.X_OK); return true; } catch { return false; }
}

/** 找系统 Python（3.9–3.13，onnxruntime 有 wheel 的区间）。 */
function findSystemPython() {
  const home = os.homedir();
  const candidates = [
    path.join(home, ".local/bin/python3.12"),
    path.join(home, ".local/bin/python3.11"),
    "python3.12", "python3.11", "python3.13", "python3.10",
    "/opt/homebrew/bin/python3", "/usr/local/bin/python3", "/usr/bin/python3", "python3",
  ];
  for (const cand of candidates) {
    try {
      const r = require("node:child_process").spawnSync(cand, ["-c", "import sys;print('%d.%d'%sys.version_info[:2])"], { encoding: "utf8", timeout: 8000 });
      if (r.status !== 0) continue;
      const [maj, min] = String(r.stdout).trim().split(".").map(Number);
      if (maj === 3 && min >= 9 && min <= 13) return { path: cand, version: `${maj}.${min}` };
    } catch { /* next */ }
  }
  return null;
}

/** 跑 worker 命令，解析单行 JSON 结果。 */
function runWorker(command, args, { timeoutMs = 90000, python = VENV_PY } = {}) {
  return new Promise((resolve, reject) => {
    execFile(python, [WORKER, command, JSON.stringify(args || {})], { timeout: timeoutMs, maxBuffer: 16 * 1024 * 1024 }, (err, stdout, stderr) => {
      const line = String(stdout || "").trim().split("\n").filter(Boolean).pop();
      if (line) {
        try {
          const obj = JSON.parse(line);
          if (obj.ok) return resolve(obj);
          return reject(new Error(`worker ${command}: ${obj.error}`));
        } catch { /* fallthrough */ }
      }
      reject(new Error(`worker ${command} failed: ${err ? err.message : "no JSON output"}${stderr ? ` | ${String(stderr).slice(-400)}` : ""}`));
    });
  });
}

function logTail(n = 12) {
  try {
    const txt = fs.readFileSync(SETUP_LOG, "utf8");
    return txt.trim().split("\n").slice(-n).join("\n");
  } catch { return ""; }
}

function setupRunning() {
  const tail = logTail(3);
  return !!tail && !tail.includes("EXIT=");
}

async function check() {
  const info = { runtimeDir: RUNTIME_DIR, venv: venvExists(), setupRunning: setupRunning() };
  if (!info.venv) {
    const sys = findSystemPython();
    return { ready: false, ...info, systemPython: sys, hint: "call captcha_env with action=setup to install ddddocr into a private venv" };
  }
  try {
    const probe = await runWorker("probe", {}, { timeoutMs: 60000 });
    const ready = !!probe.ddddocr && (process.platform !== "darwin" || !!probe.quartz);
    return { ready, ...info, probe };
  } catch (e) {
    return { ready: false, ...info, error: e.message, logTail: logTail() };
  }
}

/** 后台安装：venv + pip。立即返回，不占 110s 工具时限。 */
function setup(args = {}) {
  if (venvExists()) {
    // venv 已在但依赖可能缺：仍允许重跑 pip（幂等）
  }
  if (setupRunning()) return { started: false, reason: "setup already running", logTail: logTail() };
  const sys = findSystemPython();
  if (!sys) return { started: false, reason: "no usable system Python 3.9–3.13 found; install one first" };
  const index = String(args.index || DEFAULT_INDEX);
  const pkgs = ["ddddocr", "pillow"];
  if (process.platform === "darwin") pkgs.push("pyobjc-framework-Quartz");
  fs.mkdirSync(RUNTIME_DIR, { recursive: true });
  const script = [
    `set -x`,
    venvExists() ? `echo "venv exists"` : `"${sys.path}" -m venv "${path.join(RUNTIME_DIR, "venv")}"`,
    `"${VENV_PY}" -m pip install --upgrade pip -i "${index}"`,
    `"${VENV_PY}" -m pip install -i "${index}" ${pkgs.join(" ")}`,
    `echo "EXIT=$?"`,
  ].join("\n");
  const logFd = fs.openSync(SETUP_LOG, "w");
  const child = spawn("/bin/bash", ["-c", script], { detached: true, stdio: ["ignore", logFd, logFd] });
  child.unref();
  fs.closeSync(logFd);
  return { started: true, pid: child.pid, python: sys, index, packages: pkgs, log: SETUP_LOG, hint: "poll captcha_env action=check every ~20s until ready=true (first install downloads onnxruntime, may take a few minutes)" };
}

module.exports = { RUNTIME_DIR, VENV_PY, WORKER, venvExists, findSystemPython, runWorker, check, setup, logTail };