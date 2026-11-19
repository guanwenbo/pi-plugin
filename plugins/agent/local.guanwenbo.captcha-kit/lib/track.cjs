/**
 * Captcha Kit — 类人滑块拖拽轨迹生成（纯 JS，无依赖）。
 * 输出相对起点的偏移序列 [{x, y, t}]，t 为距上一点的毫秒等待。
 * 形态：先加速后减速 + 轻微过冲回拉 + 微小纵向抖动。
 */
"use strict";

function generateTrack(distance, opts = {}) {
  const dist = Number(distance);
  if (!Number.isFinite(dist) || dist <= 0) throw new Error("distance must be a positive number of pixels");
  const duration = Math.min(Math.max(Number(opts.duration) || 900, 300), 4000);
  const stepMs = 16;
  const n = Math.max(Math.round(duration / stepMs), 8);
  const overshoot = Math.min(4 + Math.random() * 8, dist * 0.15);
  const peak = dist + overshoot;
  const backStart = Math.floor(n * 0.8); // 前 80% 冲到过冲点，后 20% 回拉
  const points = [{ x: 0, y: 0, t: 0 }];
  let prevX = 0;
  let prevY = 0;
  for (let i = 1; i <= n; i++) {
    let x;
    if (i <= backStart) {
      const p = i / backStart;
      // easeOutCubic：起步快、临近缺口减速
      x = peak * (1 - Math.pow(1 - p, 3));
    } else {
      const p = (i - backStart) / (n - backStart);
      x = peak - overshoot * p;
    }
    const y = i === n ? 0 : (Math.random() - 0.5) * 2; // ±1px 抖动，终点归零
    points.push({
      x: Math.round(x * 10) / 10,
      y: Math.round((prevY + y) * 10) / 10,
      t: stepMs + Math.floor(Math.random() * 8),
    });
    prevX = x; prevY = y;
  }
  // 终点精确对齐
  points[points.length - 1].x = Math.round(dist * 10) / 10;
  points[points.length - 1].y = 0;
  return { distance: dist, duration, points };
}

module.exports = { generateTrack };