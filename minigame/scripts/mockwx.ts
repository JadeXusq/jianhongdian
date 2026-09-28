/**
 * 测试用 wx 模拟：画布 / 图片 / 存储 / 触摸 / 网络（Node 原生 WebSocket + fetch）。
 * virtual=true 时接管 Date.now / setTimeout / setInterval，按虚拟时间尽快推进；
 * 此时不走真实网络（Node fetch 依赖真实定时器），请求一律失败。
 */
import { readFileSync } from "fs";
import { join } from "path";
import vm from "vm";

const GAME_JS = join(import.meta.dirname, "../dist/wechat/game.js");
const g = globalThis as any;
const NativeWebSocket = g.WebSocket;
const realImmediate = setImmediate;
const realTimeout = setTimeout;

export interface MockNickButton {
  style: Record<string, number | string>;
  visible: boolean;
  tap(nickName: string): void;
  /** 模拟授权失败（如隐私协议未同意） */
  tapFail(errMsg: string): void;
}

export interface Harness {
  hook: () => any;
  /** 主动分享记录 */
  shares: { title: string; query?: string; imageUrl?: string }[];
  /** 右上角菜单转发当前会给出的内容 */
  menuShare: () => { title: string; query?: string; imageUrl?: string } | undefined;
  nickButton: () => MockNickButton | null;
  /** requirePrivacyAuthorize 被调用次数 */
  privacyCalls: () => number;
  /** 是否调用过 exitMiniProgram */
  exited: () => boolean;
  /** 上报隐私弹窗曝光的次数 */
  privacyExposures: () => number;
  /** 平台是否已记录用户同意（决定下次启动是否还弹隐私页） */
  privacyAgreed: () => boolean;
  now: () => number;
  tap(x: number, y: number): void;
  tapButton(label: string): boolean;
  tapSlot(slots: Map<number, any>, id: number): boolean;
  /** 每帧渲染后回调（脚本玩家在这里行动） */
  onFrame(cb: () => void): void;
  /** 运行直到 done() 为真或超时；返回是否完成 */
  run(done: () => boolean, timeoutMs: number): Promise<boolean>;
  errors: string[];
}

export function installWx(virtual: boolean): Harness {
  let vnow = 1_700_000_000_000;
  let seq = 0;
  const timers = new Map<number, { t: number; fn: () => void; every?: number }>();
  if (virtual) {
    Date.now = () => vnow;
    g.setTimeout = (fn: () => void, ms = 0) => {
      const id = ++seq;
      timers.set(id, { t: vnow + Math.max(0, ms), fn });
      return id;
    };
    g.setInterval = (fn: () => void, ms = 0) => {
      const id = ++seq;
      timers.set(id, { t: vnow + ms, fn, every: Math.max(1, ms) });
      return id;
    };
    g.clearTimeout = g.clearInterval = (id: number) => timers.delete(id);
  }

  let frameCb = () => undefined as void;
  g.requestAnimationFrame = (fn: (t: number) => void) =>
    setTimeout(() => {
      fn(Date.now());
      frameCb();
    }, 16);

  const store = new Map<string, string>();
  const touch: Record<string, ((e: any) => void)[]> = {};
  const on = (k: string) => (cb: (e: any) => void) => (touch[k] ??= []).push(cb);

  function ctxStub(): any {
    const vals: Record<string | symbol, unknown> = {};
    const grad = { addColorStop() {} };
    return new Proxy(vals, {
      get(t, p) {
        if (p in t) return t[p];
        if (p === "measureText") return (s: string) => ({ width: String(s).length * 8 });
        if (p === "createLinearGradient" || p === "createRadialGradient" || p === "createPattern")
          return () => grad;
        return () => undefined;
      },
      set(t, p, v) {
        t[p] = v;
        return true;
      },
    });
  }

  const shares: Harness["shares"] = [];
  let menuShareCb: (() => any) | null = null;
  let nickBtn: (MockNickButton & { cb?: (r: any) => void }) | null = null;
  let canvasCount = 0;
  let privacyCalls = 0;
  let privacyAgreed = false;
  let needPrivacyCb:
    | ((resolve: (r: { event: string }) => void, info?: { referrer: string }) => void)
    | null = null;
  let exited = false;
  let privacyExposures = 0;
  let canvasTouched = false;
  const acceptAgree = (r: { event: string }) => r.event === "agree" && canvasTouched;

  g.wx = {
    getSystemInfoSync: () => ({
      windowWidth: 874,
      windowHeight: 402,
      pixelRatio: 3,
      platform: "devtools",
      safeArea: { left: 59, right: 815, top: 0, bottom: 381 },
    }),
    createCanvas: () => {
      const ctx = ctxStub();
      const n = ++canvasCount;
      let exported = 0;
      return {
        width: 0,
        height: 0,
        getContext: () => ctx,
        toTempFilePathSync: () => `wxfile://tmp/canvas${n}-${++exported}.png`,
      };
    },
    shareAppMessage: (o: any) => shares.push(o),
    onShareAppMessage: (cb: () => any) => (menuShareCb = cb),
    showShareMenu: () => undefined,
    getSetting: (o: any) => setTimeout(() => o.success({ authSetting: {} }), 5),
    // 自定义隐私弹窗模式：未同意时回调游戏注册的监听，由游戏界面点击后 resolve
    onNeedPrivacyAuthorization: (cb: any) => (needPrivacyCb = cb),
    requirePrivacyAuthorize: (o: any) => {
      privacyCalls++;
      if (privacyAgreed || !needPrivacyCb) {
        privacyAgreed = true;
        return setTimeout(() => o.success(), 5);
      }
      needPrivacyCb((r: { event: string }) => {
        if (r.event === "exposureAuthorization") return void privacyExposures++;
        // 与真实基础库一致：resolve 前须有画布点击，否则报 click action before resolve is needed
        if (acceptAgree(r)) {
          privacyAgreed = true;
          o.success();
        } else o.fail();
      });
    },
    getPrivacySetting: (o: any) =>
      setTimeout(() => o.success({ needAuthorization: !privacyAgreed, privacyContractName: "《测试隐私保护指引》" }), 5),
    openPrivacyContract: () => undefined,
    exitMiniProgram: () => (exited = true),
    createUserInfoButton: (o: { style: Record<string, number | string> }) => {
      nickBtn = {
        style: { ...o.style },
        visible: true,
        // 与真实基础库一致：未同意隐私时，先回调 onNeedPrivacyAuthorization（referrer 为本按钮）
        tap(nickName: string) {
          const ok = () => this.cb?.({ errMsg: "getUserInfo:ok", userInfo: { nickName }, rawData: "{}" });
          if (privacyAgreed || !needPrivacyCb) return ok();
          needPrivacyCb(
            (r: { event: string }) => {
              if (r.event === "exposureAuthorization") return void privacyExposures++;
              if (!acceptAgree(r))
                return this.cb?.({ errMsg: "getUserInfo:fail privacy permission is not authorized" });
              privacyAgreed = true;
              ok();
            },
            { referrer: "createUserInfoButton" }
          );
        },
        tapFail(errMsg: string) {
          this.cb?.({ errMsg });
        },
      };
      const btn = nickBtn;
      return {
        style: btn.style,
        onTap: (cb: (r: any) => void) => (btn.cb = cb),
        show: () => (btn.visible = true),
        hide: () => (btn.visible = false),
      };
    },
    createImage: () => {
      const img: any = { width: 96, height: 134 };
      Object.defineProperty(img, "src", { set: () => setTimeout(() => img.onload?.(), 5) });
      return img;
    },
    getStorageSync: (k: string) => store.get(k) ?? "",
    setStorageSync: (k: string, v: string) => store.set(k, v),
    removeStorageSync: (k: string) => store.delete(k),
    showModal: (o: { success(r: { confirm: boolean }): void }) =>
      setTimeout(() => o.success({ confirm: true }), 50),
    connectSocket({ url, protocols }: { url: string; protocols?: string[] }) {
      const ws = new NativeWebSocket(url, protocols);
      ws.binaryType = "arraybuffer";
      return {
        send: ({ data }: { data: unknown }) => ws.send(data),
        close: ({ code, reason }: { code?: number; reason?: string }) => ws.close(code, reason),
        onOpen: (cb: () => void) => ws.addEventListener("open", () => cb()),
        onMessage: (cb: (r: unknown) => void) =>
          ws.addEventListener("message", (e: any) => cb({ data: e.data })),
        onClose: (cb: (r: unknown) => void) =>
          ws.addEventListener("close", (e: any) => cb({ code: e.code, reason: e.reason })),
        onError: (cb: (r: unknown) => void) =>
          ws.addEventListener("error", () => cb({ errMsg: "socket error" })),
      };
    },
    request({ url, method = "GET", header, data, dataType, success, fail }: any) {
      if (virtual) return setTimeout(() => fail({ errMsg: "request:fail offline test" }), 5);
      const body = data === undefined || typeof data === "string" ? data : JSON.stringify(data);
      fetch(url, { method, headers: header, body })
        .then(async (res) => {
          const text = await res.text();
          let parsed: unknown = text;
          if (dataType !== "text") {
            try {
              parsed = JSON.parse(text);
            } catch {
              /* 保持字符串 */
            }
          }
          success({ statusCode: res.status, data: parsed, header: Object.fromEntries(res.headers) });
        })
        .catch((e) => fail({ errMsg: `request:fail ${e.message}` }));
    },
    onTouchStart: on("start"),
    onTouchMove: on("move"),
    onTouchEnd: on("end"),
    onTouchCancel: on("cancel"),
    onHide: () => undefined,
    onError: () => undefined,
  };
  delete g.XMLHttpRequest;

  const errors: string[] = [];
  const origError = console.error;
  console.error = (...a: unknown[]) => {
    errors.push(a.map(String).join(" "));
    origError(...a);
  };

  const hook = () => g.__jhd;
  let touchId = 0;
  const h: Harness = {
    hook,
    shares,
    menuShare: () => menuShareCb?.(),
    nickButton: () => nickBtn,
    privacyCalls: () => privacyCalls,
    exited: () => exited,
    privacyExposures: () => privacyExposures,
    privacyAgreed: () => privacyAgreed,
    now: () => Date.now(),
    errors,
    tap(x, y) {
      const t = { identifier: ++touchId, clientX: x, clientY: y };
      canvasTouched = true;
      touch.start?.forEach((cb) => cb({ touches: [t], changedTouches: [t] }));
      touch.end?.forEach((cb) => cb({ touches: [], changedTouches: [t] }));
    },
    tapButton(label) {
      const b = hook().overlay.hits.find((x: any) => x.label === label);
      if (!b) return false;
      h.tap(b.x + b.w / 2, b.y + b.h / 2);
      return true;
    },
    tapSlot(slots, id) {
      const v = hook().view;
      const s = slots.get(id);
      if (!s) return false;
      h.tap(v.pad.x + (s.x + s.w / 2) * v.scale, v.pad.y + (s.y + s.w * 0.7) * v.scale);
      return true;
    },
    onFrame(cb) {
      frameCb = cb;
    },
    async run(done, timeoutMs) {
      if (!virtual) {
        const end = Date.now() + timeoutMs;
        while (!done() && Date.now() < end) await new Promise((r) => realTimeout(r, 50));
        return done();
      }
      const end = vnow + timeoutMs;
      while (!done() && vnow < end) {
        let next: [number, { t: number; fn: () => void; every?: number }] | null = null;
        for (const e of timers) if (!next || e[1].t < next[1].t) next = e;
        if (!next) break;
        const [id, tm] = next;
        if (tm.every) tm.t += tm.every;
        else timers.delete(id);
        vnow = Math.max(vnow, tm.t);
        try {
          tm.fn();
        } catch (e) {
          errors.push(`异常：${(e as Error).stack}`);
        }
        await new Promise((r) => realImmediate(r));
      }
      return done();
    },
  };

  vm.runInThisContext(readFileSync(GAME_JS, "utf8"), { filename: GAME_JS });
  return h;
}

/** 轮到自己时按 AI 策略出手；通过触摸点手牌 / 桌面牌。返回是否行动 */
export function playMyTurn(
  h: Harness,
  chooseHandPlay: (hand: number[], table: number[]) => { cardId: number },
  state: any,
  hand: number[],
  mySeat: number
): boolean {
  const v = h.hook().view;
  if (!state || state.phase !== "PLAYING" || state.currentSeat !== mySeat) return false;
  if (v.turnBlocked || v.animating) return false;
  if (state.turnPhase === "CHOOSE_STOCK_TARGET") {
    if (v.targets.length) h.tapSlot(v.tableSlots, v.targets[0]);
    return true;
  }
  if (v.discardArmed >= 0) return h.tapSlot(v.handSlots, v.discardArmed);
  if (v.selected >= 0 && v.targets.length) return h.tapSlot(v.tableSlots, v.targets[0]);
  if (!hand.length) return false;
  const move = chooseHandPlay([...hand], [...state.table]);
  return h.tapSlot(v.handSlots, move.cardId);
}
