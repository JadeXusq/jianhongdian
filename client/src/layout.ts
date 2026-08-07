/**
 * 屏幕方向：全界面按横屏设计，竖屏触屏时整幅画面软件旋转 90°。
 *
 * 不用 screen.orientation.lock()：仅 Android 全屏 Chrome 可用，iOS 不支持。
 */

/** 触屏设备且当前为竖屏 → 需要软件旋转 */
export function shouldRotate(): boolean {
  return (
    window.innerHeight > window.innerWidth &&
    window.matchMedia("(pointer: coarse)").matches
  );
}

/** 监听方向/尺寸变化（含移动端旋转后的延迟上报） */
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
}

/**
 * Android 在祖先带 CSS transform 时原生 overflow 滚动常失效；
 * 旋转模式下用触摸位移驱动 scrollTop（视觉纵向 ≈ 物理 -clientX）。
 */
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
