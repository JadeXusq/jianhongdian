import { describe, expect, it } from "vitest";
import {
  BLACK_JOKER_ID,
  canPair,
  cardName,
  cardScore,
  createDeck,
  RED_JOKER_ID,
  TOTAL_SCORE,
  totalScore,
} from "../src/cards";

// 牌 id 速查：花色*13 + (rank-1)；0=♠ 1=♥ 2=♦ 3=♣
const card = (suit: number, rank: number) => suit * 13 + rank - 1;

describe("牌与计分", () => {
  it("整副牌 54 张，总分恰为 240", () => {
    const deck = createDeck();
    expect(deck.length).toBe(54);
    expect(totalScore(deck)).toBe(TOTAL_SCORE);
  });

  it("计分：红鬼30 / 红A20 / 红9~K各10 / 红2~8按面值 / 黑牌与小王0", () => {
    expect(cardScore(RED_JOKER_ID)).toBe(30);
    expect(cardScore(BLACK_JOKER_ID)).toBe(0);
    expect(cardScore(card(1, 1))).toBe(20); // ♥A
    expect(cardScore(card(2, 1))).toBe(20); // ♦A
    expect(cardScore(card(1, 9))).toBe(10); // ♥9
    expect(cardScore(card(2, 13))).toBe(10); // ♦K
    expect(cardScore(card(1, 5))).toBe(5); // ♥5
    expect(cardScore(card(2, 8))).toBe(8); // ♦8
    expect(cardScore(card(0, 1))).toBe(0); // ♠A
    expect(cardScore(card(3, 13))).toBe(0); // ♣K
  });

  it("配对：A~9 相加为 10", () => {
    expect(canPair(card(0, 1), card(1, 9))).toBe(true); // ♠A + ♥9
    expect(canPair(card(1, 3), card(2, 7))).toBe(true); // ♥3 + ♦7
    expect(canPair(card(0, 5), card(1, 5))).toBe(true); // ♠5 + ♥5
    expect(canPair(card(0, 2), card(1, 7))).toBe(false); // 2+7=9
    expect(canPair(card(0, 1), card(1, 1))).toBe(false); // A+A=2
  });

  it("配对：10/J/Q/K 仅同点数", () => {
    expect(canPair(card(0, 10), card(1, 10))).toBe(true);
    expect(canPair(card(0, 13), card(3, 13))).toBe(true);
    expect(canPair(card(0, 10), card(1, 11))).toBe(false);
    expect(canPair(card(0, 1), card(1, 10))).toBe(false); // A 不配 10
  });

  it("配对：大小王互配，不配其他牌", () => {
    expect(canPair(RED_JOKER_ID, BLACK_JOKER_ID)).toBe(true);
    expect(canPair(RED_JOKER_ID, card(1, 9))).toBe(false);
    expect(canPair(BLACK_JOKER_ID, card(0, 10))).toBe(false);
  });

  it("cardName 调试输出", () => {
    expect(cardName(card(1, 1))).toBe("♥A");
    expect(cardName(RED_JOKER_ID)).toBe("大王");
  });
});
