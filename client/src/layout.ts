/**
 * 横屏玩法；竖屏触屏时软件旋转 90°，与 #ui.rot 对齐。
 * screen.orientation.lock 仅部分安卓可用，不作为唯一手段。
 */

export function shouldRotate(): boolean {
  return (
    window.innerHeight > window.innerWidth &&
    window.matchMedia("(pointer: coarse)").matches
  );
}

export function lockLandscape(): void {
  if (shouldRotate()) return;
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

export function bindRotScroll(el: HTMLElement): void {
  if ((el as any)._rotScrollBound) return;
  (el as any)._rotScrollBound = true;

  let dragging = false;
  let last = 0;
  const axis = (t: Touch) => (shouldRotate() ? -t.clientX : t.clientY);

  el.addEventListener(
    "touchstart",
    (e) => {
      if (e.touches.length !== 1) return;
      dragging = true;
      last = axis(e.touches[0]);
    },
    { passive: true }
  );

  el.addEventListener(
    "touchmove",
    (e) => {
      if (!dragging || e.touches.length !== 1) return;
      if (!shouldRotate()) return;
      const max = el.scrollHeight - el.clientHeight;
      if (max <= 0) return;
      const now = axis(e.touches[0]);
      el.scrollTop = Math.max(0, Math.min(max, el.scrollTop + (last - now)));
      last = now;
      e.preventDefault();
    },
    { passive: false }
  );

  const end = () => {
    dragging = false;
  };
  el.addEventListener("touchend", end, { passive: true });
  el.addEventListener("touchcancel", end, { passive: true });
}
