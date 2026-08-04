import { defineConfig } from "vite";
import { resolve } from "path";

/** GitHub Pages 项目站默认 /jianhongdian/；本地开发用 / */
const base = process.env.VITE_BASE || "/";

export default defineConfig({
  base,
  resolve: {
    alias: { "@jhd/shared": resolve(__dirname, "../shared/src/index.ts") },
  },
  server: {
    port: 5173,
    host: true,
    fs: { allow: [resolve(__dirname, "..")] },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
});
