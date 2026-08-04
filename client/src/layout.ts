/**
 * 屏幕方向：牌桌为横屏设计，竖屏触屏对局时整幅画面软件旋转 90°。
 * 大厅/房间等菜单不旋转，避免真机竖屏裁切。
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
  window.addEventListener("resize", fn);
  // iOS 旋转后 innerWidth/Height 更新有延迟，补一次
  window.addEventListener("orientationchange", () => setTimeout(fn, 120));
}
