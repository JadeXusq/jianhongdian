/**
 * AI 策略（人机补位 / 超时托管共用）
 * - easy：可吃则随机选一手；否则随机弃牌
 * - normal：贪心——吃收益最大；无可吃弃分最低
 * - hard：贪心 + 弃牌时尽量不送红牌上桌
 */
import { cardScore, findTargets, isRed } from "./cards";

export type AiDifficulty = "easy" | "normal" | "hard";

export interface AiMove {
  cardId: number;
  targetId?: number;
}

export function bestTarget(
  targets: number[],
  difficulty: AiDifficulty = "normal",
  rand: () => number = Math.random
): number {
  if (!targets.length) throw new Error("bestTarget: empty");
  if (difficulty === "easy") {
    return targets[Math.floor(rand() * targets.length)]!;
  }
  return targets.reduce((best, t) =>
    cardScore(t) > cardScore(best) ? t : best
  );
}

export function chooseHandPlay(
  hand: number[],
  table: number[],
  difficulty: AiDifficulty = "normal",
  rand: () => number = Math.random
): AiMove {
  if (!hand.length) throw new Error("chooseHandPlay: empty hand");

  const captures: AiMove[] = [];
  for (const cardId of hand) {
    const targets = findTargets(cardId, table);
    if (!targets.length) continue;
    const targetId = bestTarget(targets, difficulty, rand);
    captures.push({ cardId, targetId });
  }

  if (difficulty === "easy") {
    if (captures.length) {
      return captures[Math.floor(rand() * captures.length)]!;
    }
    return { cardId: hand[Math.floor(rand() * hand.length)]! };
  }

  if (captures.length) {
    let best = captures[0]!;
    let bestGain = -1;
    for (const m of captures) {
      const gain = cardScore(m.cardId) + cardScore(m.targetId!);
      if (gain > bestGain) {
        bestGain = gain;
        best = m;
      } else if (difficulty === "hard" && gain === bestGain) {
        // 同分时优先吃掉桌面高分红牌，不留给下家
        if (cardScore(m.targetId!) > cardScore(best.targetId!)) best = m;
      }
    }
    return best;
  }

  return { cardId: chooseDiscard(hand, difficulty, rand) };
}

/** 无可吃时的弃牌：normal 弃最低分；hard 同最低分时优先弃黑牌 */
function chooseDiscard(
  hand: number[],
  difficulty: AiDifficulty,
  rand: () => number
): number {
  if (difficulty === "easy") {
    return hand[Math.floor(rand() * hand.length)]!;
  }
  let best = hand[0]!;
  for (const id of hand) {
    const s = cardScore(id);
    const bs = cardScore(best);
    if (s < bs) best = id;
    else if (difficulty === "hard" && s === bs) {
      const red = isRed(id);
      const bestRed = isRed(best);
      if (bestRed && !red) best = id;
      else if (red === bestRed && rand() < 0.5) best = id;
    }
  }
  return best;
}

export function parseAiDifficulty(v: unknown): AiDifficulty {
  if (v === "easy" || v === "normal" || v === "hard") return v;
  return "normal";
}
