import basicSsl from "@vitejs/plugin-basic-ssl";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

// The playground imports the source directly (no build), so engine changes show up instantly.
// `npm run dev:lan` uses HTTPS to test on a tablet over the local network (secure context).
export default defineConfig(({ mode }) => ({
  root: fileURLToPath(new URL(".", import.meta.url)),
  base: "./",
  resolve: {
    alias: [
      // Order matters: the subpath before the root package.
      {
        find: /^papercore\/storage$/,
        replacement: fileURLToPath(new URL("../src/storage/index.ts", import.meta.url)),
      },
      { find: /^papercore$/, replacement: fileURLToPath(new URL("../src/index.ts", import.meta.url)) },
    ],
  },
  plugins: mode === "lan" ? [basicSsl()] : [],
  server: { port: 5173 },
  build: { outDir: "dist", emptyOutDir: true },
}));
