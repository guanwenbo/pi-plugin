# Captcha Kit 验证码助手

PI-Desktop Agent 插件：识别并操作验证码。**仅限你自己拥有或已获授权的站点/测试环境**（自有产品、内部系统、自动化测试）。

## 是什么

- **识别核心**（本地，不上传）：
  - 字符验证码 → [ddddocr](https://github.com/sml2h3/ddddocr) OCR
  - 滑块缺口 → ddddocr `slide_match`（小图+背景）/ `slide_comparison`（双背景对比）
  - 点选类（文字/图标点选）→ 插件回传原图 + 坐标网格图，由会话视觉模型看图给出有序点击坐标
- **操作层**：
  - 工作面板浏览器：宿主 `pi.browser.cdp` 通道，截验证码元素图 / 类人轨迹拖拽 / 坐标点击 / 填写
  - macOS 桌面：`screencapture` 截图 + Quartz 键鼠（需辅助功能/屏幕录制权限）
  - Windows 桌面：识别照用，操作转 [computer-use] 插件
- **编排技能** `captcha-kit`：授权门禁 → 环境 → 取图 → 识别 → 坐标换算 → 操作 → 验证，失败重试上限 3 次。

## 不是什么

- 不是第三方网站反爬/风控绕过工具——技能对未授权目标直接拒绝。
- 不承诺通过任何行为风控（轨迹仅为普通类人形态，不做对抗性"伪装升级"）。
- 不是打码平台客户端，不调用任何付费打码 API。

## 工具

| 工具 | 作用 | 风险 |
| --- | --- | --- |
| `captcha_env` | check 自检 / setup 后台安装私有 venv（`~/.pi-desktop/captcha-kit/venv`） | high（pip 下载） |
| `captcha_recognize` | text / slide / click 三型识别 | medium |
| `captcha_slide_track` | 类人拖拽轨迹（纯 JS） | low |
| `captcha_browser` | capture / drag / click / fill（页面 CSS 像素） | high（CDP 输入） |
| `captcha_desktop` | screenshot / click / drag / type（macOS 屏幕点） | high（系统键鼠） |

## 安装与首次使用

1. 插件页加载本目录（开发）或安装 `.piplug`。
2. 对 Agent 说「检查验证码环境」→ `captcha_env check`；未就绪则 `setup`（默认清华 pip 镜像，可传 `index` 换源），轮询至 `ready=true`。
3. macOS 桌面通道需在「系统设置 → 隐私与安全性」给 PI-Desktop 开**辅助功能**与**屏幕录制**。

## 安全说明（能力/数据流）

- `setup` 后台拉起 pip，从镜像源下载 ddddocr / onnxruntime / pillow / pyobjc 到用户目录私有 venv，不改系统 Python。
- 高风险工具可移动鼠标、点击、拖拽、键入，并向工作面板浏览器派发 CDP 输入事件；全部经宿主权限门（`browser.cdp`）与工具风险确认。
- 验证码图片仅本地处理；点选类图片作为多模态块附加到**当前会话**，不上传任何第三方。
- 负路径：环境未就绪 → 明确报错指路 setup；跨域 canvas 污染且截图通道不可用 → 报错并建议手动存图；非 macOS 调桌面工具 → 拒绝并指路 computer-use；权限缺失 → 报错附开启指引。

## English

Recognize and operate captchas **only on sites you own or are authorized to test**. Text OCR and slider-gap detection run locally via ddddocr; click-type captchas are solved by the session vision model reading an attached coordinate grid. Operation channels: work-panel browser (host CDP: capture/drag/click/fill) and macOS desktop (screencapture + Quartz input; Windows desktop delegates to the computer-use plugin). Not an anti-bot bypass tool for third-party sites; no paid captcha-solving APIs; images never leave the machine except as multimodal input to the current agent conversation. Retries capped at 3.