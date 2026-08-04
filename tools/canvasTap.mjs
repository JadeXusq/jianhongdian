/**
 * 测试用：画布逻辑坐标 → 屏幕坐标。
 * 直接读取 TableView 运行时的 scale / pad / rotated，避免测试里重复推导变换
 * （曾因测试写死 1280 逻辑宽度而误报点击失效）。
 */
export async function tapLogical(page, lx, ly) {
  const p = await page.evaluate(
    ([lx, ly]) => {
      const { view } = window.__jhd;
      const c = document.querySelector("canvas");
      const vx = view.pad.x + lx * view.scale;
      const vy = view.pad.y + ly * view.scale;
      // 竖屏软件旋转时，渲染做了 translate(cw,0) + rotate(90°)
      return view.rotated ? { x: c.clientWidth - vy, y: vx } : { x: vx, y: vy };
    },
    [lx, ly]
  );
  return p;
}

/** 取某张牌槽位的中心（逻辑坐标） */
export const slotCenter = (slot) => ({
  x: slot.x + slot.w / 2,
  y: slot.y + slot.w * 0.7,
});
