---
name: Archify 校验式图表
description: 用户要画架构图/流程图/时序图/数据流/状态机/ERD/类图/树/时间线/瀑布图，或要把回答做成一页（explainer）时使用；用 archify_* 工具出经过门禁校验的单文件 HTML。
---

# Archify 校验式图表

产出的是**一个自包含 HTML**（可交互、深浅色、可导出图/视频），不是画布文件。走过门禁才算成功——「渲染出来了」不等于「通过」。

## 什么时候用

- 用户要结构化的图：架构、流程、时序、数据流、状态机、ERD、类图、树、时间线、瀑布
- 用户要「做成一页」「用页面讲」，或需要一页带结论的说明
- 需要可分享、可留档的图（一个 HTML 文件搞定）

什么时候不用：用户明确要**手绘/可自由拖动编辑**的画布，那用 Excalidraw 画布插件；要数据驱动的柱状/折线图，那也不是本技能。

## 流程

1. `archify_types` — 拿类型清单与运行时路径（references / schemas / examples 都在里面）
2. `archify_examples {type}` — 拿同类型示例 JSON 的**绝对路径**，读它学结构。示例只教形状，事实必须来自用户需求或代码
3. 写候选：`diagrams/archify/<type>-<slug>/candidate.json`
   - `meta.output` 用相对工作区根的路径；`meta.locale` 设 `zh-CN`（内置），`meta.quality_profile` 一般 `showcase`，密集 schema 用 `standard`
4. `archify_finalize {type, candidate, output}` — 输出放 `diagrams/<slug>.html`
5. 失败：读 `diagnostics[]`，只改 `subject` 指向的对象，用 `supportedFixes` 里给的修法；**最多两轮**，禁止整图重写
6. 成功：把 HTML 相对路径告诉用户（面板里能直接打开）；需要手改时，架构图可用 Excalidraw 画布插件导入该候选 JSON

`archify_validate` 是不出产物的快速检查，只在想先摸清 schema 错误时用；正常直接 finalize。

## 硬约束

- `output` 必须以 `diagrams/` 开头（插件的写范围就是 `diagrams/**`），且用相对路径
- 四种门禁是 validate → deliver → check → **browser-check**（真实浏览器），一次 finalize 全跑；`gates` 四项都 pass 才算成功
- 只有 exit code 0 且 `ok: true` 才算成功；失败时 `diagnostics` 是唯一可靠的修复依据
- finalize 内含一次有界版本检查，网络不通不影响交付
