/**
 * 账号绑定冒烟（直接测 store）：创号 → 多设备绑定 → 战绩合并。
 *   npx tsx tools/accountSmoke.ts
 */
import {
  bindDevice,
  createAccount,
  getProfile,
  leaderboard,
  recordResult,
} from "../server/src/store";

function main(): void {
  const suffix = Date.now().toString(36);
  const created = createAccount("账号甲");
  if (!created.accountId || !created.token)
    throw new Error("创建账号失败");

  const d1 = `dev-guest-1-${suffix}`;
  const d2 = `dev-guest-2-${suffix}`;

  recordResult(d1, "游客一", 10);
  recordResult(d1, "游客一", -5);
  const before = getProfile(d1);
  if (!before || before.games !== 2 || before.accountId)
    throw new Error("游客战绩未写入 " + JSON.stringify(before));

  const merged = bindDevice(created.accountId, created.token, d1);
  if (merged.games < 2)
    throw new Error("合并后局数不对 " + JSON.stringify(merged));

  recordResult(d2, "游客二", 20);
  const merged2 = bindDevice(created.accountId, created.token, d2);
  if (merged2.games < 3)
    throw new Error("第二设备合并失败 " + JSON.stringify(merged2));

  recordResult(d2, "账号甲", 3);
  const after = getProfile(d2);
  if (!after?.accountId || after.games !== merged2.games + 1)
    throw new Error("绑定后记分未进账号 " + JSON.stringify(after));

  const row = leaderboard(50).find((r) => r.accountId === created.accountId);
  if (!row) throw new Error("排行榜无账号行");

  let rejected = false;
  try {
    bindDevice(created.accountId, "wrong-token", `dev-x-${suffix}`);
  } catch {
    rejected = true;
  }
  if (!rejected) throw new Error("错误凭证应被拒绝");

  console.log("✅ 账号冒烟通过", {
    accountId: created.accountId,
    games: after.games,
    totalNet: after.totalNet,
  });
}

try {
  main();
} catch (e) {
  console.error("❌", (e as Error).message || e);
  process.exit(1);
}
