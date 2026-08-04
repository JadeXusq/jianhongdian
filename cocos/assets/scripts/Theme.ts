/** 新中式配色（与网页版保持一致） */
import { Color } from "cc";

export const C = {
  feltInner: new Color(28, 76, 59),
  feltOuter: new Color(13, 42, 32),
  gold: new Color(201, 169, 97),
  goldDim: new Color(125, 103, 57),
  seal: new Color(184, 53, 43),
  cream: new Color(243, 234, 214),
  ink: new Color(38, 38, 42),
  cardFace: new Color(247, 241, 226),
  cardBack: new Color(109, 36, 32),
  panelBg: new Color(8, 26, 20, 184),
  dim: new Color(6, 20, 15, 140),
};

/** 逻辑尺寸：与设计分辨率一致，牌桌坐标沿用网页版的 720 高度体系 */
export const DESIGN = { width: 1280, height: 720 };
export const CARD_RATIO = 1.4;
export const HAND_W = 96;
export const TABLE_CARD_W = 74;
