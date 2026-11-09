# plugins/

自有插件库，**按分类分目录**，不再往一个目录里堆：

```
plugins/
├── agent/          给 agent 加能力（工具、技能包）
├── dev/            开发工具（Git、构建、调试、代码检索）
├── writing/        写作与文档（稿件、PRD/TRD、Markdown）
├── productivity/   效率与信息管理（待办、剪贴板、快速记录）
├── data/           数据查看与处理（CSV/JSON/SQL、图表）
├── diagram/        图示与结构可视化（架构图、建模图、流程图、时序图）
├── system/         桌面与系统集成（文件、进程、窗口、外观）
└── misc/           未分类暂存（定型后请移走）
```

```
plugins/<分类>/<插件 id>/
├── manifest.json   入口清单（id 与目录名一致）
├── main.js         manifest.main 指向的入口
└── README.md       这个插件干什么、权限、副作用
```

## 分类原则

按**做出来的东西给谁用 / 解决哪类问题**分，不按技术手段分（「用了面板」不代表归 system）。

- 只在对话里起作用、没有主界面 → `agent/`
- 有界面/有交互，看它服务哪件事
- 两类都像时放主要用途那一类；实在说不清先 `misc/`

每类能放什么、不该放什么，看各分类目录下的 `README.md`。新增分类就 `mkdir plugins/<分类>` 再写个 README 说明边界。

## 新建

```bash
# 分类必须显式写，不给就落 misc/
node scripts/new.mjs agent-tool dev/local.guanwenbo.my-dev-tool --name "我的开发小工具"
node scripts/new.mjs panel productivity/local.guanwenbo.todo
```

## 提交前

```bash
node scripts/check.mjs                                          # 全仓库（递归扫所有分类）
node scripts/pack.mjs plugins/dev/local.guanwenbo.my-dev-tool   # 单个插件
```

`check.mjs` / `pack.mjs` 都支持任意深度，插件放进哪个分类目录都不影响打包；`.piplug` 里只有插件目录本身的内容，不会带上分类目录。

`dist/` 与 `*.piplug` 已在 `.gitignore` 里，产物不进仓库。

## 索引

| 分类 | 放什么 | 插件 |
| --- | --- | --- |
| [`agent/`](./agent) | agent 工具、技能包 | — |
| [`dev/`](./dev) | Git、构建、调试、代码检索 | — |
| [`writing/`](./writing) | 稿件、PRD/TRD、Markdown | — |
| [`productivity/`](./productivity) | 待办、剪贴板、快速记录 | — |
| [`data/`](./data) | CSV/JSON/SQL、图表、报表 | — |
| [`diagram/`](./diagram) | 图示：架构图、建模图、流程/时序图 | [`local.guanwenbo.excalidraw-studio`](./diagram/local.guanwenbo.excalidraw-studio) 0.2.0 · [`local.guanwenbo.archify`](./diagram/local.guanwenbo.archify) 0.1.0 |
| [`system/`](./system) | 文件、进程、窗口、外观 | — |
| [`misc/`](./misc) | 未分类暂存 | — |

每加一个插件，更新对应行，并在仓库根 `README.md` 的清单里同步一条。
