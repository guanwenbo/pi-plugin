/**
 * 画布插件的命令面板命令：检查更新 / 更新插件。
 *
 * 更新源与 archify 插件一致（仓库根 latest.json），逻辑在 updater.js 里（两份副本内容相同）。
 * 宿主的 market.applyUpdates 只覆盖 marketplace 来源，本地来源只能自己更新。
 */

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const updater = require("./updater.js");

const PLUGIN_DIR = __dirname;
const MANIFEST = JSON.parse(fs.readFileSync(path.join(PLUGIN_DIR, "manifest.json"), "utf8"));
const BACKUP_DIR = path.join(os.tmpdir(), "pi-excalidraw-studio-update");

const COMMANDS = [
  {
    id: "excalidraw-studio.checkUpdate",
    title: "Excalidraw 画布: 检查更新",
    keywords: ["excalidraw", "update", "更新"],
    run: async () => {
      const info = await updater.checkForUpdate(MANIFEST.id, MANIFEST.version);
      await pi.ui.showToast(
        info.latest === null
          ? "更新清单里没有这个插件，跳过检查"
          : info.available
            ? `${MANIFEST.name} 有新版本 ${info.latest}（当前 ${info.current}），运行命令「Excalidraw 画布: 更新插件」安装`
            : `${MANIFEST.name} 已是最新（${info.current}）`,
      );
      return info;
    },
  },
  {
    id: "excalidraw-studio.applyUpdate",
    title: "Excalidraw 画布: 更新插件",
    keywords: ["excalidraw", "update", "升级"],
    run: async () => {
      const info = await updater.checkForUpdate(MANIFEST.id, MANIFEST.version);
      if (!info.available) {
        await pi.ui.showToast(`${MANIFEST.name} 已是最新（${info.current}）`);
        return { ok: true, updated: false, current: info.current };
      }
      const staged = await updater.downloadAndStage(info.entry, path.join(BACKUP_DIR, `staging-${info.latest}`));
      updater.applyStaged(
        staged.stagingDir,
        PLUGIN_DIR,
        path.join(BACKUP_DIR, `previous-${info.current}`),
      );
      await pi.ui.showToast(`已更新到 ${staged.version}，重启 PI-Desktop 生效`);
      return { ok: true, updated: true, from: info.current, to: staged.version };
    },
  },
];

async function register() {
  for (const command of COMMANDS) {
    await pi.commands.register({
      id: command.id,
      title: command.title,
      keywords: command.keywords,
      run: async () => {
        try {
          return await command.run();
        } catch (error) {
          await pi.ui.showToast(`${command.title} 失败：${(error && error.message) || error}`);
          return { ok: false, error: String((error && error.message) || error) };
        }
      },
    });
  }
}

async function unregister() {
  for (const command of COMMANDS) {
    try {
      await pi.commands.unregister(command.id);
    } catch {
      // 未注册成功时忽略
    }
  }
}

/** 加载时静默检查一次；有新版本用系统通知提示（不打扰、失败不报错）。 */
function backgroundCheck() {
  updater
    .checkForUpdate(MANIFEST.id, MANIFEST.version)
    .then(async (info) => {
      if (!info.available) return;
      await pi.ui.notify(
        `${MANIFEST.name} 有新版本 ${info.latest}，命令面板执行「Excalidraw 画布: 更新插件」即可升级`,
      );
    })
    .catch(() => {
      // 离线或清单不可达：静默
    });
}

module.exports = { register, unregister, backgroundCheck };
