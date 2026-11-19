#!/usr/bin/env python3
"""Captcha Kit worker — 本地识别与 macOS 桌面输入。

协议: python captcha_worker.py <command> '<json-args>'
所有结果以一行 JSON 打到 stdout: {"ok": true, ...} 或 {"ok": false, "error": "..."}
日志/警告一律走 stderr，避免污染 JSON。

commands:
  probe                     环境自检（ddddocr / Quartz / 屏幕缩放）
  ocr        {path}         字符验证码识别 -> {text}
  slide_match {background, target}
                            滑块小图+缺口背景 -> {x, y}（小图左上角在背景中的位置）
  slide_compare {with_gap, without_gap}
  slide_match {background, target}
                            滑块小图+缺口背景 -> {x, y}（缺口中心在背景图中的像素坐标）
  slide_compare {with_gap, without_gap}
                            两张完整背景对比 -> {x, y}（缺口中心像素坐标）
  click      {x, y}         macOS 屏幕坐标（点）单击
  drag       {points: [{x, y, t}]}
                            macOS 绝对坐标拖拽，t 为距上一点的毫秒等待
  type       {text}         macOS 键入 Unicode 文本
"""
import json
import sys
import time


def fail(msg):
    print(json.dumps({"ok": False, "error": str(msg)}, ensure_ascii=False))
    sys.exit(0)


def out(obj):
    obj["ok"] = True
    print(json.dumps(obj, ensure_ascii=False))
    sys.exit(0)


def read_bytes(path):
    with open(path, "rb") as f:
        return f.read()


def get_ocr():
    import ddddocr  # 延迟导入：probe/click 等命令不需要它

    return ddddocr.DdddOcr(show_ad=False)


def get_slide():
    import ddddocr

    return ddddocr.DdddOcr(det=False, ocr=False, show_ad=False)


def cmd_probe(_args):
    info = {"python": sys.version.split()[0], "ddddocr": False, "quartz": False}
    try:
        import ddddocr  # noqa: F401

        info["ddddocr"] = True
        info["ddddocrVersion"] = getattr(ddddocr, "__version__", "unknown")
    except Exception as e:
        info["ddddocrError"] = str(e)
    if sys.platform == "darwin":
        try:
            import Quartz  # noqa: F401

            info["quartz"] = True
            info["scale"] = display_scale()
        except Exception as e:
            info["quartzError"] = str(e)
    out(info)


def display_scale():
    """主屏 物理像素/逻辑点 比例（Retina 通常为 2）。"""
    import Quartz

    main = Quartz.CGMainDisplayID()
    bounds = Quartz.CGDisplayBounds(main)
    px_w = Quartz.CGDisplayPixelsWide(main)
    pt_w = bounds.size.width or 1
    return round(px_w / pt_w, 4)


def cmd_scale(_args):
    if sys.platform != "darwin":
        fail("scale is macOS only")
    out({"scale": display_scale()})


def cmd_ocr(args):
    ocr = get_ocr()
    text = ocr.classification(read_bytes(args["path"]))
    out({"text": text})


def cmd_slide_match(args):
    det = get_slide()
    res = det.slide_match(read_bytes(args["target"]), read_bytes(args["background"]))
    out(_slide_result(res))


def cmd_slide_compare(args):
    det = get_slide()
    res = det.slide_comparison(read_bytes(args["with_gap"]), read_bytes(args["without_gap"]))
    out(_slide_result(res))


def _slide_result(res):
    # ddddocr >=1.6 返回缺口【中心】坐标（target_x/target_y），旧版返回框左上角
    box = res.get("target") or [0, 0]
    x = int(res.get("target_x", box[0]))
    y = int(res.get("target_y", box[1]))
    r = {"x": x, "y": y, "semantics": "gap-center"}
    if "confidence" in res:
        r["confidence"] = round(float(res["confidence"]), 4)
    return r


def cmd_grid(args):
    from PIL import Image, ImageDraw

    img = Image.open(args["path"]).convert("RGB")
    w, h = img.size
    step = int(args.get("step") or 50)
    draw = ImageDraw.Draw(img)
    for x in range(0, w, step):
        draw.line([(x, 0), (x, h)], fill=(255, 0, 255), width=1)
        draw.text((x + 2, 2), str(x), fill=(255, 0, 255))
    for y in range(0, h, step):
        draw.line([(0, y), (w, y)], fill=(255, 0, 255), width=1)
        draw.text((2, y + 2), str(y), fill=(255, 0, 255))
    out_path = args["out"]
    img.save(out_path)
    out({"out": out_path, "width": w, "height": h, "step": step})


def _mouse_event(kind, x, y):
    import Quartz

    ev = Quartz.CGEventCreateMouseEvent(None, kind, (float(x), float(y)), Quartz.kCGMouseButtonLeft)
    Quartz.CGEventPost(Quartz.kCGHIDEventTap, ev)


def cmd_click(args):
    if sys.platform != "darwin":
        fail("desktop input is macOS only; on Windows use the computer-use plugin")
    import Quartz

    x, y = float(args["x"]), float(args["y"])
    _mouse_event(Quartz.kCGEventMouseMoved, x, y)
    time.sleep(0.05)
    _mouse_event(Quartz.kCGEventLeftMouseDown, x, y)
    time.sleep(0.06)
    _mouse_event(Quartz.kCGEventLeftMouseUp, x, y)
    out({"clicked": [x, y]})


def cmd_drag(args):
    if sys.platform != "darwin":
        fail("desktop input is macOS only; on Windows use the computer-use plugin")
    import Quartz

    points = args["points"]
    if not points:
        fail("drag needs non-empty points")
    p0 = points[0]
    _mouse_event(Quartz.kCGEventMouseMoved, p0["x"], p0["y"])
    time.sleep(0.08)
    _mouse_event(Quartz.kCGEventLeftMouseDown, p0["x"], p0["y"])
    for p in points[1:]:
        t = float(p.get("t", 16)) / 1000.0
        if t > 0:
            time.sleep(min(t, 0.5))
        _mouse_event(Quartz.kCGEventLeftMouseDragged, p["x"], p["y"])
    time.sleep(0.12)
    last = points[-1]
    _mouse_event(Quartz.kCGEventLeftMouseUp, last["x"], last["y"])
    out({"dragged": len(points), "end": [last["x"], last["y"]]})


def cmd_type(args):
    if sys.platform != "darwin":
        fail("desktop input is macOS only; on Windows use the computer-use plugin")
    import Quartz

    text = str(args.get("text") or "")
    if not text:
        fail("type needs non-empty text")
    ev = Quartz.CGEventCreateKeyboardEvent(None, 0, True)
    Quartz.CGEventKeyboardSetUnicodeString(ev, len(text), text)
    Quartz.CGEventPost(Quartz.kCGHIDEventTap, ev)
    ev_up = Quartz.CGEventCreateKeyboardEvent(None, 0, False)
    Quartz.CGEventPost(Quartz.kCGHIDEventTap, ev_up)
    out({"typed": len(text)})


COMMANDS = {
    "probe": cmd_probe,
    "scale": cmd_scale,
    "ocr": cmd_ocr,
    "slide_match": cmd_slide_match,
    "slide_compare": cmd_slide_compare,
    "grid": cmd_grid,
    "click": cmd_click,
    "drag": cmd_drag,
    "type": cmd_type,
}


def main():
    if len(sys.argv) < 2 or sys.argv[1] not in COMMANDS:
        fail(f"unknown command; expected one of {sorted(COMMANDS)}")
    try:
        args = json.loads(sys.argv[2]) if len(sys.argv) > 2 else {}
    except Exception as e:
        fail(f"bad json args: {e}")
    try:
        COMMANDS[sys.argv[1]](args)
    except SystemExit:
        raise
    except Exception as e:
        fail(f"{type(e).__name__}: {e}")


if __name__ == "__main__":
    main()