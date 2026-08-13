// ⚠️ 自动生成，请勿直接修改：源文件在 shared/src/，改完执行 node tools/syncCocosLib.mjs
/**
 * AI 策略（人机补位 / 超时托管共用）
 * 贪心：吃收益最大；无可吃弃分最低
 */
import { autoTarget, cardScore, findTargets, isRed } from "./cards";

export interface AiMove {
  cardId: number;
  targetId?: number;
}

export function bestTarget(targets: number[]): number {
  if (!targets.length) throw new Error("bestTarget: empty");
  const auto = autoTarget(targets);
  if (auto !== undefined) return auto;
  const reds = targets.filter(isRed);
  const pool = reds.length ? reds : targets;
  return pool.reduce((best, t) =>
    cardScore(t) > cardScore(best) ? t : best
  );
}

export function chooseHandPlay(hand: number[], table: number[]): AiMove {
  if (!hand.length) throw new Error("chooseHandPlay: empty hand");

  const captures: AiMove[] = [];
  for (const cardId of hand) {
    const targets = findTargets(cardId, table);
    if (!targets.length) continue;
    captures.push({ cardId, targetId: bestTarget(targets) });
  }

  if (captures.length) {
    let best = captures[0]!;
    let bestGain = -1;
    for (const m of captures) {
      const gain = cardScore(m.cardId) + cardScore(m.targetId!);
      if (gain > bestGain) {
        bestGain = gain;
        best = m;
      }
    }
    return best;
  }

  return { cardId: chooseDiscard(hand) };
}

function chooseDiscard(hand: number[]): number {
  let best = hand[0]!;
  for (const id of hand) {
    if (cardScore(id) < cardScore(best)) best = id;
  }
  return best;
}
