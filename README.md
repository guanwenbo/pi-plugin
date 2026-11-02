# pi-plugin

我自己的 PI-Desktop agent 插件仓库。里面只有三样东西：**模板**、**校验/打包脚本**、以及后续往 `plugins/` 里放的自有插件。

## 目录结构

```
.
├── templates/          三套最小可运行模板（agent 工具 / 工作面板 / 技能包）
├── plugins/            我的自有插件，一个子目录 = 一个插件
├── scripts/
│   ├── check.mjs       manifest 与打包约束预检（零依赖）
│   ├── pack.mjs        打 store-only .piplug（零依赖，产物自检）
│   └── new.mjs         从模板复制出一个新插件
├── package.json        只有 scripts 别名，没有任何依赖
└── LICENSE
```

## 新建一个插件

```bash
# 1. 从模板复制（自动改好 manifest 的 id / name）
node scripts/new.mjs panel local.guanwenbo.my-panel --name "我的面板"

# 2. 改内容：manifest.json、main.js、renderer/index.html
# 3. 预检
node scripts/check.mjs plugins/local.guanwenbo.my-panel
# 4. 打包
node scripts/pack.mjs plugins/local.guanwenbo.my-panel
# → dist/local.guanwenbo.my-panel-0.1.0.piplug
```

## 命令

| 命令 | 作用 |
| --- | --- |
| `node scripts/check.mjs` | 检查 `plugins/*` 与 `templates/*` 全部插件 |
| `node scripts/check.mjs <目录>...` | 只检查指定目录；有 error 时退出码 1 |
| `node scripts/pack.mjs <目录> [--out <目录>]` | 先校验再打包，产物默认进 `dist/` |
| `node scripts/new.mjs <模板名> <新 id> [--name <名字>]` | 复制模板到 `plugins/<新 id>` |

也有 npm 别名：`npm run check` / `npm run pack` / `npm run new`。

## 装进 PI-Desktop

两种方式：

1. **开发期（推荐）**：Plugins 页 → *Load development plugin* → 指向插件目录。改文件即热重载；**放宽 `permissions` 或 `manifest.fs` 范围要重新加载**（热重载不会悄悄放大权限）。
2. **正式安装**：`node scripts/pack.mjs <目录>` 后，Plugins 页 → 安装 `.piplug`。

> PI-Desktop 内置的 `PluginCheck` / `PluginPack` 是权威实现。`scripts/` 下的两个脚本是无依赖的离线等价物，方便在终端和 CI 里跑；结论冲突时以内置的为准。

## 命名与版本

- `id`：`[a-zA-Z0-9][a-zA-Z0-9._-]*`，个人插件统一 `local.guanwenbo.<名字>`
- `version`：semver，产物文件名就是 `<id>-<version>.piplug`
- 目录名建议与 `id` 一致，方便 `plugins/local.guanwenbo.my-panel`
- 每个插件目录内必须自带 `manifest.json`，入口是 `main`

## 硬性约束

installer 会直接拒的：

- `.piplug` 必须是 **store-only（不压缩）zip** —— 用 `scripts/pack.mjs`，不要用 `zip` / `tar`
- 打包 ≤ 2000 文件、≤ 50MB、**不含符号链接**
- `fs.write` / `fs.delete` **不能声明整树**（`*`、`**`、`**/*`），写入删除必须有具体范围
- `entry` 路径（`main`、`ui.panel`、`skills/*`…）必须存在且不能越出插件目录

装上了但会静默失效的：

- 声明 `net.fetch` 却没有 `net.domains` → 出不了网
- 有 `contributes.skills` 却没有 `agent.prompt.inject` → 技能被忽略
- 写 `fs.write.workspace` 这类旧权限名 → 宿主降级为「什么都不能」

任何情况下都拒绝：`.env*`、`.ssh/`、`.aws/`、`.git/`、`*.pem`、以及 PI-Desktop 自己的数据目录。

## 权限速查

| 风险 | 权限 |
| --- | --- |
| high | `net.fetch` `fs.write` `fs.delete` `agent.prompt.inject` `agent.tool.register` `agent.complete` `renderer.extension` `session.read` `mcp.server.local` `mcp.server.remote` |
| medium | `fs.read` `clipboard.read` `clipboard.write` `shell.openExternal` `background.service` `bus.publish` `bus.subscribe` `models.list` `usage.read` |
| low | `ui.panel` `ui.theme` `notify` |

原则：要最少的。`fs.write` 只写自己产出的目录；只删自己写的文件就用 `"delete": { "own": true }`。

## 三套 API 的边界（最容易踩的地方）

- **`main.js` 里是 `pi.*`**：`pi.commands.register`、`pi.agent.registerTool`、`pi.ui.openPanel`、`pi.fs.readText`、`pi.plugin.getSettings`…
- **面板里只有 `window.pluginBridge`**：固定通道白名单（`ui.showToast`、`fs.readText`、`fs.writeText`、`fs.glob`、`clipboard.readText`、`shell.openExternal`、`net.fetch`…），没有任意 IPC，也拿不到 `pi`。
- **想画在主窗口里**（输入框旁按钮、消息操作栏、工具卡片）不是面板，是 `renderer.extension` 插槽，见 `templates/panel/README.md` 末尾的说明。

其它固定事实：

- 面板顶部 46px 是宿主的透明拖拽带，正文已自动下移；固定/粘顶元素用 `var(--pi-plugin-titlebar-height, 46px)`，高度用 `calc(100dvh - var(--pi-plugin-titlebar-height, 46px))`。
- 生命周期：`onLoad` 15s、其它钩子 5s、agent 工具 110s；`onLoad` 抛错会整体回滚成 `load_error`。
- 技能上限：单插件 32 个、单个 ≤128KiB、`description` ≤240 字符。技能描述是模型判断「何时加载」的唯一依据，宁少宁准。

## 本仓库的验证状态

- 三套模板：`node scripts/check.mjs` 全绿；宿主内置 `PluginCheck` 也通过（工具/技能模板各带一条「high-risk 权限需用户授权」的提示，属预期）。
- `scripts/pack.mjs` 对 `templates/panel` 的产物与宿主内置 `PluginPack` 的输出**字节完全一致**（sha256 `fe9224248b6f7bfa481341f7b5b05128baa60d49a9913c50a8a8f08cc3c891f5`），`unzip -t` 与 Python `zipfile` 均通过。
- 未验证的部分：`.piplug` 在 Plugins 页的实际安装点击流程（需要人工点一下）。

## 我的插件清单

| 插件 | id | 版本 | 说明 |
| --- | --- | --- | --- |
| _（待加）_ | | | |

加插件时同步更新这张表和 [`plugins/README.md`](./plugins/README.md)。

## 参考

- 宿主侧开发规范：PI-Desktop 内置 skill `plugin-development`（`/Applications/PI-Desktop.app/Contents/Resources/skills/plugin-development.md`）
- 已安装的社区实现可当范例：`~/.pi-desktop/plugins/installed/`（如 `io.github.muzimu217.vision-kit` 的纯工具插件、`axc00.project-knowledge` 的工具 + 面板组合）
