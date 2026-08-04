/**
 * Cocos Creator 压缩 UUID 生成：场景文件里引用自定义脚本组件时，
 * __type__ 用的是脚本 uuid 的压缩形式（23 字符 = 5 位十六进制头 + 18 位 base64）。
 * 算法为引擎 decodeUuid 的逆运算，用官方模板中的样本做过校验。
 */
const BASE64_KEYS =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

export function compressUuid(uuid) {
  const hex = uuid.replace(/-/g, "");
  if (hex.length !== 32) throw new Error(`uuid 长度异常: ${uuid}`);
  let out = hex.slice(0, 5);
  for (let i = 5; i < 32; i += 3) {
    const h0 = parseInt(hex[i], 16);
    const h1 = parseInt(hex[i + 1], 16);
    const h2 = parseInt(hex[i + 2], 16);
    const lhs = (h0 << 2) | (h1 >> 2);
    const rhs = ((h1 & 3) << 4) | h2;
    out += BASE64_KEYS[lhs] + BASE64_KEYS[rhs];
  }
  return out;
}

/** 生成 Cocos 风格的随机 uuid */
export function newUuid() {
  const hex = "0123456789abcdef";
  let s = "";
  for (let i = 0; i < 32; i++) s += hex[Math.floor(Math.random() * 16)];
  return `${s.slice(0, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}-${s.slice(
    16,
    20
  )}-${s.slice(20)}`;
}

/** 节点 / 组件用的短 id（22 字符），格式与编辑器生成的一致即可 */
export function shortId() {
  const keys = BASE64_KEYS.slice(0, 62); // 避免 + / 便于阅读
  let s = "";
  for (let i = 0; i < 22; i++) s += keys[Math.floor(Math.random() * 62)];
  return s;
}
