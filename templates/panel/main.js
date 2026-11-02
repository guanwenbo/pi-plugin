/**
 * Template: Panel — PI-Desktop 插件入口。
 *
 * 面板本身是 renderer/index.html，跑在宿主给的独立窗口里，拿到的是
 * window.pluginBridge（固定通道白名单），不是这里的 `pi`。
 * 这个文件只负责注册命令 / 初始化宿主侧状态。
 */

const OPEN_COMMAND = "template-panel.open";

async function onLoad() {
  await pi.commands.register({
    id: OPEN_COMMAND,
    title: "Template Panel: 打开面板",
    keywords: ["template-panel", "panel"],
    run: async () => {
      await pi.ui.openPanel({ title: "Template Panel" });
    },
  });
}

async function onUnload() {
  await pi.commands.unregister(OPEN_COMMAND);
}

module.exports = { onLoad, onUnload };
