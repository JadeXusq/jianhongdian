/**
 * AI 策略（人机补位 / 超时托管共用）
 * 贪心：吃收益最大；无可吃弃分最低
 */
import { cardScore, findTargets } from "./cards";

export interface AiMove {
  cardId: number;
  targetId?: number;
}

export function bestTarget(targets: number[]): number {
  if (!targets.length) throw new Error("bestTarget: empty");
  return targets.reduce((best, t) =>
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
