/**
 * 节奏参数唯一源头。server 直接引用；client 经 workspace 引用；
 * cocos 经 tools/syncCocosLib.mjs 同步到 rules/timing.ts。
 *
 * 单位约定：带 `_MS` 为毫秒，带 `_S` 为秒（动画 hold 用）。
 */
/** 人类回合超时（超时后 AI 代打） */
export const TURN_MS = 180_000;
/** AI / 托管出牌「思考」间隔（动画垫时另加，见 captureAnimMs） */
export const AI_DELAY_MS = 2_000;
/** 断线保留座位 */
export const RECONNECT_MS = 60_000;
/** 吃牌 MATCH 居中展示 */
export const MATCH_HOLD_MS = 2_200;
/** 出牌飞向目标后停顿 */
export const FLY_TARGET_HOLD_MS = 300;
/** 命中目标后的短反馈（再进 MATCH） */
export const HIT_HOLD_MS = 280;
/** 飞入得分堆后停顿 */
export const FLY_PILE_HOLD_MS = 600;
/** 弃牌落桌后停顿 */
export const DISCARD_HOLD_MS = 800;
/** 昵称最长字数 */
export const NAME_MAX_LEN = 10;
/** 轮间结算弹窗自动关闭（未打满时） */
export const ROUND_RESULT_AUTO_MS = 5_000;
/** 刚切到自己回合时的提示短锁（墙钟，不依赖 RAF 帧计数） */
export const TURN_UI_LOCK_MS = 150;
/** 等动画结束后再弹结算的最长等待（须盖住完整吃牌动画，防提前结算） */
export const ROUND_RESULT_MAX_WAIT_MS =
  320 +
  FLY_TARGET_HOLD_MS +
  HIT_HOLD_MS +
  350 +
  MATCH_HOLD_MS +
  420 +
  FLY_PILE_HOLD_MS +
  1_500;

export const MATCH_HOLD_S = MATCH_HOLD_MS / 1000;
export const FLY_TARGET_HOLD_S = FLY_TARGET_HOLD_MS / 1000;
export const HIT_HOLD_S = HIT_HOLD_MS / 1000;
export const FLY_PILE_HOLD_S = FLY_PILE_HOLD_MS / 1000;
export const DISCARD_HOLD_S = DISCARD_HOLD_MS / 1000;

/** 客户端吃牌动画总时长估算（飞向目标 + 命中 + MATCH + 飞入堆） */
export function captureAnimMs(): number {
  return (
    320 +
    FLY_TARGET_HOLD_MS +
    HIT_HOLD_MS +
    350 +
    MATCH_HOLD_MS +
    420 +
    FLY_PILE_HOLD_MS
  );
}

/** 客户端弃牌动画总时长估算 */
export function discardAnimMs(): number {
  return 340 + DISCARD_HOLD_MS;
}
