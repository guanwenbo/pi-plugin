# plugins/

自有插件目录：**一个子目录 = 一个插件**。

## 约定

- 目录名与 manifest 的 `id` 一致，例如 `local.guanwenbo.my-panel/`
- 每个目录里必须有 `manifest.json`，入口是它 `main` 指向的文件
- 每个插件自带 `README.md`：这个插件干什么、怎么用、装了哪些权限、有什么副作用
- 版本改动写在该插件的 `README.md` 或提交信息里；跨插件的公共约定写在仓库根 `README.md`

## 新建

```bash
node scripts/new.mjs agent-tool local.guanwenbo.my-tool --name "我的工具"
```

## 提交前

```bash
node scripts/check.mjs          # 全仓库预检
node scripts/pack.mjs plugins/local.guanwenbo.my-tool
```

`dist/` 与 `*.piplug` 已在 `.gitignore` 里，产物不进仓库。

## 清单

| 插件 | id | 版本 | 说明 |
| --- | --- | --- | --- |
| _（还没有插件，从模板起一个）_ | | | |

新增插件时，这张表和仓库根 `README.md` 的清单一起更新。
