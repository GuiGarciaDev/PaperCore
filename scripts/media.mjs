// Generates the README screenshots and GIFs in .github/media/ by driving the playground in Chrome.
// Pen input goes through the DevTools protocol with pointerType "pen" and a real pressure value,
// so the recordings show pressure-sensitive strokes exactly as a stylus would produce them.
//
//   npm run media
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";
import gifenc from "gifenc";
import { PNG } from "pngjs";
import { createServer } from "vite";

const { GIFEncoder, quantize, applyPalette } = gifenc;
const OUT = new URL("../.github/media/", import.meta.url);

// ---------------------------------------------------------------------------------------------
// Shapes, in pixels relative to the drawing surface. Each point is [x, y, pressure].

function spiral(cx, cy, turns, radius, n = 120) {
  return Array.from({ length: n }, (_, i) => {
    const t = i / (n - 1);
    const a = t * turns * Math.PI * 2;
    return [cx + Math.cos(a) * radius * t, cy + Math.sin(a) * radius * t, 0.2 + 0.6 * t];
  });
}

/** Prolate cycloid: a row of cursive loops, like handwriting "eeee". */
function loops(x0, y0, count, size, n = 160) {
  return Array.from({ length: n }, (_, i) => {
    const t = (i / (n - 1)) * count * Math.PI * 2;
    const p = 0.35 + 0.45 * Math.abs(Math.sin(t / 2));
    return [x0 + (size / 2) * t * 0.55 - size * 0.9 * Math.sin(t), y0 - size * 0.9 * Math.cos(t), p];
  });
}

function wave(x0, x1, y, amplitude, n = 90) {
  return Array.from({ length: n }, (_, i) => {
    const t = i / (n - 1);
    return [
      x0 + (x1 - x0) * t,
      y + Math.sin(t * Math.PI * 3) * amplitude,
      0.1 + 0.85 * Math.sin(t * Math.PI),
    ];
  });
}

function star(cx, cy, r, n = 60) {
  const corners = Array.from({ length: 6 }, (_, k) => {
    const a = -Math.PI / 2 + (k * 4 * Math.PI) / 5;
    return [cx + Math.cos(a) * r, cy + Math.sin(a) * r];
  });
  const points = [];
  for (let k = 0; k < 5; k++) {
    const [ax, ay] = corners[k];
    const [bx, by] = corners[k + 1];
    for (let i = 0; i < n / 5; i++) {
      const t = i / (n / 5);
      points.push([ax + (bx - ax) * t, ay + (by - ay) * t, 0.55]);
    }
  }
  points.push([...corners[5], 0.55]);
  return points;
}

function heart(cx, cy, s, n = 100) {
  return Array.from({ length: n }, (_, i) => {
    const t = (i / (n - 1)) * Math.PI * 2;
    const x = 16 * Math.sin(t) ** 3;
    const y = 13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t);
    return [cx + x * s, cy - y * s, 0.3 + 0.4 * Math.abs(Math.cos(t / 2))];
  });
}

function line(x0, y0, x1, y1, n = 40) {
  return Array.from({ length: n }, (_, i) => {
    const t = i / (n - 1);
    return [x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, 0.5];
  });
}

// ---------------------------------------------------------------------------------------------
// Recording

class Recorder {
  frames = [];
  constructor(page) {
    this.page = page;
  }
  async frame(delay = 40) {
    const png = PNG.sync.read(await this.page.screenshot({ type: "png" }));
    this.frames.push({ png, delay });
  }
  async hold(ms) {
    await this.frame(ms);
  }
  async save(name) {
    const { width, height } = this.frames[0].png;
    const gif = GIFEncoder();
    for (const { png, delay } of this.frames) {
      const palette = quantize(png.data, 128);
      gif.writeFrame(applyPalette(png.data, palette), width, height, { palette, delay });
    }
    gif.finish();
    await writeFile(new URL(name, OUT), gif.bytes());
    console.log(`${name}: ${this.frames.length} frames`);
    this.frames = [];
  }
}

async function surfaceBox(page) {
  return page.locator('canvas[data-layer="live"]').boundingBox();
}

/** Draws with a real pen event stream (pressure included). Records a frame every `every` points. */
async function pen(page, cdp, points, { rec = null, every = 6 } = {}) {
  const box = await surfaceBox(page);
  const send = (type, [x, y, p]) =>
    cdp.send("Input.dispatchMouseEvent", {
      type,
      x: box.x + x,
      y: box.y + y,
      button: "left",
      buttons: type === "mouseReleased" ? 0 : 1,
      clickCount: 1,
      pointerType: "pen",
      force: p,
    });
  await send("mousePressed", points[0]);
  for (let i = 1; i < points.length; i++) {
    await send("mouseMoved", points[i]);
    if (rec && i % every === 0) await rec.frame();
  }
  await send("mouseReleased", points.at(-1));
  if (rec) await rec.frame();
}

async function pickColor(page, name) {
  await page.getByRole("button", { name, exact: true }).click();
}

async function setWidth(page, value) {
  await page.locator("#width").fill(String(value));
}

/** The drawing used by the screenshots and the first GIF. */
async function drawScene(page, cdp, rec = null) {
  const box = await surfaceBox(page);
  const cx = box.width / 2;
  const top = Math.min(220, box.height * 0.28);
  const s = Math.min(1, box.width / 900);

  await pickColor(page, "Black");
  await setWidth(page, 4);
  await pen(page, cdp, spiral(cx - 230 * s, top, 3, 70 * s), { rec });

  await pickColor(page, "Blue");
  await setWidth(page, 5);
  await pen(page, cdp, loops(cx - 95 * s, top, 4, 34 * s), { rec });

  await pickColor(page, "Red");
  await setWidth(page, 9);
  await pen(page, cdp, wave(cx - 300 * s, cx + 300 * s, top + 190 * s, 45 * s), { rec });

  await pickColor(page, "Green");
  await setWidth(page, 4);
  await pen(page, cdp, star(cx + 265 * s, top + 5 * s, 65 * s), { rec });
}

async function freshPage(browser, options) {
  const context = await browser.newContext(options);
  const page = await context.newPage();
  await page.goto(BASE);
  await page.getByText("Saved locally").waitFor();
  const cdp = await context.newCDPSession(page);
  return { context, page, cdp };
}

// ---------------------------------------------------------------------------------------------

const server = await createServer({ configFile: "playground/vite.config.ts", server: { port: 5199 } });
await server.listen();
const BASE = "http://localhost:5199/";
const browser = await chromium.launch({ channel: "chrome" });
await mkdir(OUT, { recursive: true });

try {
  // Screenshots: light, dark and mobile.
  for (const [name, options] of [
    ["screenshot-light.png", { viewport: { width: 1280, height: 800 }, colorScheme: "light" }],
    ["screenshot-dark.png", { viewport: { width: 1280, height: 800 }, colorScheme: "dark" }],
    [
      "screenshot-mobile.png",
      { viewport: { width: 390, height: 844 }, colorScheme: "light", deviceScaleFactor: 2 },
    ],
  ]) {
    const { context, page, cdp } = await freshPage(browser, options);
    await drawScene(page, cdp);
    await page.getByText("Saved locally").waitFor();
    await page.screenshot({ path: fileURLToPath(new URL(name, OUT)) });
    console.log(name);
    await context.close();
  }

  const gifOptions = { viewport: { width: 960, height: 600 }, colorScheme: "light" };

  // GIF 1: pressure-sensitive pen.
  {
    const { context, page, cdp } = await freshPage(browser, gifOptions);
    const rec = new Recorder(page);
    await rec.hold(600);
    await drawScene(page, cdp, rec);
    await rec.hold(1800);
    await rec.save("pen.gif");
    await context.close();
  }

  // GIF 2: the eraser cuts strokes, then a single undo brings everything back.
  {
    const { context, page, cdp } = await freshPage(browser, gifOptions);
    await drawScene(page, cdp);
    const rec = new Recorder(page);
    await rec.hold(700);
    await page.getByRole("button", { name: "Eraser", exact: true }).click();
    await page.locator("#eraser-size").fill("30");
    await rec.hold(400);
    const box = await surfaceBox(page);
    const cx = box.width / 2;
    for (const x of [cx - 160, cx, cx + 150]) {
      await pen(page, cdp, line(x, 90, x + 20, 470, 50), { rec, every: 3 });
    }
    console.log("after erasing:", await page.locator("#stats").textContent());
    await rec.hold(1200);
    await page.getByRole("button", { name: "Undo" }).click();
    await rec.hold(500);
    await page.getByRole("button", { name: "Undo" }).click();
    await rec.hold(500);
    await page.getByRole("button", { name: "Undo" }).click();
    await rec.hold(1800);
    await rec.save("eraser.gif");
    await context.close();
  }

  // GIF 3: pages, backgrounds, zoom and pan.
  {
    const { context, page, cdp } = await freshPage(browser, gifOptions);
    await drawScene(page, cdp);
    const rec = new Recorder(page);
    await rec.hold(700);
    await page.locator("#add-page").click();
    await rec.hold(500);
    await page.locator("#background").selectOption({ label: "Grid" });
    await rec.hold(500);
    const box = await surfaceBox(page);
    await pickColor(page, "Red");
    await setWidth(page, 6);
    await pen(page, cdp, heart(box.width / 2, 260, 7), { rec, every: 5 });
    await rec.hold(500);
    for (let i = 0; i < 4; i++) {
      await page.getByRole("button", { name: "Zoom in" }).click();
      await rec.hold(250);
    }
    await page.getByRole("button", { name: "Pan", exact: true }).click();
    const from = [box.x + box.width / 2, box.y + box.height / 2];
    await page.mouse.move(...from);
    await page.mouse.down();
    for (let i = 1; i <= 15; i++) {
      await page.mouse.move(from[0] - i * 12, from[1] - i * 6);
      if (i % 3 === 0) await rec.frame();
    }
    await page.mouse.up();
    await rec.hold(600);
    await page.locator("#zoom-reset").click();
    await rec.hold(600);
    await page.getByRole("button", { name: "Previous page" }).click();
    await rec.hold(900);
    await page.getByRole("button", { name: "Next page" }).click();
    await rec.hold(1500);
    await rec.save("pages.gif");
    await context.close();
  }
} finally {
  await browser.close();
  await server.close();
}
