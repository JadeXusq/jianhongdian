import { describe, expect, it } from "vitest";
import { bestTarget, chooseHandPlay } from "../src/ai";
import { cardScore } from "../src/cards";

const card = (suit: number, rank: number) => suit * 13 + rank - 1;

describe("AI 策略", () => {
  it("可吃时选收益最大", () => {
    const hand = [card(1, 5), card(1, 1)];
    const table = [card(0, 5), card(2, 9)];
    const move = chooseHandPlay(hand, table);
    expect(move.cardId).toBe(card(1, 1));
    expect(move.targetId).toBe(card(2, 9));
    expect(cardScore(move.cardId) + cardScore(move.targetId!)).toBe(30);
  });

  it("无可吃弃最低分", () => {
    const hand = [card(1, 8), card(0, 3), card(1, 2)];
    const table = [card(2, 10)];
    const move = chooseHandPlay(hand, table);
    expect(move.cardId).toBe(card(0, 3));
    expect(move.targetId).toBeUndefined();
  });

  it("bestTarget 选最高分", () => {
    const targets = [card(1, 9), card(2, 5), card(0, 3)];
    expect(bestTarget(targets)).toBe(card(1, 9));
  });
});
