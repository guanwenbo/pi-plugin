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

## 命令面板（6 条）

所有命令都在命令面板（`Cmd+K`）或关键词里搜 `archify`：

| 命令 | 做什么 |
| --- | --- |
| `Archify: 自检（doctor）` | 跑 CLI 的 `doctor`，Toast 报结果 |
| `Archify: 校验最新候选 JSON` | 自动取 `diagrams/` 下 **mtime 最新**的 `*.json`，类型从 `diagram_type` 或文件名 `<name>.<type>.json` 推断，跑 validate |
| `Archify: 用最新候选出图` | 同上，跑完整 finalize 门禁，输出到同名 `.html` |
| `Archify: 打开最新 HTML 成品` | 找 `diagrams/` 下最新 `.html`，用宿主内置浏览器打开 |
| `Archify: 检查更新` | 拉 `latest.json` 比对版本，Toast 结果 |
| `Archify: 更新插件` | 下载新版 → 校验 sha256/大小 → 解包替换自身文件（先备份），提示重启 |

命令没有参数输入框（宿主未提供 `ui.prompt` 一类的 API），所以「最新候选」按 mtime 自动选；要指定具体文件就用 agent 工具 `archify_validate` / `archify_finalize`。

## 自动更新

宿主的更新通道（`market.checkUpdates` / `market.applyUpdates`）只覆盖 `source=marketplace` 的插件，本地安装的插件拿不到，所以本插件自带 updater：

- **更新源**：本仓库根 `latest.json`
  `https://raw.githubusercontent.com/guanwenbo/pi-plugin/main/latest.json`
- **检查时机**：每次插件加载后静默查一次（离线/失败静默，不打扰）；有新版本用系统通知提示一次
- **安装**：命令 `Archify: 更新插件` → 只下载清单里属于本插件的那条 `url`（域名受 `manifest.net.domains` 约束）→ 校验 `sha256` 与 `size` → 解 store-only `.piplug` → 把当前文件备份到系统临时目录 → 覆盖 → 提示**重启 PI-Desktop 生效**
- **回滚**：备份在 `$TMPDIR/pi-archify-update/previous-<旧版本>/`；`updater.js` 暴露 `rollback(backupDir, targetDir)`
- `node_modules` / `.git` 永不触碰；解包拒绝压缩条目、绝对路径与 `..` 逃逸

发布新版本的流程在仓库根 README 的「自动更新与发布」里。

## 权限

- `agent.tool.register`（工具）、`agent.prompt.inject`（技能文档）、`fs.read`（`diagrams/**`，给「最新候选/成品」命令用）、`net.fetch` + `net.domains: ["raw.githubusercontent.com"]`（更新源）
- 文件读写主体仍发生在插件自己的 Node 子进程里（CLI 直接读写工作区），`assertOutputPath` 强制输出必须在 `diagrams/` 下
- ⚠️ `PluginCheck` 会报 `net.fetch` unused —— 因为这项检查只扫 `main.js`，而实际调用在 `updater.js` 里。不是冗余声明，别删。

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
