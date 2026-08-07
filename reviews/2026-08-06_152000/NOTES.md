# 评审过程备注 · 2026-08-06_152000

- 设备：iPhone 393×852 + `Emulation.setTouchEmulationEnabled`（触发 `pointer: coarse` → 软件旋转）
- 基线：`96fd727` → `5546359`
- 体验：人机离线 4 人，约 1 局至菜单强制最终结算
- #20 观察：`animClock` 冻结时页面 RAF 仍能跑；手动 `view.render` 可消化 steps；怀疑 `frame()` 异常中断链式调度（IDE 浏览器节流可能放大）
- #21 实锤：样式表无通用 `.hidden`，`.btn.hidden` 仍 `display:block`
- 未做：真机联机双端聊天未读角标、Cocos 端对等验证（本轮以 Web 移动端为主）
