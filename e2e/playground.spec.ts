import { expect, test, type Page } from "@playwright/test";

const stats = (page: Page) => page.locator("#stats");
const strokeCount = (n: number) => new RegExp(`Traços na página: ${n} `);

/** Desenha uma onda horizontal com o mouse, no meio da área visível da página. */
async function drawWave(page: Page, y = 300) {
  const box = (await page.locator('canvas[data-layer="live"]').boundingBox())!;
  const x0 = box.x + box.width * 0.3;
  const x1 = box.x + box.width * 0.7;
  await page.mouse.move(x0, box.y + y);
  await page.mouse.down();
  for (let i = 1; i <= 30; i++) {
    const t = i / 30;
    await page.mouse.move(x0 + (x1 - x0) * t, box.y + y + Math.sin(t * Math.PI * 2) * 40);
  }
  await page.mouse.up();
}

/** Passa a borracha de cima a baixo, cruzando a onda no meio. */
async function eraseVertical(page: Page, y = 300) {
  const box = (await page.locator('canvas[data-layer="live"]').boundingBox())!;
  const x = box.x + box.width * 0.5;
  await page.mouse.move(x, box.y + y - 80);
  await page.mouse.down();
  for (let i = 1; i <= 20; i++) await page.mouse.move(x, box.y + y - 80 + i * 8);
  await page.mouse.up();
}

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#save-info")).toHaveText("Salvo localmente");
});

test("desenha, desfaz e refaz", async ({ page }) => {
  await drawWave(page);
  await expect(stats(page)).toContainText(strokeCount(1));
  await page.getByRole("button", { name: "Desfazer" }).click();
  await expect(stats(page)).toContainText(strokeCount(0));
  await page.getByRole("button", { name: "Refazer" }).click();
  await expect(stats(page)).toContainText(strokeCount(1));
});

test("a borracha corta o traço em dois e um undo restaura", async ({ page }) => {
  await drawWave(page);
  await page.getByRole("button", { name: "Borracha" }).click();
  await eraseVertical(page);
  await expect(stats(page)).toContainText(strokeCount(2));
  await page.getByRole("button", { name: "Desfazer" }).click();
  await expect(stats(page)).toContainText(strokeCount(1));
});

test("o documento persiste ao recarregar (IndexedDB + autosave)", async ({ page }) => {
  await drawWave(page);
  await expect(page.locator("#save-info")).toHaveText("Salvo localmente");
  await page.reload();
  await expect(stats(page)).toContainText(strokeCount(1));
});

test("páginas: criar, navegar e excluir com confirmação", async ({ page }) => {
  await page.getByRole("button", { name: "Página", exact: true }).click();
  await expect(page.locator("#page-label")).toHaveText("2 / 2");
  await drawWave(page);
  await page.getByRole("button", { name: "Página anterior" }).click();
  await expect(page.locator("#page-label")).toHaveText("1 / 2");
  await expect(stats(page)).toContainText(strokeCount(0));

  await page.getByRole("button", { name: "Excluir página" }).click();
  await page.getByRole("button", { name: "Cancelar" }).click();
  await expect(page.locator("#page-label")).toHaveText("1 / 2");

  await page.getByRole("button", { name: "Excluir página" }).click();
  await page.locator("#confirm-ok").click();
  await expect(page.locator("#page-label")).toHaveText("1 / 1");
  // Sobrou a página que tinha o traço.
  await expect(stats(page)).toContainText(strokeCount(1));
});

test("somente leitura: o arraste move a página em vez de desenhar", async ({ page }) => {
  await page.locator(".toggle").click();
  await drawWave(page);
  await expect(stats(page)).toContainText(strokeCount(0));
  await expect(page.getByRole("button", { name: "Excluir página" })).toBeDisabled();
});

test("traços grossos em curva não têm buracos (regressão)", async ({ page }) => {
  await page.locator("#width").fill("12");
  await drawWave(page);
  // Amostra a camada de conteúdo ao longo da linha central da onda: tudo pintado.
  const unpainted = await page.evaluate(() => {
    const canvas = document.querySelector<HTMLCanvasElement>('canvas[data-layer="content"]')!;
    const ctx = canvas.getContext("2d")!;
    const rect = canvas.getBoundingClientRect();
    const pr = canvas.width / rect.width;
    let holes = 0;
    for (let i = 2; i <= 28; i++) {
      const t = i / 30;
      const x = (rect.width * 0.3 + rect.width * 0.4 * t) * pr;
      const y = (300 + Math.sin(t * Math.PI * 2) * 40) * pr;
      if (ctx.getImageData(Math.round(x), Math.round(y), 1, 1).data[3]! < 200) holes++;
    }
    return holes;
  });
  expect(unpainted).toBe(0);
});
