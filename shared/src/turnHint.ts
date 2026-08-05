/**
 * 对局回合提示文案（Web / Cocos 共用）
 *
 * 优先级：观战 → 动画/短锁忙线 → 对方回合 → 己方选目标/出牌
 */
export function turnHint(opts: {
  spectating?: boolean;
  offline?: boolean;
  myTurn: boolean;
  /** PLAY_HAND | CHOOSE_STOCK_TARGET */
  turnPhase: string;
  /** 吃牌/翻牌动画中，或刚切回合的短锁 */
  busy: boolean;
  /** 已选手牌、等待点桌面目标 */
  pickingTable?: boolean;
  /** 无目标弃牌二次确认 */
  discardConfirm?: boolean;
}): string {
  if (opts.spectating) return "观战中";

  const other = opts.offline ? "电脑出牌中…" : "对手出牌中…";
  const choosing = opts.turnPhase === "CHOOSE_STOCK_TARGET";

  if (opts.busy) {
    if (choosing) return opts.myTurn ? "翻牌中…" : "对方翻牌中…";
    // 状态可能已切到自己，但仍在播上家/本家结算动画
    if (opts.myTurn) return "出牌结算中…";
    return other;
  }

  if (!opts.myTurn) return other;

  if (choosing) return "翻牌可吃，请选择目标";
  if (opts.discardConfirm) return "无可吃目标 — 再点一次弃牌";
  if (opts.pickingTable) return "选择要吃的桌面牌";
  return "轮到你出牌";
}
