/**
 * Excalidraw 画布面板。
 *
 * 结构：工具栏（模板 / 存取 / 导出） + Excalidraw 画布。
 * 宿主能力只走 window.pluginBridge 的白名单通道，参数形态与宿主实现一致：
 *   fs.writeText { path, content }   fs.readText { path }   fs.glob { pattern }
 *   fs.list { path }                 ui.showToast { message }
 */

import React, { useCallback, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  CaptureUpdateAction,
  Excalidraw,
  convertToExcalidrawElements,
  exportToSvg,
  serializeAsJSON,
} from "@excalidraw/excalidraw";
// Excalidraw 的样式在构建时由 build.mjs 拷成 renderer/excalidraw.css
// （包的 exports 只把 ./index.css 映射到 production 条件，esbuild 解析不到）。
import { DIAGRAM_TYPES, GENERATORS } from "./templates.js";
import "./styles.css";

const DIR = "diagrams";

const hasBridge = () => Boolean(window.pluginBridge?.invoke);

async function bridgeInvoke(channel, payload) {
  if (!hasBridge()) throw new Error("不在 PI-Desktop 面板里：pluginBridge 不可用");
  return window.pluginBridge.invoke(channel, payload);
}

function defaultName() {
  const now = new Date();
  const pad = (value) => String(value).padStart(2, "0");
  return `diagram-${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`;
}

function baseName(entry) {
  if (typeof entry === "string") return entry.split("/").pop();
  if (entry && typeof entry === "object") {
    const raw = entry.name ?? entry.path ?? entry.fileName ?? "";
    return String(raw).split("/").pop();
  }
  return "";
}

/** 从 fs.glob / fs.list 的各种返回形态里捞出 .excalidraw 文件名。 */
function collectSceneFiles(result) {
  const list = Array.isArray(result)
    ? result
    : Array.isArray(result?.entries)
      ? result.entries
      : Array.isArray(result?.files)
        ? result.files
        : [];
  return [...new Set(list.map(baseName).filter((name) => name.endsWith(".excalidraw")))].sort();
}

function boundsOf(elements) {
  let maxY = 0;
  for (const element of elements) {
    const bottom = (element.y ?? 0) + (element.height ?? 0);
    if (bottom > maxY) maxY = bottom;
  }
  return maxY;
}

function Toolbar({ api, sceneName, setSceneName, status, setStatus, files, refreshFiles }) {
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState("");

  const withBusy = useCallback(
    async (label, task) => {
      if (busy) return;
      setBusy(true);
      setStatus(`${label}…`);
      try {
        await task();
      } catch (error) {
        setStatus(`${label}失败：${error?.message ?? error}`);
      } finally {
        setBusy(false);
      }
    },
    [busy, setStatus],
  );

  const insertTemplate = useCallback(
    (key) => {
      if (!api) return;
      const skeleton = GENERATORS[key]();
      const existing = api.getSceneElements();
      const offsetY = existing.length ? boundsOf(existing) + 120 : 0;
      const shifted = skeleton.map((element) =>
        typeof element.y === "number" ? { ...element, y: element.y + offsetY } : element,
      );
      const created = convertToExcalidrawElements(shifted, { regenerateIds: true });
      api.updateScene({
        elements: [...existing, ...created],
        captureUpdate: CaptureUpdateAction.IMMEDIATELY,
      });
      api.scrollToContent(created, { fitToContent: true, animate: true });
      setStatus(`已插入「${DIAGRAM_TYPES.find((item) => item.key === key)?.label ?? key}」`);
    },
    [api, setStatus],
  );

  const save = useCallback(
    () =>
      withBusy("保存", async () => {
        const elements = api.getSceneElements();
        if (!elements.length) throw new Error("画布是空的");
        const json = serializeAsJSON(elements, api.getAppState(), api.getFiles(), "local");
        await bridgeInvoke("fs.writeText", { path: `${DIR}/${sceneName}.excalidraw`, content: json });
        setStatus(`已保存 ${DIR}/${sceneName}.excalidraw（${elements.length} 个元素）`);
        await refreshFiles();
      }),
    [api, sceneName, withBusy, setStatus, refreshFiles],
  );

  const open = useCallback(
    () =>
      withBusy("打开", async () => {
        const target = selected || sceneName;
        if (!target) throw new Error("先选一个场景文件");
        const content = await bridgeInvoke("fs.readText", { path: `${DIR}/${target}` });
        const data = JSON.parse(content);
        if (!Array.isArray(data.elements)) throw new Error("文件里没有 elements 数组");
        api.updateScene({
          elements: data.elements,
          appState: data.appState?.viewBackgroundColor
            ? { viewBackgroundColor: data.appState.viewBackgroundColor }
            : undefined,
          captureUpdate: CaptureUpdateAction.IMMEDIATELY,
        });
        setSceneName(target.replace(/\.excalidraw$/, ""));
        api.scrollToContent(data.elements, { fitToContent: true });
        setStatus(`已打开 ${DIR}/${target}（${data.elements.length} 个元素）`);
      }),
    [api, selected, sceneName, withBusy, setStatus, setSceneName],
  );

  const exportSvg = useCallback(
    () =>
      withBusy("导出 SVG", async () => {
        const elements = api.getSceneElements();
        if (!elements.length) throw new Error("画布是空的");
        const svg = await exportToSvg({
          elements,
          appState: { ...api.getAppState(), exportBackground: true, viewBackgroundColor: "#ffffff" },
          files: api.getFiles(),
        });
        const markup = new XMLSerializer().serializeToString(svg);
        await bridgeInvoke("fs.writeText", { path: `${DIR}/${sceneName}.svg`, content: markup });
        setStatus(`已导出 ${DIR}/${sceneName}.svg`);
        await refreshFiles();
      }),
    [api, sceneName, withBusy, setStatus, refreshFiles],
  );

  const clear = useCallback(() => {
    if (!api) return;
    api.updateScene({ elements: [], captureUpdate: CaptureUpdateAction.IMMEDIATELY });
    setStatus("画布已清空");
  }, [api, setStatus]);

  const disabled = busy || !api;

  return (
    <div className="toolbar" data-busy={busy ? "true" : "false"}>
      <span className="group-label">模板</span>
      {DIAGRAM_TYPES.map((type) => (
        <button
          key={type.key}
          type="button"
          title={type.hint}
          disabled={disabled}
          onClick={() => insertTemplate(type.key)}
        >
          {type.label}
        </button>
      ))}

      <span className="divider" />

      <label className="field">
        场景名
        <input
          value={sceneName}
          onChange={(event) => setSceneName(event.target.value.trim())}
          spellCheck={false}
          placeholder="不含扩展名"
        />
      </label>
      <button type="button" disabled={disabled || !sceneName} onClick={save}>
        保存
      </button>

      <select
        className="files"
        value={selected}
        disabled={disabled || !files.length}
        onChange={(event) => setSelected(event.target.value)}
        title={files.length ? "选择要打开的 .excalidraw" : "diagrams/ 下还没有场景文件"}
      >
        <option value="">{files.length ? `选择场景（${files.length}）` : "暂无场景文件"}</option>
        {files.map((file) => (
          <option key={file} value={file}>
            {file}
          </option>
        ))}
      </select>
      <button type="button" disabled={disabled || !(selected || sceneName)} onClick={open}>
        打开
      </button>
      <button type="button" disabled={disabled} onClick={exportSvg}>
        导出 SVG
      </button>
      <button type="button" disabled={disabled} onClick={clear}>
        清空
      </button>

      <span className="status" role="status">
        {status}
      </span>
    </div>
  );
}

function App() {
  const [api, setApi] = useState(null);
  const [sceneName, setSceneName] = useState(defaultName);
  const [status, setStatus] = useState(
    hasBridge() ? "选择模板开始，或直接手绘；保存写到 diagrams/" : "预览模式：没有 pluginBridge，存取不可用",
  );
  const [files, setFiles] = useState([]);
  const bootstrapped = useRef(false);

  const refreshFiles = useCallback(async () => {
    if (!hasBridge()) return;
    try {
      const result = await bridgeInvoke("fs.glob", { pattern: `${DIR}/*.excalidraw` });
      setFiles(collectSceneFiles(result));
    } catch {
      // glob 失败（目录还不存在 / 宿主差异）不算错误，保持旧列表即可。
    }
  }, []);

  useEffect(() => {
    if (bootstrapped.current) return;
    bootstrapped.current = true;
    refreshFiles();
  }, [refreshFiles]);

  return (
    <div className="app">
      <Toolbar
        api={api}
        sceneName={sceneName}
        setSceneName={setSceneName}
        status={status}
        setStatus={setStatus}
        files={files}
        refreshFiles={refreshFiles}
      />
      <div className="canvas-wrap">
        <Excalidraw
          excalidrawAPI={(instance) => setApi(instance)}
          initialData={{ appState: { viewBackgroundColor: "#ffffff", currentItemFontFamily: 2 } }}
          langCode="zh-CN"
        />
      </div>
    </div>
  );
}

const container = document.getElementById("root");
createRoot(container).render(<App />);
