/**
 * Archify 候选 JSON → Excalidraw 骨架数组。
 *
 * 只支持 `architecture`：它的 IR 里组件带真实像素坐标（`pos` / `size`），
 * 能一比一搬到画布上；workflow / sequence / erd 等用的是网格坐标（col / lane），
 * 要复刻 Archify 的布局常量才准，宁可先不做，也不导出一张错位的图。
 *
 * 产物仍是「骨架」（ExcalidrawElementSkeleton），由调用方交给
 * convertToExcalidrawElements 转成真元素。
 */

const FONT = 2; // 系统字体，中文不掉字
const TEXT_COLOR = "#1e1e1e";

/** 组件 type → 配色。Archify 示例里出现的 7 种，未知的走兜底灰。 */
const COMPONENT_STYLES = {
  external: { stroke: "#868e96", background: "#f1f3f5" },
  cloud: { stroke: "#0b7285", background: "#e3fafc" },
  backend: { stroke: "#1971c2", background: "#e7f5ff" },
  security: { stroke: "#e03131", background: "#fff5f5" },
  database: { stroke: "#2f9e44", background: "#ebfbee" },
  messagebus: { stroke: "#e8590c", background: "#fff4e6" },
  frontend: { stroke: "#7048e8", background: "#f3f0ff" },
};
const FALLBACK_STYLE = { stroke: "#495057", background: "#f8f9fa" };

function styleFor(type) {
  return COMPONENT_STYLES[String(type || "").toLowerCase()] ?? FALLBACK_STYLE;
}

function box(component) {
  const pos = Array.isArray(component.pos) ? component.pos : null;
  const size = Array.isArray(component.size) ? component.size : null;
  if (!pos || !size) return null;
  const width = Number(size[0]);
  const height = Number(size[1]);
  if (!Number.isFinite(width) || !Number.isFinite(height)) return null;
  return { x: Number(pos[0]), y: Number(pos[1]), width, height };
}

/** 从矩形中心指向目标点时，落在矩形边框上的交点。 */
function borderPoint(rect, targetX, targetY) {
  const cx = rect.x + rect.width / 2;
  const cy = rect.y + rect.height / 2;
  const dx = targetX - cx;
  const dy = targetY - cy;
  if (dx === 0 && dy === 0) return [cx, cy];
  const scaleX = dx === 0 ? Number.POSITIVE_INFINITY : rect.width / 2 / Math.abs(dx);
  const scaleY = dy === 0 ? Number.POSITIVE_INFINITY : rect.height / 2 / Math.abs(dy);
  const scale = Math.min(scaleX, scaleY);
  return [cx + dx * scale, cy + dy * scale];
}

function componentLabel(component) {
  const label = String(component.label ?? component.id ?? "").trim();
  const sublabel = String(component.sublabel ?? "").trim();
  return sublabel ? `${label}\n${sublabel}` : label;
}

function titleElement(id, x, y, text) {
  return { type: "text", id, x, y, text, fontSize: 22, fontFamily: FONT, strokeColor: "#495057" };
}

/**
 * @param {object} doc Archify architecture 候选 JSON
 * @returns {object[]} Excalidraw 骨架数组
 */
export function architectureToSkeleton(doc) {
  if (!doc || typeof doc !== "object") throw new Error("不是合法的 JSON 对象");
  const components = Array.isArray(doc.components) ? doc.components : [];
  if (!components.length) throw new Error("这个 JSON 里没有 components，不像 architecture 候选");

  const geometry = new Map();
  for (const component of components) {
    const rect = box(component);
    if (rect && component.id) geometry.set(component.id, rect);
  }
  if (!geometry.size) throw new Error("components 里没有可用的 pos / size，无法定位");

  const out = [];

  // 标题：放在所有内容上方
  const all = [...geometry.values()];
  const minX = Math.min(...all.map((rect) => rect.x));
  const minY = Math.min(...all.map((rect) => rect.y));
  const title = doc.meta && typeof doc.meta.title === "string" ? doc.meta.title : "架构图";
  out.push(titleElement("archify-title", minX, minY - 56, title));

  // 边界框先放：Excalidraw 里越靠前越在底层
  const boundaries = Array.isArray(doc.boundaries) ? doc.boundaries : [];
  boundaries.forEach((boundary, index) => {
    const members = (Array.isArray(boundary.wraps) ? boundary.wraps : [])
      .map((id) => geometry.get(id))
      .filter(Boolean);
    if (!members.length) return;
    const pad = Number.isFinite(Number(boundary.pad)) ? Number(boundary.pad) : 16;
    const left = Math.min(...members.map((rect) => rect.x)) - pad;
    const top = Math.min(...members.map((rect) => rect.y)) - pad;
    const right = Math.max(...members.map((rect) => rect.x + rect.width)) + pad;
    const bottom = Math.max(...members.map((rect) => rect.y + rect.height)) + pad;
    out.push({
      type: "rectangle",
      id: `archify-boundary-${index}`,
      x: left,
      y: top,
      width: right - left,
      height: bottom - top,
      strokeColor: "#868e96",
      backgroundColor: "transparent",
      fillStyle: "solid",
      strokeStyle: "dashed",
      strokeWidth: 1,
      roughness: 0,
      roundness: { type: 3 },
    });
    if (boundary.label) {
      out.push({
        type: "text",
        id: `archify-boundary-label-${index}`,
        x: left + 10,
        y: top + 6,
        text: String(boundary.label),
        fontSize: 14,
        fontFamily: FONT,
        strokeColor: "#868e96",
      });
    }
  });

  // 组件
  for (const component of components) {
    const rect = geometry.get(component.id);
    if (!rect) continue;
    const style = styleFor(component.type);
    out.push({
      type: "rectangle",
      id: `archify-node-${component.id}`,
      x: rect.x,
      y: rect.y,
      width: rect.width,
      height: rect.height,
      strokeColor: style.stroke,
      backgroundColor: style.background,
      fillStyle: "solid",
      strokeWidth: 2,
      roughness: 1,
      roundness: { type: 3 },
      label: {
        text: componentLabel(component),
        fontSize: 14,
        fontFamily: FONT,
        strokeColor: TEXT_COLOR,
        verticalAlign: "middle",
      },
    });
  }

  // 连线：显式两点几何 + 绑定（只给绑定不给 points 会渲染成零长度箭头）
  const connections = Array.isArray(doc.connections) ? doc.connections : [];
  connections.forEach((connection, index) => {
    const from = geometry.get(connection.from);
    const to = geometry.get(connection.to);
    if (!from || !to) return;
    const fromCenter = [from.x + from.width / 2, from.y + from.height / 2];
    const toCenter = [to.x + to.width / 2, to.y + to.height / 2];
    const start = borderPoint(from, toCenter[0], toCenter[1]);
    const end = borderPoint(to, fromCenter[0], fromCenter[1]);
    const element = {
      type: "arrow",
      id: `archify-edge-${index}`,
      x: start[0],
      y: start[1],
      width: Math.abs(end[0] - start[0]),
      height: Math.abs(end[1] - start[1]),
      points: [
        [0, 0],
        [end[0] - start[0], end[1] - start[1]],
      ],
      strokeColor: "#1e1e1e",
      strokeWidth: 2,
      start: { id: `archify-node-${connection.from}` },
      end: { id: `archify-node-${connection.to}` },
    };
    if (connection.label) {
      element.label = {
        text: String(connection.label),
        fontSize: 13,
        fontFamily: FONT,
        strokeColor: TEXT_COLOR,
      };
    }
    out.push(element);
  });

  // 说明卡片：放到内容右侧，一块文字
  const cards = Array.isArray(doc.cards) ? doc.cards : [];
  if (cards.length) {
    const maxRight = Math.max(...all.map((rect) => rect.x + rect.width));
    let y = minY;
    cards.forEach((card, index) => {
      const lines = [String(card.title ?? `Card ${index + 1}`), "——————"];
      for (const item of Array.isArray(card.items) ? card.items : []) lines.push(`· ${item}`);
      out.push({
        type: "text",
        id: `archify-card-${index}`,
        x: maxRight + 60,
        y,
        text: lines.join("\n"),
        fontSize: 13,
        fontFamily: FONT,
        strokeColor: TEXT_COLOR,
      });
      y += 30 + lines.length * 20;
    });
  }

  return out;
}

/** 面板里用来判定的快速摘要。 */
export function describeArchitecture(doc) {
  const components = Array.isArray(doc?.components) ? doc.components.length : 0;
  const connections = Array.isArray(doc?.connections) ? doc.connections.length : 0;
  const boundaries = Array.isArray(doc?.boundaries) ? doc.boundaries.length : 0;
  return {
    title: doc?.meta?.title ?? null,
    components,
    connections,
    boundaries,
    supported: doc?.diagram_type === undefined || doc?.diagram_type === "architecture",
    diagramType: doc?.diagram_type ?? null,
  };
}
