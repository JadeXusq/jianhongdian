// ⚠️ 自动生成，请勿直接修改：源文件在 shared/src/，改完执行 node tools/syncCocosLib.mjs
/**
 * 节奏参数唯一源头。server 直接引用；client 经 workspace 引用；
 * cocos 经 tools/syncCocosLib.mjs 同步到 rules/timing.ts。
 *
 * 单位约定：带 `_MS` 为毫秒，带 `_S` 为秒（动画 hold 用）。
 */
import { TOTAL_HAND_CARDS } from "./cards";

/** 人类回合超时（超时后 AI 代打） */
export const TURN_MS = 180_000;
/** AI / 托管出牌「思考」间隔（动画垫时另加，见 captureAnimMs） */
export const AI_DELAY_MS = 900;
/** 断线保留座位 */
export const RECONNECT_MS = 60_000;
/** 吃牌 MATCH 居中展示 */
export const MATCH_HOLD_MS = 1_000;
/** 出牌飞向目标后停顿 */
export const FLY_TARGET_HOLD_MS = 150;
/** 命中目标后的短反馈（再进 MATCH） */
export const HIT_HOLD_MS = 120;
/** 飞入得分堆后停顿 */
export const FLY_PILE_HOLD_MS = 250;
/** 弃牌落桌后停顿 */
export const DISCARD_HOLD_MS = 380;
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
  220 +
  MATCH_HOLD_MS +
  280 +
  FLY_PILE_HOLD_MS +
  1_200;
/** 轮末结算前留给 events 消息到达的宽限（防 state 先于 events） */
export const ROUND_END_EVENT_GRACE_MS = 280;

/** 开局洗牌展示 */
export const DEAL_SHUFFLE_MS = 700;
/** 单张发牌飞行 */
export const DEAL_FLY_MS = 220;
/** 每轮发牌间隔 */
export const DEAL_ROUND_PAUSE_MS = 70;
/** 桌面开牌后停顿 */
export const DEAL_TABLE_PAUSE_MS = 120;

export const DEAL_SHUFFLE_S = DEAL_SHUFFLE_MS / 1000;
export const DEAL_FLY_S = DEAL_FLY_MS / 1000;
export const DEAL_ROUND_PAUSE_S = DEAL_ROUND_PAUSE_MS / 1000;
export const DEAL_TABLE_PAUSE_S = DEAL_TABLE_PAUSE_MS / 1000;

/** 开局发牌动画墙钟估算（各座位并行飞牌，按轮数计；含短缓冲） */
export function dealAnimMs(playerCount: number): number {
  const n = Math.max(2, Math.min(4, playerCount));
  const handSize = TOTAL_HAND_CARDS / n;
  return (
    DEAL_SHUFFLE_MS +
    handSize * (DEAL_FLY_MS + DEAL_ROUND_PAUSE_MS) +
    DEAL_FLY_MS +
    DEAL_TABLE_PAUSE_MS +
    200
  );
}

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
    220 +
    MATCH_HOLD_MS +
    280 +
    FLY_PILE_HOLD_MS
  );
}

/** 客户端弃牌动画总时长估算 */
export function discardAnimMs(): number {
  return 240 + DISCARD_HOLD_MS;
}
