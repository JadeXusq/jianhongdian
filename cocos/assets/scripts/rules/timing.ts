// ⚠️ 自动生成，请勿直接修改：源文件在 shared/src/，改完执行 node tools/syncCocosLib.mjs
/**
 * 节奏参数唯一源头。server 直接引用；client 经 workspace 引用；
 * cocos 经 tools/syncCocosLib.mjs 同步到 rules/timing.ts。
 *
 * 单位约定：带 `_MS` 为毫秒，带 `_S` 为秒（动画 hold 用）。
 */
/** 人类回合超时（超时后 AI 代打） */
export const TURN_MS = 60_000;
/** 服务器 AI / 托管出牌间隔（需 > MATCH 展示 + 飞行动画） */
export const AI_DELAY_MS = 9_000;
/** 断线保留座位 */
export const RECONNECT_MS = 60_000;
/** 吃牌 MATCH 居中展示 */
export const MATCH_HOLD_MS = 5_000;
/** 出牌飞向目标后停顿 */
export const FLY_TARGET_HOLD_MS = 300;
/** 飞入得分堆后停顿 */
export const FLY_PILE_HOLD_MS = 1_000;
/** 弃牌落桌后停顿 */
export const DISCARD_HOLD_MS = 800;
/** 轮间结算弹窗自动关闭（未打满时） */
export const ROUND_RESULT_AUTO_MS = 3_000;

export const MATCH_HOLD_S = MATCH_HOLD_MS / 1000;
export const FLY_TARGET_HOLD_S = FLY_TARGET_HOLD_MS / 1000;
export const FLY_PILE_HOLD_S = FLY_PILE_HOLD_MS / 1000;
export const DISCARD_HOLD_S = DISCARD_HOLD_MS / 1000;
