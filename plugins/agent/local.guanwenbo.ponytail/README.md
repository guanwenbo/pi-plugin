# Ponytail for PI-Desktop

Lazy senior dev mode for your coding agent. **The best code is the code you never wrote.**

## 这是什么 / What this is

A PI-Desktop **skill pack** adapted from [DietrichGebert/ponytail](https://github.com/DietrichGebert/ponytail) v5.3.3 (MIT license). It injects a ruleset that makes the agent write the smallest complete change: reuse existing code first, then stdlib / platform features, then installed dependencies, and only then the minimum new code — while never cutting validation, error handling, security, or accessibility.

把上游 Ponytail 的核心规则迁成 PI-Desktop 技能包：让 Agent 像"最懒但最老练的资深工程师"一样，先复用、再标准库/平台原生、最后才写最小实现；校验、错误处理、安全、无障碍永不许砍。

## Skills / 技能

| Skill | 用途 |
|---|---|
| `ponytail` | 核心规则：最小完整改动 + 决策阶梯 + lite/full/ultra 三档 |
| `ponytail-review` | 像资深工程师一样评审 diff：读改动波及的代码，查 bug/安全/负载/缺测试/慢路径/可删代码 |
| `ponytail-audit` | 同样的检查跑整个仓库，按严重度排序 |
| `ponytail-debt` | 收割 `shortcut:` 注释成技术债台账 |
| `ponytail-help` | 用法速查卡（Desktop 版） |

触发：直接说 "ponytail"、"be lazy"、"review this"、"audit this codebase"、"ponytail debt"，或输入 `/ponytail-review` 等纯文本命令。说 "stop ponytail" 或 "normal mode" 结束懒模式。

## 不是什么 / What this is NOT

- **不是** Claude Code 原版插件：band 状态条、board 统计页、生命周期 hooks、`/ponytail-gain` 记分板依赖 Claude Code 专属扩展点，未包含也无法迁移。
- **不是** 工具或面板插件：不注册 Agent 工具、不开面板、不写文件、不联网、不读密钥。唯一权限是 `agent.prompt.inject`（向提示词注入技能说明）。
- **不是** 语言/平台限制：规则跨语言通用（H5/iOS/Android/鸿蒙/小程序/Java/Python/大数据均适用）；效果上限取决于所用模型对目标平台的熟悉度。
- 上游宣传的收益数字（-53% 代码等）来自官方基准；JetBrains 独立实测约 -15%，幅度存疑，方向有效。

## Safety / 安全说明

Prompt-injection only. Disabling the plugin on the plugins page fully restores default agent behavior. No keys, no network, no filesystem access.

仅注入提示词说明；在插件页禁用即完全恢复默认行为。无密钥、无网络、无文件系统访问。

## Attribution / 来源

Upstream: DietrichGebert/ponytail, MIT. Core rules and review/audit/debt skill bodies are kept faithful to upstream v5.3.3; front matter, triggers, and the help card were adapted for PI-Desktop. Entry renamed to `main.cjs` for ESM-workspace compatibility.

## Changelog

- **1.0.0** — 首个正式版本：迁移核心规则 + review/audit/debt/help 共 5 个技能；去除 Claude Code 专属内容；全局生效。