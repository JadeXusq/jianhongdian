import { defineConfig } from "vite";
import { resolve } from "path";

export default defineConfig({
  // 直接引用 shared 源码，规则逻辑与服务器保持同一份
  resolve: {
    alias: { "@jhd/shared": resolve(__dirname, "../shared/src/index.ts") },
  },
  server: {
    port: 5173,
    fs: { allow: [resolve(__dirname, "..")] },
  },
});
