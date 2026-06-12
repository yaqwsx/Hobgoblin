import { chromium } from "playwright";
import { existsSync } from "node:fs";

const url = process.env.HOBGOBLIN_UI_URL ?? "http://127.0.0.1:1420/?sample=1";
const localChromium = "/snap/bin/chromium";
const executablePath =
  process.env.CHROMIUM_PATH || (existsSync(localChromium) ? localChromium : undefined);
const browser = await chromium.launch({
  executablePath,
  args: ["--no-sandbox", "--disable-gpu"],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });

try {
  await page.goto(url, { waitUntil: "networkidle" });
  await page.getByText("Simple spur stack").waitFor();
  await page.locator(".feature-tree").getByText("20T spur gear").waitFor();
  await page.getByText("0 errors, 0 warnings").waitFor();

  const regionCount = await page.locator(".region-polygon").count();
  const vertexCount = await page.locator(".vertex-handle").count();
  const axisHandleCount = await page.locator(".axis-handle").count();
  if (regionCount < 2 || vertexCount < 8 || axisHandleCount < 8) {
    throw new Error(
      `expected planning polygons and handles, got regions=${regionCount} vertices=${vertexCount} axisHandles=${axisHandleCount}`,
    );
  }

  await page.locator(".region-polygon").nth(1).click();
  await page.getByText("Axis-aligned rectangle").waitFor();
  const verticesBeforeAdd = await page.locator(".vertex-handle").count();
  await page.locator(".edge-add-handle").nth(4).click();
  const verticesAfterAdd = await page.locator(".vertex-handle").count();
  if (verticesAfterAdd !== verticesBeforeAdd + 1) {
    throw new Error(`expected vertex add to increase count from ${verticesBeforeAdd}, got ${verticesAfterAdd}`);
  }
  await page.locator(".vertex-handle").nth(verticesAfterAdd - 1).dblclick();
  const verticesAfterDelete = await page.locator(".vertex-handle").count();
  if (verticesAfterDelete !== verticesBeforeAdd) {
    throw new Error(`expected vertex delete to restore count ${verticesBeforeAdd}, got ${verticesAfterDelete}`);
  }
  await page.getByTitle("Measure").click();
  await page.locator(".vertex-handle").first().click();
  await page.locator(".vertex-handle").nth(1).click();
  await page.getByText("ds").waitFor();
} finally {
  await browser.close();
}
