/**
 * Excalidraw 架构与建模画布 — 宿主侧入口。
 *
 * 画布本身是 renderer/index.html 里挂载的 Excalidraw，跑在独立面板窗口；
 * 这个文件只负责注册命令、打开面板。读写文件在面板里走 window.pluginBridge，
 * 受 manifest 的 fs.read / fs.write 范围约束。
 */

const OPEN_COMMAND = "excalidraw-studio.open";

async function onLoad() {
  await pi.commands.register({
    id: OPEN_COMMAND,
    title: "Excalidraw: 打开画布",
    keywords: ["excalidraw", "diagram", "draw", "画图", "架构图", "流程图", "时序图"],
    run: async () => {
      await pi.ui.openPanel({ title: "Excalidraw 画布" });
    },
  });
}

async function onUnload() {
  await pi.commands.unregister(OPEN_COMMAND);
}

module.exports = { onLoad, onUnload };
