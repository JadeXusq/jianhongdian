/** 仅横屏：竖屏时提示旋转，支持的浏览器尝试锁定 landscape */

export function isPortrait(): boolean {
  return window.innerHeight > window.innerWidth;
}

/** @deprecated 已取消软件旋转，恒为 false */
export function shouldRotate(): boolean {
  return false;
}

export function lockLandscape(): void {
  const o = screen.orientation as ScreenOrientation & {
    lock?: (mode: string) => Promise<void>;
  };
  o?.lock?.("landscape").catch(() => undefined);
}

export function onOrientationChange(fn: () => void): void {
  let pending = 0;
  const run = () => {
    if (pending) cancelAnimationFrame(pending);
    pending = requestAnimationFrame(() => {
      pending = requestAnimationFrame(fn);
    });
  };
  window.addEventListener("resize", run);
  window.addEventListener("orientationchange", () => {
    setTimeout(run, 120);
    setTimeout(run, 320);
  });
  window.visualViewport?.addEventListener("resize", run);
  window.visualViewport?.addEventListener("scroll", run);
}

export function bindRotScroll(_el: HTMLElement): void {}
