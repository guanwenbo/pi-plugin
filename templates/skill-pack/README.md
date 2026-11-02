# 模板：Skill Pack

最小「只贡献技能文档」的插件——没有面板、没有工具，只给 agent 注入领域知识或固定作业流程。

## 复制并使用

```bash
cp -R templates/skill-pack plugins/local.guanwenbo.my-skill-pack
```

1. 改 `manifest.json` 的 `id` / `name` / `contributes.skills`
2. 在 `skills/` 下写文档；每个文件必须有 front matter：

```markdown
---
name: 发布说明
description: 用户要发布说明或 changelog 时使用
---

正文……
```

3. 一个插件最多 32 个技能，单个 ≤128KiB，description ≤240 字符。

## 关键点

- **description 决定命中率**：写「用户说什么/在什么场景下用这个技能」，不要写技能内容摘要。
- 技能文档会进 system prompt 目录、按需读正文，和用户自己的 `AGENTS.md` 抢上下文——宁可少而准。
- 没有 `agent.prompt.inject` 权限时，`contributes.skills` 里的文件会被静默忽略。
- `main.js` 是 manifest 必填项带来的空文件，不要为了放逻辑而放逻辑。

## 校验与打包

```bash
node scripts/check.mjs plugins/local.guanwenbo.my-skill-pack
node scripts/pack.mjs plugins/local.guanwenbo.my-skill-pack
```
