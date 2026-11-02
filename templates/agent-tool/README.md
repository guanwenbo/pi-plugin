# 模板：Agent Tool

最小「给 agent 加一个工具」的插件。

## 复制并使用

```bash
cp -R templates/agent-tool plugins/local.guanwenbo.my-tool
```

然后改三处，名称要一致：

1. `manifest.json` → `id`、`name`、`contributes.agentTools[0].name`
2. `main.js` → `TOOL_NAME` 常量、`registerTool` 的 `description` / `schema` / `execute`
3. 需要更多能力时同步放宽 `permissions`（例如读文件加 `fs.read` + `manifest.fs.read`）

## 关键点

- `description` 是模型决定「要不要用这个工具」的唯一依据，写清触发场景，别写实现细节。
- `schema` 用 JSON Schema；`additionalProperties: false` + 单值 `enum` 是社区惯用的「固定 action」写法。
- `execute` 内抛错即工具失败；返回对象会序列化进对话，别塞大段二进制。
- 工具调用超时 110s。
- 纯工具插件不需要 `ui.panel`，也不需要 `contributes.commands`。

## 校验与打包

```bash
node scripts/check.mjs plugins/local.guanwenbo.my-tool
node scripts/pack.mjs plugins/local.guanwenbo.my-tool
```
