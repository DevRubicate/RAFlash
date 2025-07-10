import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import { resolve } from "path";

export default defineConfig({
  plugins: [vue()],
  base: "./",
  root: resolve(__dirname, "src/html"),
  build: {
    outDir: resolve(__dirname, "..", ".build", "internals", "assets"),
    emptyOutDir: true,
    rollupOptions: {
      input: {
        "asset-editor": resolve(__dirname, "src/html/asset-editor.html"),
        "asset-list": resolve(__dirname, "src/html/asset-list.html"),
        "memory-inspector": resolve(
          __dirname,
          "src/html/memory-inspector.html"
        ),
        menu: resolve(__dirname, "src/html/menu.html"),
      },
    },
  },
});