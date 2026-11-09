# Archify 校验式图表

把 [Archify](https://github.com/tt-a1i/archify)（Apache-2.0，v3.2.0）的图表引擎装进 PI-Desktop，作为 agent 工具使用。

和隔壁 [`../local.guanwenbo.excalidraw-studio`](../local.guanwenbo.excalidraw-studio) 的分工：

| | 这个插件（Archify） | Excalidraw 画布 |
| --- | --- | --- |
| 谁画 | **agent 写 JSON**，人看成品 | **人拖**，agent 只出初稿 |
| 产物 | 单个自包含 HTML（可交互、可导出图/视频） | `.excalidraw`（可继续手改）+ SVG |
| 质量保证 | Schema / 布局 / HTML / **真实浏览器** 四道门禁 | 只校验 manifest 与打包约束 |
| 适合 | 要交付、要分享、要留档的图 | 边想边改、要自由布局 |

两者共用工作区的 `diagrams/` 目录：Archify 出的 HTML 和画布存的 `.excalidraw` 放在一起；架构图还能从 Archify 候选 JSON **导入画布手改**（在画布面板里点「导入架构 JSON」）。

## 提供的 agent 工具

| 工具 | 作用 |
| --- | --- |
| `archify_types` | 11 种类型（architecture / workflow / sequence / dataflow / lifecycle / erd / class / tree / timeline / waterfall / explainer）+ 运行时路径 + 推荐流程 |
| `archify_examples` | 列出内置示例 JSON 的绝对路径（可按类型过滤），用来学 IR 结构 |
| `archify_validate` | 只校验，不出产物 |
| `archify_finalize` | 跑完整门禁并**原子写出** HTML |

工具内部起子进程执行 `runtime/bin/archify.mjs`：`validate → deliver → check → browser-check`，只有四项全 pass 才返回 `ok: true`。

## 典型对话

```
帮我把这个系统的请求链路画成架构图
```
agent 会：`archify_types` → `archify_examples` → 写 `diagrams/archify/architecture-<slug>/candidate.json` → `archify_finalize` → 把 `diagrams/<slug>.html` 告诉你。失败时按 `diagnostics` 定点修，最多两轮。

## 目录

```
manifest.json          工具与技能声明
main.js                工具实现（Node 探测 + CLI 调用 + 诊断摘要）
skills/archify.md      给 agent 的作业规范
runtime/               Archify 官方运行时（未修改，见下）
LICENSE / NOTICE / THIRD_PARTY_NOTICES.md
```

`runtime/` 是 `tt-a1i/archify@3.2.0` 仓库 `archify/` 目录的原样拷贝，只做了两处删减：`package-lock.json` 与 `examples/*.html`（渲染产物）。升级方式：整目录替换 `runtime/`，再跑 `node runtime/bin/archify.mjs doctor`。

## 权限

只申请两项：`agent.tool.register`（注册工具）与 `agent.prompt.inject`（技能文档）。

**没有**申请 `fs.read` / `fs.write`：文件读写全部发生在插件自己的 Node 子进程里（CLI 直接读写工作区），不走宿主的 fs 网关，所以声明了也不会被用到——写了反而误导。真正的写范围由 `main.js` 里的 `assertOutputPath` 强制：输出必须以 `diagrams/` 开头且是相对路径，否则直接报错。

## 实现要点（都是踩出来的）

- Archify CLI 只读 `process.argv`、没有任何导出，**必须起子进程**。
- 插件进程里 `process.execPath` 指向 Electron 二进制，直接执行会再开一个 PI-Desktop；必须带 `ELECTRON_RUN_AS_NODE=1` 才以 Node 身份运行（本机实测 Node 24.20）。工具会依次探测：`ARCHIFY_NODE` → `process.execPath` + `ELECTRON_RUN_AS_NODE` → `/opt/homebrew/bin/node` → `/usr/local/bin/node` → `/usr/bin/node` → PATH 里的 `node`，并要求 ≥18。
- `browser-check` 用真实浏览器；找不到 Chrome 时可用环境变量 `ARCHIFY_CHROME` 指定。
- `output` 强制以 `diagrams/` 开头，和 manifest 的写范围对齐，避免写到工作区之外。

## 验证状态

- `node runtime/bin/archify.mjs doctor`：全部 ok（含 Finalize / Visual-check 运行时、11 个渲染器）
- `finalize` 实跑 `workflow` 示例：`gates` 四项全 pass，产出 851KB HTML，耗时 3.6s
- `node scripts/check.mjs` 与宿主内置 `PluginCheck`：见仓库根 README 的验证记录

## 许可

Archify 为 Apache-2.0，本插件按原样分发其运行时，随附 `LICENSE`、`NOTICE` 与 `THIRD_PARTY_NOTICES.md`；`main.js`、`skills/`、本 README 为本仓库新增。
