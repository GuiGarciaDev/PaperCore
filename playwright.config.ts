import { defineConfig, devices } from "@playwright/test";

// Testes de ponta a ponta no playground, com o Chrome instalado na máquina (sem baixar navegadores).
// Cada teste roda num contexto novo: IndexedDB vazio.
export default defineConfig({
  testDir: "e2e",
  fullyParallel: true,
  reporter: [["list"]],
  use: {
    ...devices["Desktop Chrome"],
    channel: "chrome",
    baseURL: "http://localhost:5173",
    viewport: { width: 1280, height: 800 },
    trace: "retain-on-failure",
  },
  webServer: {
    command: "npm run dev",
    url: "http://localhost:5173",
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
