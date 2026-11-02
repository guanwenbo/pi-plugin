# plugins/agent/ — agent 能力

放直接增强 **agent 本身**的插件：给它加工具、加技能文档、加作业流程。共同点是没有自己的主界面，价值在对话里。

## 适合放

- 注册 agent 工具（`agent.tool.register`），比如文本处理、编码转换、本地探测
- 纯技能包（`agent.prompt.inject`），比如某个领域的作业规范、固定输出格式
- 工具 + 技能的组合

## 不适合放

- 有独立面板窗口的 → 看功能归到其它分类（`../dev/`、`../writing/` 等）
- 只是改主题外观 → 暂放 `../system/`

## 目录约定

一个插件一个目录，目录名 = manifest id：`local.guanwenbo.<名字>/`，目录内自带说明用途与权限的 `README.md`。
