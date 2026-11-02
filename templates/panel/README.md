# 模板：Panel

最小「命令 + 工作面板」插件：命令面板里执行 `Template Panel: 打开面板`，弹出一个独立窗口。

## 复制并使用

```bash
cp -R templates/panel plugins/local.guanwenbo.my-panel
```

改 `manifest.json` 的 `id` / `name` / `ui.panel.title` / 命令 id 与标题，再改 `main.js` 里 `OPEN_COMMAND` 与 `renderer/index.html` 的界面。

## 关键点

- **两套 API 不要混**：`main.js` 里是 `pi.*`；面板里只有 `window.pluginBridge.invoke(channel, args)`，且通道是白名单（`ui.showToast`、`fs.readText`、`fs.writeText`、`fs.glob`、`clipboard.readText`、`shell.openExternal`、`net.fetch` 等），没有任意 IPC。
- **顶部 46px**：宿主保留的透明拖拽带，正文已自动下移。`position: fixed/sticky` 的顶部栏要用 `top: var(--pi-plugin-titlebar-height, 46px)`，高度计算用 `calc(100dvh - var(--pi-plugin-titlebar-height, 46px))`，想拖窗口加 `-webkit-app-region: drag`，里面的控件加 `no-drag`。
- **主题**：保留模板里的 `app.getAppearance` + `appearance:changed` 处理，别把浅色/深色写死。
- `<meta name="pi-plugin-chrome" content="v2">` 不要删。
- 面板要读写文件时，`permissions` 加 `fs.read` / `fs.write`，并在 `manifest.fs` 里写清范围——`fs.write` 不能声明整树。
- 想在主窗口里画东西（输入框旁按钮、消息操作栏、工具卡片）不是面板，那是 `renderer.extension` 插槽，本模板不覆盖。

## 校验与打包

```bash
node scripts/check.mjs plugins/local.guanwenbo.my-panel
node scripts/pack.mjs plugins/local.guanwenbo.my-panel
```
