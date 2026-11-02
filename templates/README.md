# templates/

三套最小可运行的插件模板，`node scripts/check.mjs` 全绿，可直接 `pack`。

| 模板 | 形态 | 权限 | 用途 |
| --- | --- | --- | --- |
| [`agent-tool/`](./agent-tool) | 只注册一个 agent 工具 | `agent.tool.register` | 给 agent 加能力，没有界面 |
| [`panel/`](./panel) | 命令 + 独立面板窗口 | `ui.panel` | 要做界面/交互时从这里起 |
| [`skill-pack/`](./skill-pack) | 只贡献技能 Markdown | `agent.prompt.inject` | 沉淀作业流程和领域知识 |

## 用法

```bash
# 方式一：复制
cp -R templates/agent-tool plugins/local.guanwenbo.my-tool

# 方式二：脚本复制（自动替换 id / name / 目录名）
node scripts/new.mjs agent-tool local.guanwenbo.my-tool
```

复制完再按各模板的 README 改内容。模板本身不要当成插件装到 PI-Desktop 里——它们的 id 是 `local.template-*`，只是起点。
