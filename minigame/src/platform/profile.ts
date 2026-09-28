/**
 * 平台昵称获取：
 * - 微信：必须由用户点击 wx.createUserInfoButton（盖在画布上的原生透明按钮）授权；已授权时可 getUserInfo 静默取。
 * - 抖音：tt.login 后 tt.getUserInfo，首次调用弹授权窗。
 * 正式发布前需在平台后台配置《用户隐私保护指引》（含用户信息），否则授权无法弹出。
 */
import { api, platformName } from "./index";

export interface UserInfoButton {
  style: Record<string, number | string>;
  onTap(cb: (res: { errMsg: string; userInfo?: { nickName: string } }) => void): void;
  show(): void;
  hide(): void;
}

export interface ProfileApi {
  createUserInfoButton?(opts: { type: string; text: string; style: Record<string, number | string> }): UserInfoButton;
  getSetting?(opts: { success(res: { authSetting: Record<string, boolean> }): void; fail?(): void }): void;
  getUserInfo?(opts: { success(res: { userInfo: { nickName: string } }): void; fail?(err: { errMsg: string }): void }): void;
  login?(opts: { force?: boolean; success(): void; fail?(): void }): void;
  requirePrivacyAuthorize?(opts: { success(): void; fail(): void }): void;
  onNeedPrivacyAuthorization?(
    cb: (
      resolve: (r: { event: "exposureAuthorization" | "agree" | "disagree" }) => void,
      info?: { referrer?: string }
    ) => void
  ): void;
  getPrivacySetting?(opts: { success(res: { needAuthorization: boolean; privacyContractName: string }): void; fail?(): void }): void;
  openPrivacyContract?(opts: { fail?(): void }): void;
}

const p = api as unknown as ProfileApi;

export const platformNickLabel = platformName === "douyin" ? "用抖音昵称" : "用微信昵称";

function login(force: boolean): Promise<boolean> {
  if (!p.login || platformName !== "douyin") return Promise.resolve(true);
  return new Promise((resolve) =>
    p.login!({ force, success: () => resolve(true), fail: () => resolve(false) })
  );
}

function getUserInfo(): Promise<string | null> {
  if (!p.getUserInfo) return Promise.resolve(null);
  return new Promise((resolve) =>
    p.getUserInfo!({
      success: (res) => resolve(res.userInfo?.nickName?.trim() || null),
      fail: () => resolve(null),
    })
  );
}

/** 已授权过则静默取昵称（用于首次启动自动填充），未授权返回 null */
export function silentNickname(): Promise<string | null> {
  if (!p.getSetting) return Promise.resolve(null);
  return new Promise((resolve) =>
    p.getSetting!({
      success: (res) => {
        if (res.authSetting?.["scope.userInfo"] !== true) return resolve(null);
        void login(false).then((ok) => (ok ? getUserInfo().then(resolve) : resolve(null)));
      },
      fail: () => resolve(null),
    })
  );
}

/** 抖音：用户点击后主动请求（首次弹授权窗） */
export async function requestNickname(): Promise<string | null> {
  if (!(await login(true))) return null;
  return getUserInfo();
}

/**
 * 微信隐私协议：用户未同意时 createUserInfoButton 会返回 104（privacy permission is not authorized）。
 * 主动拉起官方隐私弹窗；已同意则立即成功。非微信或基础库不支持时视为已同意。
 */
export function requirePrivacy(): Promise<boolean> {
  if (platformName !== "wechat" || !p.requirePrivacyAuthorize) return Promise.resolve(true);
  return new Promise((resolve) =>
    p.requirePrivacyAuthorize!({ success: () => resolve(true), fail: () => resolve(false) })
  );
}

export function isPrivacyError(errMsg: string): boolean {
  return /privacy/i.test(errMsg);
}

/**
 * 启用自定义隐私弹窗模式（《小游戏隐私合规开发指南》2.2.1）：任何隐私接口在用户未同意时都会先回调 onNeed，
 * 由游戏展示自己的隐私界面。平台要求依次上报：曝光（界面展示时）→ 同意 / 拒绝。
 * 同意 / 拒绝须由画布上的点击触发，点原生按钮不算，否则平台不记录，每次启动都会再弹。
 */
export function setupPrivacyPopup(onNeed: (answer: (agree: boolean) => void) => void): void {
  if (platformName !== "wechat" || !p.onNeedPrivacyAuthorization) return;
  p.onNeedPrivacyAuthorization((resolve) => {
    // 隐私页在有待回应请求时即全屏展示，因此收到请求即上报曝光
    resolve({ event: "exposureAuthorization" });
    onNeed((agree) => resolve({ event: agree ? "agree" : "disagree" }));
  });
}

/** 隐私指引名称，如《xx小程序隐私保护指引》 */
export function privacyContractName(): Promise<string> {
  const fallback = "《用户隐私保护指引》";
  if (!p.getPrivacySetting) return Promise.resolve(fallback);
  return new Promise((resolve) =>
    p.getPrivacySetting!({
      success: (res) => resolve(res.privacyContractName || fallback),
      fail: () => resolve(fallback),
    })
  );
}

export function openPrivacyContract(onFail: () => void): void {
  if (!p.openPrivacyContract) return onFail();
  p.openPrivacyContract({ fail: onFail });
}

let nativeBtn: UserInfoButton | null = null;
let nativeRect = "";
let onNative: (name: string | null, errMsg: string) => void = () => undefined;

/** 微信是否走原生授权按钮 */
export const useNativeNickButton = platformName === "wechat" && !!p.createUserInfoButton;

/**
 * 每帧同步微信原生授权按钮：rect 为画布上「用微信昵称」按钮的位置，null 表示当前界面不需要。
 * 原生按钮透明，视觉仍由画布绘制。
 */
export function syncNickButton(
  rect: { x: number; y: number; w: number; h: number } | null,
  onName: (name: string | null, errMsg: string) => void
): void {
  if (!useNativeNickButton) return;
  onNative = onName;
  if (!rect) {
    if (nativeRect) nativeBtn?.hide();
    nativeRect = "";
    return;
  }
  const key = `${rect.x},${rect.y},${rect.w},${rect.h}`;
  if (key === nativeRect) return;
  const style = {
    left: Math.round(rect.x),
    top: Math.round(rect.y),
    width: Math.round(rect.w),
    height: Math.round(rect.h),
    backgroundColor: "rgba(0,0,0,0)",
    color: "rgba(0,0,0,0)",
    borderWidth: 0,
    fontSize: 1,
    lineHeight: Math.round(rect.h),
  };
  if (!nativeBtn) {
    nativeBtn = p.createUserInfoButton!({ type: "text", text: "", style });
    nativeBtn.onTap((res) => {
      const errMsg = res.errMsg ?? "";
      onNative(errMsg.includes(":ok") ? res.userInfo?.nickName?.trim() || null : null, errMsg);
    });
  } else Object.assign(nativeBtn.style, style);
  nativeBtn.show();
  nativeRect = key;
}
