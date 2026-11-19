import basicSsl from "@vitejs/plugin-basic-ssl";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

// O playground importa o código-fonte direto (sem build), então mudanças no motor aparecem na hora.
// `npm run dev:lan` usa HTTPS para testar no tablet pela rede local (contexto seguro).
export default defineConfig(({ mode }) => ({
  root: fileURLToPath(new URL(".", import.meta.url)),
  base: "./",
  resolve: {
    alias: { papercore: fileURLToPath(new URL("../src/index.ts", import.meta.url)) },
  },
  plugins: mode === "lan" ? [basicSsl()] : [],
  server: { port: 5173 },
  build: { outDir: "dist", emptyOutDir: true },
}));
