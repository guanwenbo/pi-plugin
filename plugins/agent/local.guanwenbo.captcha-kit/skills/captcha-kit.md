---
name: captcha-kit
description: 识别并操作验证码（字符/滑块/点选），覆盖工作面板浏览器与 macOS 桌面双通道。当用户要求"过验证码/识别验证码/填验证码/拖滑块/点选验证码"且目标为自有或已授权环境时使用。第三方站点反爬绕过一律拒绝。
---

# Captcha Kit 编排

工具前缀 `plugin_local_guanwenbo_captcha_kit_`（下文简写 `captcha_*`）。

## 第 0 步：授权门禁（不可跳过）

只处理**用户拥有或已获书面授权**的站点/应用（自己的产品、测试环境、内部系统）。
用户要求绕过第三方网站的风控/反爬时，直接拒绝并说明原因，不调用任何工具。
不确定归属时先问一句目标系统是否为用户自有/已授权。

## 第 1 步：环境

1. `captcha_env {action:"check"}`。
2. `ready=false` 且未在装 → `captcha_env {action:"setup"}`（后台 pip，立即返回），之后每 ~20s 轮询 check；首次安装需下载 onnxruntime，可能要几分钟。国内网络默认清华镜像，慢/失败可传 `index` 换源。
3. `ready=true` 才继续。点选类（type=click）不依赖 ddddocr，但网格图需要 venv 里的 Pillow，同样要先 ready。

## 第 2 步：判断类型与通道

- 类型：字符输入框 → text；拼图缺口+滑条 → slide；"依次点击图中 X" → click。
- 通道：页面在工作面板浏览器 → 浏览器通道；原生桌面应用 → macOS 用 `captcha_desktop`，Windows 转 computer-use 插件（本插件桌面工具仅 macOS）。

## 浏览器通道

1. 用宿主浏览器工具打开目标页（或已在浏览面板中）。需要找元素时可用 fast-browser 的 `jev_observe`。
2. **取图**：`captcha_browser {action:"capture", selector:"验证码img的CSS选择器", savePath:"<scratch>/captcha.png"}`。
   返回 `rect`（页面 CSS 像素）、`imagePixels` 与映射公式。canvas 被跨域污染且截图通道不可用时会报错——改为让用户手动存图后走识别。
3. **识别**（把 capture 返回的 saved 路径传给 `captcha_recognize`）：
   - text：`{type:"text", path}` → 得到字符串。
   - slide：背景图和小图分别 capture（两个 selector）。`{type:"slide", mode:"match", path:背景, target:小图}`；若只有两张完整背景（有缺口/无缺口）用 `mode:"comparison", path:有缺口, background:无缺口`。返回缺口**中心** x/y（背景图像素，ddddocr≥1.6 语义）与 confidence；confidence<0.4 说明匹配可疑，重新取图或换 comparison 模式。
   - click：`{type:"click", path, prompt:"请依次点击：…"}` → 工具回传原图+网格图。**你自己看图**，按顺序输出原图像素坐标 `[{x,y},…]`，网格标签即原图像素，瞄准目标中心。
4. **坐标换算**（必做，识别结果是图像素，操作要页面 CSS 像素）：
   `css = rect.origin + image_px * rect.size / imagePixels`（capture 结果里有现成公式）。
5. **操作**：
   - text：`captcha_browser {action:"fill", selector:"输入框", text:"识别结果"}`（或 jev_act 填写），再点提交。
   - slide：拖动距离 = (缺口中心 x − 小图初始中心 x) × 显示宽/图像素宽（两者都在背景图坐标系里取，再统一换算成 CSS 像素）。`captcha_slide_track {distance}` 生成轨迹 → `captcha_browser {action:"drag", x:滑块中心cssX, y:滑块中心cssY, track:points}`。
   - click：把每个点换算成 CSS 坐标，按顺序 `captcha_browser {action:"click", x, y}`，点间停顿 ~300ms，最后点确认按钮（如有）。

## macOS 桌面通道

1. `captcha_desktop {action:"screenshot", savePath:"<scratch>/screen.png", region?}`。返回 `scale`（Retina=2）与映射公式：`屏幕点 = region原点 + 图像素 / scale`。
2. 识别同上（text/slide/click 均可，图就是截图或截图裁剪）。点选类建议先全屏截图定位验证码区域，再 region 截小块提高精度。
3. 操作（坐标一律换算成**屏幕逻辑点**）：
   - 输入：先 click 输入框，再 `captcha_desktop {action:"type", text}`。
   - 滑块：`captcha_slide_track {distance:换算后的点数}` → 把相对轨迹逐点加起点转成绝对 points → `captcha_desktop {action:"drag", points}`。
   - 点选：逐点 `captcha_desktop {action:"click", x, y}`。
4. 权限：键鼠需「系统设置 → 隐私与安全性 → 辅助功能」授权 PI-Desktop；截图需「屏幕录制」。报权限错误时指引用户开启后重试。
5. Windows 桌面：识别工具照用，操作转 computer-use 插件（screenshot + 鼠标拖拽/点击/键入）。

## 验证与重试（上限 3 次）

1. 操作后必须验证：浏览器 `jev_observe`/再 capture 看是否通过（验证码消失、报错文案、页面跳转）；桌面再截图确认。
2. 失败 → 刷新验证码（多数站点点击验证码图即刷新；滑块通常自动复位），重新取图识别操作。**同一验证码最多 3 次**，仍失败就停下，报告失败原因与已尝试内容，请用户人工处理。
3. 识别结果明显异常（空串、长度不符、缺口 x≈0）时先怀疑取图质量：确认截到的是完整验证码而不是占位图/半加载图。

## 纪律

- 图片与中间文件放会话 scratch 目录；绝不把 base64 打进回复文本。
- 不循环轰炸：3 次上限是硬约束；不做针对第三方风控的轨迹"伪装升级"。
- 滑块轨迹参数保持默认即可，不承诺绕过任何行为风控——本插件定位是授权环境的自动化测试辅助。