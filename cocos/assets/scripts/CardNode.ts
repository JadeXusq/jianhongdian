import {
  Color,
  Graphics,
  Label,
  Node,
  UITransform,
  Vec3,
  Size,
  Layers,
  Sprite,
  SpriteFrame,
  Texture2D,
  ImageAsset,
  Rect,
} from "cc";
import { cardFromId, cardScore, isJoker, isRed, RED_JOKER_ID } from "./rules";
import { C, CARD_RATIO } from "./Theme";

const RANKS = [
  "A",
  "2",
  "3",
  "4",
  "5",
  "6",
  "7",
  "8",
  "9",
  "10",
  "J",
  "Q",
  "K",
];
const SUIT_SYM: Record<string, string> = { S: "♠", H: "♥", D: "♦", C: "♣" };

export interface CardStyle {
  faceUp?: boolean;
  dim?: boolean;
  highlight?: boolean;
  selected?: boolean;
}

interface AtlasMeta {
  cw: number;
  ch: number;
  cols: number;
  backIndex: number;
}

let atlasTex: Texture2D | null = null;
let atlasMeta: AtlasMeta | null = null;

export function cardAtlasReady(): boolean {
  return !!(atlasTex && atlasMeta);
}

/** 加载牌面位图图集（同域 card-atlas.png / .json） */
export async function loadCardAtlas(
  pngUrl = "card-atlas.png",
  jsonUrl = "card-atlas.json"
): Promise<boolean> {
  if (atlasTex && atlasMeta) return true;
  try {
    return await loadFromFetch(pngUrl, jsonUrl);
  } catch (e) {
    console.warn("[card] 图集加载失败，回退 Label 绘制", e);
    return false;
  }
}

async function loadFromFetch(pngUrl: string, jsonUrl: string): Promise<boolean> {
  const [buf, meta] = await Promise.all([
    fetch(pngUrl).then((r) => {
      if (!r.ok) throw new Error(pngUrl);
      return r.blob();
    }),
    fetch(jsonUrl).then((r) => {
      if (!r.ok) throw new Error(jsonUrl);
      return r.json() as Promise<AtlasMeta>;
    }),
  ]);
  const url = URL.createObjectURL(buf);
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const el = new Image();
    el.onload = () => resolve(el);
    el.onerror = () => reject(new Error("img"));
    el.src = url;
  });
  URL.revokeObjectURL(url);
  const ia = new ImageAsset(img);
  const tex = new Texture2D();
  tex.image = ia;
  atlasTex = tex;
  atlasMeta = meta;
  return true;
}

export function createCard(id: number, w: number, style: CardStyle = {}): Node {
  if (atlasTex && atlasMeta) return createCardAtlas(id, w, style);
  return createCardProcedural(id, w, style);
}

function createCardAtlas(id: number, w: number, style: CardStyle): Node {
  const h = w * CARD_RATIO;
  const node = new Node("Card");
  node.layer = Layers.Enum.UI_2D;
  const tr = node.addComponent(UITransform);
  tr.setContentSize(new Size(w, h));
  tr.setAnchorPoint(0, 1);

  const faceUp = style.faceUp !== false;
  const index = faceUp ? id : atlasMeta!.backIndex;
  const col = index % atlasMeta!.cols;
  const row = Math.floor(index / atlasMeta!.cols);
  const sf = new SpriteFrame();
  sf.texture = atlasTex!;
  sf.rect = new Rect(
    col * atlasMeta!.cw,
    row * atlasMeta!.ch,
    atlasMeta!.cw,
    atlasMeta!.ch
  );

  const spNode = new Node("Face");
  spNode.layer = Layers.Enum.UI_2D;
  node.addChild(spNode);
  spNode.setPosition(new Vec3(w / 2, -h / 2, 0));
  const spTr = spNode.addComponent(UITransform);
  spTr.setContentSize(new Size(w, h));
  spTr.setAnchorPoint(0.5, 0.5);
  const sp = spNode.addComponent(Sprite);
  sp.spriteFrame = sf;
  sp.sizeMode = Sprite.SizeMode.CUSTOM;

  const g = node.addComponent(Graphics);
  if (style.dim) {
    g.fillColor = C.dim;
    g.roundRect(0, -h, w, h, w * 0.09);
    g.fill();
  }
  strokeCard(g, w, h, style, faceUp);
  return node;
}

function createCardProcedural(
  id: number,
  w: number,
  style: CardStyle
): Node {
  const h = w * CARD_RATIO;
  const node = new Node("Card");
  node.layer = Layers.Enum.UI_2D;
  const tr = node.addComponent(UITransform);
  tr.setContentSize(new Size(w, h));
  tr.setAnchorPoint(0, 1);

  const g = node.addComponent(Graphics);
  const faceUp = style.faceUp !== false;
  const r = w * 0.09;

  g.fillColor = faceUp ? C.cardFace : C.cardBack;
  g.roundRect(0, -h, w, h, r);
  g.fill();

  if (faceUp) drawFace(node, g, id, w, h);
  else drawBack(node, g, w, h);

  if (style.dim) {
    g.fillColor = C.dim;
    g.roundRect(0, -h, w, h, r);
    g.fill();
  }
  strokeCard(g, w, h, style, faceUp);
  return node;
}

function strokeCard(
  g: Graphics,
  w: number,
  h: number,
  style: CardStyle,
  faceUp: boolean
): void {
  const r = w * 0.09;
  if (style.selected) {
    g.lineWidth = Math.max(2, w * 0.05);
    g.strokeColor = C.seal;
  } else if (style.highlight) {
    g.lineWidth = Math.max(2, w * 0.05);
    g.strokeColor = C.gold;
  } else {
    g.lineWidth = Math.max(1, w * 0.02);
    g.strokeColor = faceUp ? new Color(125, 103, 57, 128) : C.goldDim;
  }
  g.roundRect(0, -h, w, h, r);
  g.stroke();
}

function drawFace(
  node: Node,
  g: Graphics,
  id: number,
  w: number,
  h: number
): void {
  const color = isRed(id) ? C.seal : C.ink;

  if (isJoker(id)) {
    addLabel(node, "王", w * 0.5, -h * 0.44, w * 0.5, color, true);
    addLabel(
      node,
      id === RED_JOKER_ID ? "大" : "小",
      w * 0.5,
      -h * 0.72,
      w * 0.17,
      color
    );
  } else {
    const { suit, rank } = cardFromId(id);
    const sym = SUIT_SYM[suit as "S" | "H" | "D" | "C"];
    addLabel(node, RANKS[rank - 1], w * 0.19, -h * 0.14, w * 0.26, color, true);
    addLabel(node, sym, w * 0.19, -h * 0.27, w * 0.2, color);
    addLabel(node, sym, w * 0.56, -h * 0.6, w * 0.52, color);
  }

  const score = cardScore(id);
  if (score > 0) {
    const cx = w * 0.19;
    const cy = -h * 0.87;
    const rad = w * 0.14;
    g.fillColor = C.seal;
    g.circle(cx, cy, rad);
    g.fill();
    g.lineWidth = Math.max(1, w * 0.015);
    g.strokeColor = C.gold;
    g.circle(cx, cy, rad);
    g.stroke();
    addLabel(node, String(score), cx, cy, w * 0.17, C.cream, true);
  }
}

function drawBack(node: Node, g: Graphics, w: number, h: number): void {
  g.lineWidth = Math.max(0.5, w * 0.012);
  g.strokeColor = new Color(201, 169, 97, 90);
  const step = w * 0.2;
  for (let i = -h; i < w + h; i += step) {
    g.moveTo(i, 0);
    g.lineTo(i + h, -h);
    g.moveTo(i, -h);
    g.lineTo(i + h, 0);
  }
  g.stroke();

  const s = w * 0.42;
  g.fillColor = new Color(201, 169, 97, 230);
  g.roundRect((w - s) / 2, -(h + s) / 2, s, s, s * 0.12);
  g.fill();
  addLabel(node, "红", w / 2, -h / 2, s * 0.62, C.cardBack, true);
}

function addLabel(
  parent: Node,
  text: string,
  x: number,
  y: number,
  fontSize: number,
  color: Color,
  bold = false
): Node {
  const node = new Node("T");
  node.layer = Layers.Enum.UI_2D;
  parent.addChild(node);
  node.setPosition(new Vec3(x, y, 0));
  node.addComponent(UITransform).setAnchorPoint(0.5, 0.5);
  const label = node.addComponent(Label);
  label.string = text;
  label.fontSize = fontSize;
  label.lineHeight = fontSize * 1.1;
  label.color = color;
  label.isBold = bold;
  label.horizontalAlign = Label.HorizontalAlign.CENTER;
  label.verticalAlign = Label.VerticalAlign.CENTER;
  return node;
}

export { addLabel };
