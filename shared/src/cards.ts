/**
 * 牌定义与基础规则：54 张牌（含大小王）、配对判定、计分
 *
 * 牌 id 编码：0..51 = 花色*13 + (rank-1)，52 = 黑鬼（小王），53 = 红鬼（大王）
 * 花色顺序：0=♠ 1=♥ 2=♦ 3=♣
 */

export const SUITS = ["S", "H", "D", "C"] as const;
export type Suit = (typeof SUITS)[number] | "JOKER";

export const BLACK_JOKER_ID = 52;
export const RED_JOKER_ID = 53;
export const DECK_SIZE = 54;

/** 全场总分（用于底分与校验） */
export const TOTAL_SCORE = 240;
/** 固定发出的手牌总数 */
export const TOTAL_HAND_CARDS = 24;
/** 初始桌面明牌数 */
export const INITIAL_TABLE_CARDS = 6;

export interface Card {
  id: number;
  suit: Suit;
  /** 1=A ... 13=K；王为 0 */
  rank: number;
}

export function cardFromId(id: number): Card {
  if (id === BLACK_JOKER_ID) return { id, suit: "JOKER", rank: 0 };
  if (id === RED_JOKER_ID) return { id, suit: "JOKER", rank: 0 };
  const suit = SUITS[Math.floor(id / 13)];
  const rank = (id % 13) + 1;
  return { id, suit, rank };
}

export function isJoker(id: number): boolean {
  return id === BLACK_JOKER_ID || id === RED_JOKER_ID;
}

export function isRed(id: number): boolean {
  if (id === RED_JOKER_ID) return true;
  if (id === BLACK_JOKER_ID) return false;
  const suit = SUITS[Math.floor(id / 13)];
  return suit === "H" || suit === "D";
}

/**
 * 配对判定：
 * - 大小王互相配对
 * - A~9 两牌点数相加为 10
 * - 10/J/Q/K 同点数配对
 */
export function canPair(a: number, b: number): boolean {
  if (a === b) return false;
  const ja = isJoker(a);
  const jb = isJoker(b);
  if (ja || jb) return ja && jb;
  const ra = (a % 13) + 1;
  const rb = (b % 13) + 1;
  if (ra <= 9 && rb <= 9) return ra + rb === 10;
  if (ra >= 10 && rb >= 10) return ra === rb;
  return false;
}

/**
 * 计分：红鬼 30；红A 20；红 9~K 各 10；红 2~8 按面值；其余（含黑鬼、黑牌）0
 */
export function cardScore(id: number): number {
  if (id === RED_JOKER_ID) return 30;
  if (!isRed(id)) return 0;
  const rank = (id % 13) + 1;
  if (rank === 1) return 20;
  if (rank >= 9) return 10;
  return rank;
}

export function totalScore(ids: number[]): number {
  return ids.reduce((s, id) => s + cardScore(id), 0);
}

/** 从桌面找出所有可与 card 配对的牌 */
export function findTargets(card: number, table: number[]): number[] {
  return table.filter((t) => canPair(card, t));
}

export function createDeck(): number[] {
  return Array.from({ length: DECK_SIZE }, (_, i) => i);
}

/** 牌面文字（调试/日志用），如 ♥A、♠10、大王 */
export function cardName(id: number): string {
  if (id === RED_JOKER_ID) return "大王";
  if (id === BLACK_JOKER_ID) return "小王";
  const c = cardFromId(id);
  const suitSym = { S: "♠", H: "♥", D: "♦", C: "♣" }[
    c.suit as "S" | "H" | "D" | "C"
  ];
  const rankSym = [
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
  ][c.rank - 1];
  return suitSym + rankSym;
}
