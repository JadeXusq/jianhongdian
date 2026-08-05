/**
 * Colyseus 房间状态（客户端可见的公共信息）
 * 手牌属于私密信息，不放入 state，单独通过 client.send('hand') 下发。
 */
import { ArraySchema, MapSchema, Schema, type } from "@colyseus/schema";

export type RoomPhase = "WAITING" | "PLAYING" | "ROUND_OVER";
export type TurnPhase = "PLAY_HAND" | "CHOOSE_STOCK_TARGET";

export class PlayerSchema extends Schema {
  @type("string") sessionId = "";
  @type("string") name = "";
  @type("string") avatar = "";
  @type("number") seat = 0;
  @type("boolean") isAi = false;
  @type("boolean") connected = true;
  @type("boolean") ready = false;
  /** 本局已吃到的分数 */
  @type("number") points = 0;
  /** 剩余手牌数（公开） */
  @type("number") handCount = 0;
  /** 已吃到的牌（公开，用于展示得分堆） */
  @type(["number"]) captured = new ArraySchema<number>();
  /** 跨局累计净分 */
  @type("number") totalNet = 0;
}

export class RoomState extends Schema {
  @type("string") phase: RoomPhase = "WAITING";
  @type("string") code = "";
  /** 房主的 sessionId（放入状态同步，避免客户端依赖消息到达顺序）*/
  @type("string") hostSessionId = "";
  @type("number") maxPlayers = 4;
  /** 总轮数：0 表示无限轮，由房主结算结束 */
  @type("number") totalRounds = 0;
  @type("number") round = 0;
  /** 本轮起手座位（庄），-1 表示未开局 */
  @type("number") roundStarter = -1;
  /** 桌面明牌 */
  @type(["number"]) table = new ArraySchema<number>();
  @type("number") stockCount = 0;
  @type("number") currentSeat = -1;
  @type("string") turnPhase: TurnPhase = "PLAY_HAND";
  /** CHOOSE_STOCK_TARGET 阶段翻出的待选牌，-1 表示无 */
  @type("number") pendingStockCard = -1;
  /** 当前回合截止时间戳（毫秒），客户端据此画倒计时环 */
  @type("number") turnDeadline = 0;
  @type({ map: PlayerSchema }) players = new MapSchema<PlayerSchema>();
}
