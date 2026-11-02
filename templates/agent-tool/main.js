/**
 * Template: Agent Tool — PI-Desktop 插件入口。
 *
 * 宿主注入全局 `pi`；每个调用都受 manifest.json 里的 permissions 约束，
 * 想多做一件事通常意味着同时放宽 permissions。
 *
 * 工具约定：
 *   - contributes.agentTools 里声明的 name / description / schema 是给模型看的，
 *     真正的实现写在 pi.agent.registerTool() 里，两处 name 必须一致。
 *   - execute 返回可 JSON 序列化的对象；抛错会被当作工具失败回给 agent。
 *   - risk 取 low / medium / high，宿主按它决定要不要用户确认。
 */

const TOOL_NAME = "template_count_words";

async function onLoad() {
  await pi.agent.registerTool({
    name: TOOL_NAME,
    description:
      "Count characters, words and lines of a text. Replace this with what your tool actually does.",
    risk: "low",
    schema: {
      type: "object",
      additionalProperties: false,
      properties: {
        action: { type: "string", enum: ["count"], description: "Fixed action name." },
        text: { type: "string", description: "Text to measure." },
      },
      required: ["action", "text"],
    },
    execute: async (args) => {
      const text = typeof args?.text === "string" ? args.text : "";
      if (!text) throw new Error(`${TOOL_NAME}: \`text\` must be a non-empty string.`);
      return {
        characters: text.length,
        words: text.trim() ? text.trim().split(/\s+/).length : 0,
        lines: text.split(/\r\n|\r|\n/).length,
      };
    },
  });
}

async function onUnload() {
  await pi.agent.unregisterTool(TOOL_NAME);
}

module.exports = { onLoad, onUnload };
