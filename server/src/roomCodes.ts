/**
 * 房号注册表：6 位数字房号 → Colyseus roomId
 * 单进程内存实现，MVP 足够；将来多进程部署时换成 Redis。
 */
const codeToRoomId = new Map<string, string>();

export function registerCode(roomId: string): string {
  let code: string;
  do {
    code = String(Math.floor(100000 + Math.random() * 900000));
  } while (codeToRoomId.has(code));
  codeToRoomId.set(code, roomId);
  return code;
}

export function resolveCode(code: string): string | undefined {
  return codeToRoomId.get(code);
}

export function unregisterCode(code: string): void {
  codeToRoomId.delete(code);
}
