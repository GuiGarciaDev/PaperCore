import { expect, test, type Page } from "@playwright/test";

const stats = (page: Page) => page.locator("#stats");
const strokeCount = (n: number) => new RegExp(`Strokes on page: ${n} `);

/** Draws a horizontal wave with the mouse, in the middle of the visible page area. */
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

/** Sweeps the eraser top to bottom, crossing the wave in the middle. */
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
  await expect(page.locator("#save-info")).toHaveText("Saved locally");
});

test("draws, undoes and redoes", async ({ page }) => {
  await drawWave(page);
  await expect(stats(page)).toContainText(strokeCount(1));
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(stats(page)).toContainText(strokeCount(0));
  await page.getByRole("button", { name: "Redo" }).click();
  await expect(stats(page)).toContainText(strokeCount(1));
});

test("the eraser cuts the stroke in two and one undo restores it", async ({ page }) => {
  await drawWave(page);
  await page.getByRole("button", { name: "Eraser" }).click();
  await eraseVertical(page);
  await expect(stats(page)).toContainText(strokeCount(2));
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(stats(page)).toContainText(strokeCount(1));
});

test("the document persists across reloads (IndexedDB + autosave)", async ({ page }) => {
  await drawWave(page);
  await expect(page.locator("#save-info")).toHaveText("Saved locally");
  await page.reload();
  await expect(stats(page)).toContainText(strokeCount(1));
});

test("pages: create, navigate and delete with confirmation", async ({ page }) => {
  await page.getByRole("button", { name: "Page", exact: true }).click();
  await expect(page.locator("#page-label")).toHaveText("2 / 2");
  await drawWave(page);
  await page.getByRole("button", { name: "Previous page" }).click();
  await expect(page.locator("#page-label")).toHaveText("1 / 2");
  await expect(stats(page)).toContainText(strokeCount(0));

  await page.getByRole("button", { name: "Delete page" }).click();
  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(page.locator("#page-label")).toHaveText("1 / 2");

  await page.getByRole("button", { name: "Delete page" }).click();
  await page.locator("#confirm-ok").click();
  await expect(page.locator("#page-label")).toHaveText("1 / 1");
  // The page with the stroke is the one left.
  await expect(stats(page)).toContainText(strokeCount(1));
});

test("read-only: dragging pans the page instead of drawing", async ({ page }) => {
  await page.locator(".toggle").click();
  await drawWave(page);
  await expect(stats(page)).toContainText(strokeCount(0));
  await expect(page.getByRole("button", { name: "Delete page" })).toBeDisabled();
});

test("thick curved strokes have no holes (regression)", async ({ page }) => {
  await page.locator("#width").fill("12");
  await drawWave(page);
  // Samples the content layer along the wave's center line: everything is painted.
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
