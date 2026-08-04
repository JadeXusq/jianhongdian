/**
 * 屏幕方向：牌桌为横屏设计，竖屏时整幅画面软件旋转 90°。
 *
 * 为什么不用 screen.orientation.lock()：它只在全屏下的 Android Chrome 生效，
 * iOS Safari 完全不支持；且用户开了系统「方向锁定」时任何方案都无法真正转屏。
 * 软件旋转不依赖系统，无论方向锁开关都能保证横屏呈现。
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
