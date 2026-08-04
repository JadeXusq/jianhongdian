import { describe, expect, it } from "vitest";
import { bestTarget, chooseHandPlay } from "../src/ai";
import { canPair, TOTAL_SCORE } from "../src/cards";
import { Game, RuleError } from "../src/game";

describe("发牌", () => {
  it.each([
    [2, 12],
    [3, 8],
    [4, 6],
  ])("%i 人局每人 %i 张、桌面 6 张、牌堆 24 张", (n, handSize) => {
    const g = new Game(n, 42);
    g.players.forEach((p) => expect(p.hand.length).toBe(handSize));
    expect(g.table.length).toBe(6);
    expect(g.stock.length).toBe(24);
  });

  it("初始桌面 6 张互不配对（多种子抽查）", () => {
    for (let seed = 0; seed < 200; seed++) {
      const { table } = new Game(4, seed);
      for (let i = 0; i < table.length; i++)
        for (let j = i + 1; j < table.length; j++)
          expect(canPair(table[i], table[j])).toBe(false);
    }
  });
});

describe("回合规则", () => {
  it("拒绝：非当前玩家出牌 / 出不在手中的牌", () => {
    const g = new Game(4, 42);
    const other = (g.currentPlayer + 1) % 4;
    expect(() => g.playHandCard(other, g.players[other].hand[0])).toThrow(
      RuleError
    );
    const notMine = g.players[other].hand[0];
    expect(() => g.playHandCard(g.currentPlayer, notMine)).toThrow(RuleError);
  });

  it("能配必吃：可吃时不允许弃牌到桌面，弃牌时不允许带目标", () => {
    for (let seed = 0; seed < 50; seed++) {
      const g = new Game(2, seed);
      const p = g.currentPlayer;
      const hand = g.players[p].hand;
      const capturable = hand.find((c) => g.table.some((t) => canPair(c, t)));
      const dead = hand.find((c) => !g.table.some((t) => canPair(c, t)));
      if (capturable !== undefined && dead !== undefined) {
        // 弃牌时指定目标应被拒绝
        expect(() => g.playHandCard(p, dead, g.table[0])).toThrow(RuleError);
        // 吃牌时指定不能配对的目标应被拒绝
        const bad = g.table.find((t) => !canPair(capturable, t));
        if (bad !== undefined)
          expect(() => g.playHandCard(p, capturable, bad)).toThrow(RuleError);
        return; // 找到一组即验证完成
      }
    }
    throw new Error("50 个种子中未找到测试局面");
  });
});

/** 用 AI 策略自动打完一整局 */
function playFullGame(playerCount: number, seed: number): Game {
  const g = new Game(playerCount, seed);
  let guard = 0;
  while (g.phase !== "FINISHED") {
    if (++guard > 500) throw new Error("对局未收敛");
    if (g.phase === "PLAY_HAND") {
      const p = g.currentPlayer;
      const move = chooseHandPlay(g.players[p].hand, g.table);
      g.playHandCard(p, move.cardId, move.targetId);
    } else {
      g.chooseStockTarget(g.currentPlayer, bestTarget(g.stockTargets()));
    }
  }
  return g;
}

describe("整局模拟（数学性质验证）", () => {
  it.each([2, 3, 4])(
    "%i 人局 × 300 种子：桌面清空、54张全被吃、总分240、零和",
    (n) => {
      for (let seed = 0; seed < 300; seed++) {
        const g = playFullGame(n, seed);
        expect(g.table.length).toBe(0);
        expect(g.stock.length).toBe(0);
        const all = g.players.flatMap((p) => p.captured);
        expect(all.length).toBe(54);
        expect(new Set(all).size).toBe(54);
        const r = g.result();
        expect(r.points.reduce((a, b) => a + b, 0)).toBe(TOTAL_SCORE);
        expect(r.base).toBe(TOTAL_SCORE / n);
        expect(r.net.reduce((a, b) => a + b, 0)).toBeCloseTo(0);
      }
    }
  );
});
