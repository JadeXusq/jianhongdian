import { describe, expect, it } from "vitest";
import {
  bestTarget,
  chooseHandPlay,
  parseAiDifficulty,
} from "../src/ai";
import { cardScore } from "../src/cards";

const card = (suit: number, rank: number) => suit * 13 + rank - 1;

describe("AI 难度", () => {
  it("parseAiDifficulty 非法值回落 normal", () => {
    expect(parseAiDifficulty("hard")).toBe("hard");
    expect(parseAiDifficulty("nope")).toBe("normal");
    expect(parseAiDifficulty(undefined)).toBe("normal");
  });

  it("normal：可吃时选收益最大", () => {
    // 手牌 ♥5(可配桌面♠5) 与 ♥A(可配桌面♦9)
    const hand = [card(1, 5), card(1, 1)];
    const table = [card(0, 5), card(2, 9)];
    const move = chooseHandPlay(hand, table, "normal");
    expect(move.cardId).toBe(card(1, 1));
    expect(move.targetId).toBe(card(2, 9));
    expect(cardScore(move.cardId) + cardScore(move.targetId!)).toBe(30);
  });

  it("normal：无可吃弃最低分", () => {
    const hand = [card(1, 8), card(0, 3), card(1, 2)]; // 红8=8, 黑3=0, 红2=2
    const table = [card(2, 10)]; // ♦10，与手牌均不可配
    const move = chooseHandPlay(hand, table, "normal");
    expect(move.cardId).toBe(card(0, 3));
    expect(move.targetId).toBeUndefined();
  });

  it("hard：同分弃牌优先黑牌", () => {
    const hand = [card(0, 4), card(1, 4)]; // 黑4=0, 红4=4 — 最低是黑
    const table = [card(2, 10)];
    expect(chooseHandPlay(hand, table, "hard").cardId).toBe(card(0, 4));
  });

  it("hard：可吃同分时优先吃桌面高分", () => {
    // ♠5 可吃 ♥5(0分桌面? 红5=5) 或… 用两张同收益：
    // ♥3+♦7=10 收益 3+7=10；♠A+♥9 收益 0+10=10 — 等等黑A=0
    // 用：♦5 吃 ♥5（5+5=10）与 ♣5 吃 ♥5 同一目标
    // 改为：手牌有两张都能吃不同目标但总分相同
    // ♥2+♠8 → 2+0=2；♦3+♣7 → 3+0=3 — 不同
    // 红5+黑5=5+0=5；红A+黑9=20+0=20
    // 构造：table [♥9=10, ♦9=10]，hand [♠A=0, ♣A=0] 都能吃任一九，收益都是 20
    const hand = [card(0, 1), card(3, 1)];
    const table = [card(1, 9), card(2, 9)];
    const move = chooseHandPlay(hand, table, "hard", () => 0);
    expect(move.targetId).toBeDefined();
    expect(cardScore(move.targetId!)).toBe(10);
  });

  it("easy：可吃时结果落在合法集合内", () => {
    const hand = [card(1, 5), card(1, 1), card(0, 2)];
    const table = [card(0, 5), card(2, 9)];
    const keys = new Set<string>();
    for (let i = 0; i < 40; i++) {
      const m = chooseHandPlay(hand, table, "easy", () => i / 40);
      if (m.targetId !== undefined) keys.add(`${m.cardId}:${m.targetId}`);
    }
    expect(keys.has(`${card(1, 5)}:${card(0, 5)}`)).toBe(true);
    expect(keys.has(`${card(1, 1)}:${card(2, 9)}`)).toBe(true);
  });

  it("bestTarget easy 可返回任一目标", () => {
    const targets = [card(1, 9), card(2, 5), card(0, 3)];
    const seen = new Set<number>();
    for (let i = 0; i < 30; i++) {
      seen.add(bestTarget(targets, "easy", () => i / 30));
    }
    expect(seen.size).toBeGreaterThan(1);
  });
});
