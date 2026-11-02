/**
 * Template: Skill Pack — PI-Desktop 插件入口。
 *
 * 技能是有 manifest.contributes.skills 声明的 Markdown 文档，由宿主直接索引，
 * 走的是 `agent.prompt.inject` 权限，不需要在这里注册任何东西。
 *
 * 这个文件存在的唯一原因是 manifest.main 是必填项；保留空实现即可。
 * 如果以后要在加载时做校验或预热（例如检查技能文件是否齐全），写在这里。
 */

async function onLoad() {
  // 无运行时代码贡献。
}

async function onUnload() {
  // 无运行时代码贡献。
}

module.exports = { onLoad, onUnload };
