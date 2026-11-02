/**
 * 四种图的骨架生成器。
 *
 * 每个函数返回 Excalidraw 的「骨架数组」（ExcalidrawElementSkeleton），
 * 由 @excalidraw/excalidraw 的 convertToExcalidrawElements 转成真正的元素。
 *
 * 踩过的坑：只给 start/end 绑定、不给 points 的箭头，转换出来是一条零长度箭头
 * （渲染成贴在方框里的小箭头）。所以这里的箭头一律「显式几何 + 绑定」都写：
 * points 决定这条线怎么画，start/end 只用来记住连的是谁，拖动方框时还会跟着走。
 *
 * 约定：fontFamily 用 2（系统字体），中文才不会因为缺手写体字体文件而掉字。
 */

const FONT = 2; // Helvetica / 系统无衬线，覆盖中文
const TEXT_COLOR = "#1e1e1e";

const PALETTES = {
  blue: { stroke: "#1971c2", bg: "#e7f5ff" },
  green: { stroke: "#2f9e44", bg: "#ebfbee" },
  orange: { stroke: "#e8590c", bg: "#fff4e6" },
  purple: { stroke: "#7048e8", bg: "#f3f0ff" },
  gray: { stroke: "#495057", bg: "#f1f3f5" },
  red: { stroke: "#e03131", bg: "#fff5f5" },
};

function rect(id, x, y, width, height, label, paletteName, extra = {}) {
  const palette = PALETTES[paletteName] ?? PALETTES.gray;
  const element = {
    type: "rectangle",
    id,
    x,
    y,
    width,
    height,
    strokeColor: palette.stroke,
    backgroundColor: palette.bg,
    fillStyle: "solid",
    strokeWidth: 2,
    roughness: 1,
    roundness: { type: 3 },
    ...extra,
  };
  if (label) {
    element.label = {
      text: label,
      fontSize: extra.fontSize ?? 16,
      fontFamily: FONT,
      strokeColor: TEXT_COLOR,
      verticalAlign: "middle",
    };
  }
  return element;
}

function title(id, x, y, text, color = "#495057", fontSize = 22) {
  return { type: "text", id, x, y, text, fontSize, fontFamily: FONT, strokeColor: color };
}

/**
 * 箭头：显式两点几何 + 绑定信息。
 * @param {[number, number]} from 起点
 * @param {[number, number]} to 终点
 */
function arrow(id, fromId, toId, from, to, label, extra = {}) {
  const [x1, y1] = from;
  const [x2, y2] = to;
  const element = {
    type: "arrow",
    id,
    x: x1,
    y: y1,
    width: Math.abs(x2 - x1),
    height: Math.abs(y2 - y1),
    points: [
      [0, 0],
      [x2 - x1, y2 - y1],
    ],
    strokeColor: extra.strokeColor ?? "#1e1e1e",
    strokeWidth: 2,
    ...(fromId ? { start: { id: fromId } } : {}),
    ...(toId ? { end: { id: toId } } : {}),
    ...extra,
  };
  if (label) {
    element.label = { text: label, fontSize: 14, fontFamily: FONT, strokeColor: TEXT_COLOR };
  }
  return element;
}

// —————————————————————————— 1. 技术架构图 ——————————————————————————

export function techArchitecture() {
  const layers = [
    { name: "接入层", palette: "blue", items: ["Web 客户端", "移动端 App", "第三方系统"] },
    { name: "网关层", palette: "orange", items: ["API 网关", "鉴权 / 限流", "负载均衡"] },
    { name: "应用层", palette: "green", items: ["用户服务", "订单服务", "支付服务", "消息服务"] },
    { name: "中间件", palette: "purple", items: ["消息队列", "分布式缓存", "任务调度"] },
    { name: "数据层", palette: "gray", items: ["MySQL 主库", "MySQL 从库", "对象存储"] },
  ];

  const LEFT = 80;
  const BAND_W = 940;
  const BAND_H = 136;
  const GAP = 76;
  const BOX_W = 196;
  const BOX_H = 60;
  const SLOT_GAP = 26;
  const LABEL_H = 44;

  const out = [title("title", LEFT, -60, "技术架构图（改名 / 增删方框即可）")];
  const bandY = layers.map((_, index) => index * (BAND_H + GAP));

  layers.forEach((layer, layerIndex) => {
    const y = bandY[layerIndex];
    out.push(rect(`band-${layerIndex}`, LEFT, y, BAND_W, BAND_H, null, layer.palette));
    out.push(title(`band-name-${layerIndex}`, LEFT + 18, y + 12, layer.name, PALETTES[layer.palette].stroke, 18));

    const count = layer.items.length;
    const totalWidth = count * BOX_W + (count - 1) * SLOT_GAP;
    const startX = LEFT + (BAND_W - totalWidth) / 2;
    layer.items.forEach((label, boxIndex) => {
      out.push(
        rect(
          `box-${layerIndex}-${boxIndex}`,
          startX + boxIndex * (BOX_W + SLOT_GAP),
          y + LABEL_H,
          BOX_W,
          BOX_H,
          label,
          "gray",
          { backgroundColor: "#ffffff" },
        ),
      );
    });
  });

  const centerX = LEFT + BAND_W / 2;
  for (let index = 0; index < layers.length - 1; index += 1) {
    const fromY = bandY[index] + BAND_H;
    const toY = bandY[index + 1];
    out.push(
      arrow(
        `link-${index}`,
        `band-${index}`,
        `band-${index + 1}`,
        [centerX, fromY],
        [centerX, toY],
        null,
        { strokeColor: "#868e96" },
      ),
    );
  }

  return out;
}

// —————————————————————————— 2. 业务建模图 ——————————————————————————

export function businessModel() {
  const WIDTH = 250;
  const LINE = 22;
  const HEAD = 34;

  const entities = [
    { id: "user", palette: "blue", x: 60, y: 150, title: "用户 User", fields: ["id      用户ID", "phone   手机号", "level   会员等级"] },
    { id: "order", palette: "green", x: 430, y: 60, title: "订单 Order", fields: ["id      订单ID", "userId  所属用户", "amount  金额", "status  状态"] },
    { id: "sku", palette: "orange", x: 800, y: 150, title: "商品 SKU", fields: ["id      SKU ID", "name    名称", "price   价格"] },
    { id: "payment", palette: "purple", x: 430, y: 420, title: "支付单 Payment", fields: ["id       支付单ID", "orderId  所属订单", "channel  支付渠道"] },
  ];

  const geometry = {};
  for (const entity of entities) {
    const height = HEAD + entity.fields.length * LINE + 16;
    geometry[entity.id] = { x: entity.x, y: entity.y, width: WIDTH, height };
    geometry[entity.id].midY = entity.y + height / 2;
    geometry[entity.id].midX = entity.x + WIDTH / 2;
  }

  const out = [title("title", 60, -20, "业务建模图（领域实体与关系，1:N / 1:1 标在连线上）")];

  for (const entity of entities) {
    const label = [entity.title, "————————", ...entity.fields].join("\n");
    out.push(
      rect(`entity-${entity.id}`, entity.x, entity.y, WIDTH, geometry[entity.id].height, label, entity.palette, {
        fontSize: 15,
      }),
    );
  }

  const relations = [
    {
      from: "user",
      to: "order",
      label: "1 : N 下单",
      fromPoint: () => [geometry.user.x + WIDTH, geometry.user.midY],
      toPoint: () => [geometry.order.x, geometry.order.midY],
    },
    {
      from: "order",
      to: "sku",
      label: "N : N 明细",
      fromPoint: () => [geometry.order.x + WIDTH, geometry.order.midY],
      toPoint: () => [geometry.sku.x, geometry.sku.midY],
    },
    {
      from: "order",
      to: "payment",
      label: "1 : 1 支付",
      fromPoint: () => [geometry.order.midX, geometry.order.y + geometry.order.height],
      toPoint: () => [geometry.payment.midX, geometry.payment.y],
    },
  ];

  relations.forEach((relation, index) => {
    out.push(
      arrow(
        `relation-${index}`,
        `entity-${relation.from}`,
        `entity-${relation.to}`,
        relation.fromPoint(),
        relation.toPoint(),
        relation.label,
      ),
    );
  });

  return out;
}

// —————————————————————————— 3. 流程图 ——————————————————————————

export function flowchart() {
  const CX = 460;
  const NODE_W = 240;
  const NODE_H = 64;
  const START_H = 56;
  const DIAMOND_W = 264;
  const DIAMOND_H = 120;

  const out = [title("title", CX - NODE_W / 2, -70, "流程图（菱形=判断，圆角矩形=处理）")];

  // 主干纵向坐标
  const startTop = 0;
  const checkTop = 128;
  const decisionTop = 300;
  const persistTop = 520;
  const notifyTop = 656;
  const endTop = 792;

  out.push(rect("start", CX - 120, startTop, 240, START_H, "开始：用户提交申请", "green", { type: "ellipse", roundness: null }));
  out.push(rect("check", CX - NODE_W / 2, checkTop, NODE_W, NODE_H, "校验必填项", "blue"));
  out.push(rect("decision", CX - DIAMOND_W / 2, decisionTop, DIAMOND_W, DIAMOND_H, "校验通过？", "orange", { type: "diamond", roundness: null }));
  out.push(rect("persist", CX - NODE_W / 2, persistTop, NODE_W, NODE_H, "写入业务数据", "purple"));
  out.push(rect("notify", CX - NODE_W / 2, notifyTop, NODE_W, NODE_H, "发送站内信 / 消息", "purple"));
  out.push(rect("end", CX - 110, endTop, 220, START_H, "结束", "green", { type: "ellipse", roundness: null }));

  // 否分支：菱形左顶点往左
  const rejectW = 240;
  const rejectX = CX - DIAMOND_W / 2 - 120 - rejectW;
  const rejectTop = decisionTop + DIAMOND_H / 2 - NODE_H / 2;
  out.push(rect("reject", rejectX, rejectTop, rejectW, NODE_H, "返回错误提示", "red"));

  // 主干连线
  out.push(arrow("a1", "start", "check", [CX, startTop + START_H], [CX, checkTop]));
  out.push(arrow("a2", "check", "decision", [CX, checkTop + NODE_H], [CX, decisionTop]));
  out.push(arrow("a3", "decision", "persist", [CX, decisionTop + DIAMOND_H], [CX, persistTop], "是"));
  out.push(arrow("a4", "persist", "notify", [CX, persistTop + NODE_H], [CX, notifyTop]));
  out.push(arrow("a5", "notify", "end", [CX, notifyTop + NODE_H], [CX, endTop]));

  // 否分支
  out.push(
    arrow(
      "a6",
      "decision",
      "reject",
      [CX - DIAMOND_W / 2, decisionTop + DIAMOND_H / 2],
      [rejectX + rejectW, rejectTop + NODE_H / 2],
      "否",
    ),
  );

  return out;
}

// —————————————————————————— 4. 时序图 ——————————————————————————

export function sequenceDiagram() {
  const participants = ["客户端", "API 网关", "订单服务", "MySQL"];
  const palettes = ["blue", "orange", "green", "gray"];

  const HEAD_W = 160;
  const HEAD_H = 56;
  const COL_GAP = 260;
  const LEFT = 90;
  const HEAD_Y = 0;
  const LINE_TOP = HEAD_Y + HEAD_H;
  const FIRST_MESSAGE = LINE_TOP + 76;
  const MESSAGE_GAP = 70;

  const messages = [
    { from: 0, to: 1, text: "提交订单 POST /orders" },
    { from: 1, to: 2, text: "创建订单" },
    { from: 2, to: 3, text: "INSERT order" },
    { from: 3, to: 2, text: "OK", dashed: true },
    { from: 2, to: 1, text: "orderId", dashed: true },
    { from: 1, to: 0, text: "201 Created", dashed: true },
  ];

  const lineBottom = FIRST_MESSAGE + (messages.length - 1) * MESSAGE_GAP + 60;
  const centers = participants.map((_, index) => LEFT + index * COL_GAP + HEAD_W / 2);
  const out = [title("title", LEFT, -70, "时序图（竖虚线=生命线，实线箭头=调用，虚线箭头=返回）")];

  participants.forEach((name, index) => {
    out.push(rect(`participant-${index}`, LEFT + index * COL_GAP, HEAD_Y, HEAD_W, HEAD_H, name, palettes[index]));
    out.push({
      type: "line",
      id: `lifeline-${index}`,
      x: centers[index],
      y: LINE_TOP,
      width: 0,
      height: lineBottom - LINE_TOP,
      points: [
        [0, 0],
        [0, lineBottom - LINE_TOP],
      ],
      strokeColor: "#868e96",
      strokeWidth: 1,
      strokeStyle: "dashed",
    });
  });

  messages.forEach((message, index) => {
    const y = FIRST_MESSAGE + index * MESSAGE_GAP;
    const fromX = centers[message.from];
    const toX = centers[message.to];
    const direction = toX > fromX ? 1 : -1;
    out.push(
      arrow(
        `message-${index}`,
        null,
        null,
        [fromX + direction * 8, y],
        [toX - direction * 8, y],
        message.text,
        message.dashed ? { strokeStyle: "dashed" } : {},
      ),
    );
  });

  return out;
}

export const DIAGRAM_TYPES = [
  { key: "techArchitecture", label: "技术架构图", hint: "分层：接入 / 网关 / 应用 / 中间件 / 数据" },
  { key: "businessModel", label: "业务建模图", hint: "领域实体 + 关系基数（1:N / 1:1）" },
  { key: "flowchart", label: "流程图", hint: "开始 → 校验 → 判断分支 → 结束" },
  { key: "sequenceDiagram", label: "时序图", hint: "参与者 + 生命线 + 调用与返回" },
];

export const GENERATORS = {
  techArchitecture,
  businessModel,
  flowchart,
  sequenceDiagram,
};
