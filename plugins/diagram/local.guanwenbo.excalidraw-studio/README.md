# Excalidraw 架构与建模画布

在 PI-Desktop 的工作面板里开一块 **Excalidraw 画布**，专门画四类图：

| 模板 | 生成什么 |
| --- | --- |
| 技术架构图 | 接入 / 网关 / 应用 / 中间件 / 数据 五层色带 + 方框 + 层间箭头 |
| 业务建模图 | 用户 / 订单 / 商品 / 支付单四个实体（含字段清单）+ 1:N、N:N、1:1 关系线 |
| 流程图 | 椭圆起止 + 矩形处理 + 菱形判断，含「是 / 否」两个分支 |
| 时序图 | 参与者 + 虚线生命线 + 调用箭头（实线）与返回箭头（虚线） |

模板只是**起点**：插入后就是普通 Excalidraw 元素，随便拖、改文字、改颜色、加自己的形状。

## 用法

1. 命令面板执行 `Excalidraw: 打开画布`（或插件页打开面板）
2. 点工具栏的四个模板之一 → 生成初稿，自动缩放到合适视图
3. 用 Excalidraw 自己的工具继续画（矩形 / 菱形 / 箭头 / 文字 / 画笔 / 图片）
4. 填「场景名」→ **保存**；下次用下拉框选文件 → **打开**；需要贴到文档里就 **导出 SVG**

生成物落在工作区：

```
diagrams/<场景名>.excalidraw   Excalidraw 原生场景（明文 JSON，可用 Excalidraw 网页/桌面版继续编辑）
diagrams/<场景名>.svg          导出的矢量图
```

## 命令面板

| 命令 | 做什么 |
| --- | --- |
| `Excalidraw: 打开画布` | 打开画布面板 |
| `Excalidraw 画布: 检查更新` | 拉仓库根 `latest.json` 比对版本 |
| `Excalidraw 画布: 更新插件` | 下载新版 → 校验 sha256/大小 → 解包替换自身文件（先备份）→ 提示重启 |

加载后还会静默查一次更新，有新版本用系统通知提示。更新源与 archify 插件相同：`https://raw.githubusercontent.com/guanwenbo/pi-plugin/main/latest.json`。

⚠️ `PluginCheck` 会报 `fs.read` / `fs.write` / `net.fetch` unused —— 这项检查只扫 `main.js`，而实际调用分别在**面板 bridge**（`renderer/app.js`）与 `commands.js` / `updater.js` 里。不是冗余声明，别删。

## 与 Archify 联动（0.2.0 起）

配合 [`../local.guanwenbo.archify`](../local.guanwenbo.archify) 插件，两条链路都收在这一个面板里：

1. **导入架构 JSON**：下拉列出 `diagrams/**/*.architecture.json`，选中导入后，Archify 的组件 / 边界 / 连线 / 说明卡片会变成**普通画布元素**，随便拖改。
   - 只支持 `architecture`——它的 IR 带真实像素坐标（`pos` / `size`）；`workflow` / `sequence` / `erd` 用的是网格坐标，要复刻 Archify 的布局常量才准，所以宁可不导，也不给一张错位的图。
   - 映射规则：组件→圆角矩形（按 `type` 配色）、`boundaries[].wraps`→包住成员的虚线框、`connections[]`→带文字的箭头（显式几何 + 绑定）、`cards[]`→右侧文字块。
2. **打开成品**：下拉列出 `diagrams/**/*.html`，点「打开成品」用宿主内置浏览器打开 Archify 那份自包含 HTML。

所以完整闭环是：**agent 用 Archify 出一版经过门禁的图 → 你在面板里看 HTML → 需要改就导入画布手调 → 存回 `.excalidraw`／导出 SVG**。

## 权限与安全

- `ui.panel`：面板本身
- `fs.read`：范围 `diagrams/**` 与 `**/*.excalidraw`
- `fs.write`：范围 `diagrams/**`（不能写别处）

不联网：Excalidraw 前端与字体都随插件打包，运行时不发任何请求。图只写到你自己的 `diagrams/` 目录里。

面板里能用的宿主能力只有 `pluginBridge` 白名单通道，用到的是 `fs.writeText {path, content}`、`fs.readText {path}`、`fs.glob {pattern}`、`ui.showToast {message}`。


> 装的时候 `PluginCheck` 会报两条 `permission.unused`，说 `fs.read` / `fs.write` 在 `main.js` 里没用上。这是预期的：本插件的文件读写全部发生在**面板**里，而这项检查只扫 `main.js`。真去点一次保存就能看到通道确实通了。
## 开发

源码在 `src/`，构建产物在 `renderer/`（**已提交**，安装插件不需要构建）：

```
src/panel.jsx         面板：工具栏 + 挂载 Excalidraw
src/templates.js      四种图的骨架生成器
src/archify-import.js Archify architecture IR → Excalidraw 骨架（纯函数，可用 node 单测）
src/styles.css        工具栏样式
build.mjs          esbuild 打包 + 拷 Excalidraw 样式与字体
renderer/          app.js（约 8MB，含 React + Excalidraw）、app.css、excalidraw.css、fonts/
```

改完源码：

```bash
npm install          # 只在第一次或换机器时需要
node build.mjs       # 重新生成 renderer/app.js 等
```

`node build.mjs --watch` 只监听 JS/JSX，**不会**重拷 css / fonts；样式或字体改了重跑一次不带参数的命令。

### 实现要点（踩过的坑）

- `@excalidraw/excalidraw` 的 dist 是 ESM 且把 `react`、`jotai`、`roughjs` 等当外部依赖，不能直接拷 dist 用，必须打包。
- 它的 `exports` 只把 `./index.css` 映射到 `production` 条件，esbuild 解析不到，所以 `build.mjs` 直接把 `dist/prod/index.css` 拷成 `renderer/excalidraw.css`。
- 箭头只给 `start`/`end` 绑定、不给 `points`，`convertToExcalidrawElements` 会生成**零长度箭头**（渲染成贴在方框里的小箭头）。所以 `templates.js` 里箭头一律「显式两点几何 + 绑定」都写。
- 容器加 `label` 时 `fontFamily` 用 `2`（系统字体），中文才不会因为缺手写体字体文件而掉字。
- **`package.json` 不能带 `"type": "module"`**（0.3.1 修）：`main.js` / `commands.js` / `updater.js` 是 CJS，宿主见到该字段会按 ESM 解析整个插件目录，启动即 `require is not defined in ES module scope`。构建脚本是 `build.mjs`，`.mjs` 后缀本身即 ESM，去掉该字段不影响 `node build.mjs`。

## 第三方资源

| 资源 | 来源 | 许可 |
| --- | --- | --- |
| Excalidraw 前端 | `@excalidraw/excalidraw@0.18.1` | MIT |
| React / React DOM | `18.3.1` | MIT |
| esbuild（仅构建期） | `0.24.0` | MIT |
| `renderer/fonts/*` | 随 `@excalidraw/excalidraw` 的 `dist/prod/fonts` 分发 | 该包未随附各字体的 license 文件；这些字体通常为 OFL / Apache 系，对外再分发前请自行核对 |

`renderer/fonts/` 只拷了 7 套字体（约 480KB），**没有**拷 12MB 的 `Xiaolai` 中文字体。想彻底不要字体文件，直接删掉 `renderer/fonts/` 并重新构建——画布会回落到系统字体，功能不受影响。

## 已知限制

- 中文用系统字体渲染，不是 Excalidraw 的手写体（原因见上，省 12MB）。
- 没有 PNG 导出：面板只能写文本文件，SVG 是文本所以能导出；要 PNG 用 Excalidraw 自己的导出菜单。
- 面板在浏览器预览里跑时没有 `pluginBridge`，保存 / 打开 / 导出会提示不可用，画布本身正常。
