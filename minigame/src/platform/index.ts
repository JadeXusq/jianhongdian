/**
 * 小游戏平台层：微信 wx 与抖音 tt 的 API 基本同名同参，统一收口到 api。
 * 业务代码只从这里取平台能力，不直接碰 wx / tt。
 */

export interface SocketTask {
  send(opts: { data: string | ArrayBuffer }): void;
  close(opts: { code?: number; reason?: string }): void;
  onOpen(cb: () => void): void;
  onMessage(cb: (res: { data: string | ArrayBuffer }) => void): void;
  onClose(cb: (res: { code: number; reason: string }) => void): void;
  onError(cb: (res: { errMsg: string }) => void): void;
}

export interface RequestResult {
  statusCode: number;
  data: unknown;
  header: Record<string, string>;
}

export interface MiniCanvas {
  width: number;
  height: number;
  getContext(type: "2d"): CanvasRenderingContext2D;
  toTempFilePathSync?(opts: Record<string, number>): string;
}

export interface SysInfo {
  windowWidth: number;
  windowHeight: number;
  pixelRatio: number;
  platform: string;
  safeArea?: { left: number; right: number; top: number; bottom: number };
}

export interface MiniApi {
  connectSocket(opts: { url: string; protocols?: string[] }): SocketTask;
  request(opts: {
    url: string;
    method?: string;
    header?: Record<string, string>;
    data?: unknown;
    dataType?: string;
    responseType?: string;
    timeout?: number;
    success(res: RequestResult): void;
    fail(err: { errMsg: string }): void;
  }): void;
  getStorageSync(key: string): unknown;
  setStorageSync(key: string, value: string): void;
  removeStorageSync(key: string): void;
  getSystemInfoSync(): SysInfo;
  createCanvas(): MiniCanvas;
  createImage(): HTMLImageElement;
  onTouchStart(cb: (res: MiniTouchEvent) => void): void;
  onTouchMove(cb: (res: MiniTouchEvent) => void): void;
  onTouchEnd(cb: (res: MiniTouchEvent) => void): void;
  onTouchCancel(cb: (res: MiniTouchEvent) => void): void;
  onHide(cb: () => void): void;
  createWebAudioContext?(): AudioContext;
  showKeyboard?(opts: {
    defaultValue: string;
    maxLength: number;
    multiple: boolean;
    confirmHold: boolean;
    confirmType: string;
  }): void;
  hideKeyboard?(opts?: Record<string, unknown>): void;
  onKeyboardConfirm?(cb: (res: { value: string }) => void): void;
  offKeyboardConfirm?(cb: (res: { value: string }) => void): void;
  onShow?(cb: (res: { query?: Record<string, string> }) => void): void;
  getLaunchOptionsSync?(): { query?: Record<string, string> };
  shareAppMessage?(opts: ShareOpts): void;
  onShareAppMessage?(cb: () => ShareOpts): void;
  showShareMenu?(opts: Record<string, unknown>): void;
  exitMiniProgram?(opts: Record<string, unknown>): void;
  onError?(cb: (res: { message: string }) => void): void;
}

export interface ShareOpts {
  title: string;
  query?: string;
  /** 分享卡片图（本地临时路径）；缺省时平台截当前画面 */
  imageUrl?: string;
}

export interface MiniTouch {
  identifier: number;
  clientX: number;
  clientY: number;
}

export interface MiniTouchEvent {
  touches: MiniTouch[];
  changedTouches: MiniTouch[];
}

declare const wx: MiniApi | undefined;
declare const tt: MiniApi | undefined;

export const platformName: "douyin" | "wechat" =
  typeof tt !== "undefined" ? "douyin" : "wechat";

export const api: MiniApi = (typeof tt !== "undefined" ? tt : wx) as MiniApi;

export const storage = {
  get(key: string): string | null {
    const v = api.getStorageSync(key);
    return typeof v === "string" && v !== "" ? v : null;
  },
  set(key: string, value: string): void {
    api.setStorageSync(key, value);
  },
  remove(key: string): void {
    api.removeStorageSync(key);
  },
};

/** 右上角菜单转发：内容由调用方按当前场景给出（房间邀请 / 战绩 / 默认） */
export function setupShare(current: () => ShareOpts): void {
  api.showShareMenu?.({ withShareTicket: false, menus: ["shareAppMessage"] });
  api.onShareAppMessage?.(current);
}

/** 退出小游戏；平台不支持时返回 false */
export function exitGame(): boolean {
  if (!api.exitMiniProgram) return false;
  api.exitMiniProgram({});
  return true;
}

/** 主动分享（按钮触发） */
export function share(opts: ShareOpts): void {
  api.shareAppMessage?.(opts);
}

/** 启动或切回前台时携带的邀请房号 */
export function onInviteCode(cb: (code: string) => void): void {
  const pick = (q?: Record<string, string>) => {
    const code = String(q?.room ?? "").replace(/\D/g, "");
    if (code.length === 6) cb(code);
  };
  pick(api.getLaunchOptionsSync?.().query);
  api.onShow?.((res) => pick(res.query));
}

/** 原生键盘输入一行文字；平台不支持时返回 null */
export function promptText(defaultValue: string, maxLength: number): Promise<string | null> {
  if (!api.showKeyboard || !api.onKeyboardConfirm) return Promise.resolve(null);
  return new Promise((resolve) => {
    const done = (res: { value: string }) => {
      api.offKeyboardConfirm?.(done);
      api.hideKeyboard?.();
      resolve(res.value);
    };
    api.onKeyboardConfirm!(done);
    api.showKeyboard!({
      defaultValue,
      maxLength,
      multiple: false,
      confirmHold: false,
      confirmType: "done",
    });
  });
}

export function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = api.createImage();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(src));
    img.src = src;
  });
}

export function http(
  url: string,
  opts: { method?: string; body?: unknown; timeout?: number } = {}
): Promise<{ ok: boolean; status: number; data: any }> {
  return new Promise((resolve, reject) => {
    api.request({
      url,
      method: opts.method ?? "GET",
      header: opts.body ? { "content-type": "application/json" } : undefined,
      data: opts.body,
      timeout: opts.timeout,
      success: (res) =>
        resolve({
          ok: res.statusCode >= 200 && res.statusCode < 300,
          status: res.statusCode,
          data: res.data,
        }),
      fail: (err) => reject(new Error(err.errMsg)),
    });
  });
}

export async function httpJson<T>(url: string): Promise<T> {
  const res = await http(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.data as T;
}
