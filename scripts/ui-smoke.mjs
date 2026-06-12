import { chromium } from "playwright";
import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";

const url = process.env.HOBGOBLIN_UI_URL ?? "http://127.0.0.1:1420/?sample=1";
const screenshotPath = process.env.HOBGOBLIN_UI_SCREENSHOT ?? "target/ui-smoke/hobgoblin-ui-smoke.png";
const localChromium = "/snap/bin/chromium";
const executablePath =
  process.env.CHROMIUM_PATH || (existsSync(localChromium) ? localChromium : undefined);
const browser = await chromium.launch({
  executablePath,
  args: ["--no-sandbox", "--disable-gpu"],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
const pageErrors = [];
page.on("pageerror", (error) => pageErrors.push(error));

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function expectInspectorSubtitle(id) {
  await page.locator(".inspector .panel-header").getByText(id, { exact: true }).waitFor();
}

async function expectSelectedTreeItem(text) {
  await page.locator(".feature-tree .tree-item.selected", { hasText: text }).waitFor();
}

async function expectSelectedProfileLabel(text) {
  await page.locator("g", { has: page.locator(".profile.selected") }).getByText(text).waitFor();
}

try {
  await page.goto(url, { waitUntil: "networkidle" });
  await page.getByText("Simple spur stack").waitFor();
  await page.locator(".feature-tree").getByText("20T spur gear").waitFor();
  await page.getByText("0 errors, 0 warnings").waitFor();
  const ribbon = page.locator(".command-ribbon");
  for (const name of [
    "New",
    "Cylinder",
    "Spur",
    "Helical",
    "Herringbone",
    "Eccentric",
    "Region",
    "Protect",
    "Validate",
    "Preview",
    "Undo",
    "Redo",
    "Export",
  ]) {
    const button = ribbon.getByRole("button", { name, exact: true });
    await button.waitFor();
    assert((await button.getAttribute("title")) !== null, `expected ${name} command to expose a title`);
  }
  await ribbon.getByRole("button", { name: "Select mode", exact: true }).waitFor();
  await ribbon.getByRole("button", { name: "Measure mode", exact: true }).waitFor();
  await ribbon.getByTitle("Select", { exact: true }).waitFor();
  await ribbon.getByTitle("Measure", { exact: true }).waitFor();
  await ribbon.getByTitle("Helical schema placeholder; machining kernel is not implemented yet").waitFor();
  await ribbon.getByTitle("Herringbone schema placeholder; machining kernel is not implemented yet").waitFor();
  await ribbon.getByTitle("Eccentric schema placeholder; machining kernel is not implemented yet").waitFor();
  await page.locator(".viewport-controls").getByLabel("Zoom in").waitFor();
  await page.locator(".viewport-controls").getByLabel("Zoom out").waitFor();
  await page.locator(".viewport-controls").getByLabel("Fit stack").waitFor();
  await page.locator(".viewport-controls").getByLabel("Pan left").waitFor();
  await page.locator(".viewport-controls").getByLabel("Pan right").waitFor();
  await page.locator(".datum-marker").getByText("datum").waitFor();
  await page.locator(".viewport-controls").getByLabel("Zoom in").click();
  await page.getByText("1.5x").waitFor();
  await page.locator(".viewport-controls").getByLabel("Pan right").click();
  await page.locator(".viewport-controls").getByLabel("Fit stack").click();
  await page.getByText("1.0x").waitFor();

  const regionCount = await page.locator(".region-polygon").count();
  const vertexCount = await page.locator(".vertex-handle").count();
  const axisHandleCount = await page.locator(".axis-handle").count();
  const protectedIntervalCount = await page.locator(".protected").count();
  assert(
    regionCount >= 2 && vertexCount >= 8 && axisHandleCount >= 8,
    `expected planning polygons and handles, got regions=${regionCount} vertices=${vertexCount} axisHandles=${axisHandleCount}`,
  );
  assert(
    protectedIntervalCount >= 2,
    `expected chuck and tailstock protected intervals, got ${protectedIntervalCount}`,
  );

  await page.locator(".feature-tree").getByText("Single Carvera setup").click();
  await expectInspectorSubtitle("setup.single_carvera");
  const workholdingFields = page.locator("fieldset", { hasText: "Workholding" });
  await workholdingFields.getByLabel("Held side").selectOption("left");
  await workholdingFields.locator("select").nth(1).selectOption("enabled");
  await page.locator(".inspector").getByLabel("Tailstock start s").fill("87");
  await page.locator(".inspector").getByLabel("Tailstock end s").fill("95");

  await ribbon.getByRole("button", { name: "Cylinder", exact: true }).click();
  await page.locator(".feature-tree").getByText("Cylindrical section").waitFor();
  const profileCountAfterCreate = await page.locator(".profile").count();
  assert(
    profileCountAfterCreate >= 4,
    `expected added stack feature to appear in viewport, got profiles=${profileCountAfterCreate}`,
  );

  await ribbon.getByRole("button", { name: "Spur", exact: true }).click();
  await page.locator(".feature-tree").getByText("Spur gear", { exact: true }).waitFor();
  await expectInspectorSubtitle("feature.spur");
  await expectSelectedTreeItem("Spur gear");
  await expectSelectedProfileLabel("Spur gear");

  await page.locator(".feature-tree").getByText("stock.brass_16x100").click();
  await expectInspectorSubtitle("stock.brass_16x100");
  await page.locator(".inspector").getByLabel("Diameter mm").fill("17");
  await page.getByText("17.00 mm stock").waitFor();

  await page.locator(".feature-tree").getByText("20T spur gear").click();
  await expectInspectorSubtitle("feature.spur_20t");
  await page.locator(".inspector").getByLabel("Module mm").fill("0.6");
  await page.locator(".inspector").getByText("Outside radius").waitFor();
  const moduleInput = page.locator(".inspector").getByLabel("Module mm");
  const validModuleValue = await moduleInput.inputValue();
  await moduleInput.fill("1e999");
  await moduleInput.press("Tab");
  await page.locator(".inspector").getByLabel("Teeth").focus();
  assert(
    pageErrors.length === 0,
    `expected non-finite module input not to crash, got ${pageErrors.map((error) => error.message).join("; ")}`,
  );
  await moduleInput.fill(validModuleValue);

  await page.getByLabel("Move Left journal down").click();
  await page.getByText("Moved Left journal").waitFor();

  await ribbon.getByRole("button", { name: "Protect", exact: true }).click();
  await page.locator(".feature-tree").getByText("protect.manual").waitFor();
  await expectInspectorSubtitle("protect.manual");
  await expectSelectedTreeItem("protect.manual");
  const protectedPurpose = page.locator(".inspector").getByLabel("Purpose");
  await protectedPurpose.fill("keep_clear");
  await page.locator(".feature-tree").getByText("keep_clear").waitFor();
  await page.locator(".inspector").getByLabel("Start s mm").fill("48");
  await page.locator(".feature-tree").getByText("48.00").waitFor();

  await page.locator(".feature-tree").getByText("Right journal").click();
  await expectInspectorSubtitle("feature.right_journal");
  await expectSelectedTreeItem("Right journal");
  await expectSelectedProfileLabel("Right journal");
  await page.locator("g", { hasText: "Left journal" }).locator(".profile").click();
  await expectInspectorSubtitle("feature.left_journal");
  await expectSelectedTreeItem("Left journal");
  await expectSelectedProfileLabel("Left journal");

  await page.locator(".region-polygon").nth(1).click();
  await page.getByText("Axis-aligned rectangle").waitFor();
  const verticesBeforeAdd = await page.locator(".vertex-handle").count();
  await page.locator(".edge-add-handle").nth(4).click();
  const verticesAfterAdd = await page.locator(".vertex-handle").count();
  assert(
    verticesAfterAdd === verticesBeforeAdd + 1,
    `expected vertex add to increase count from ${verticesBeforeAdd}, got ${verticesAfterAdd}`,
  );
  await page.locator(".vertex-handle").nth(verticesAfterAdd - 1).dblclick();
  const verticesAfterDelete = await page.locator(".vertex-handle").count();
  assert(
    verticesAfterDelete === verticesBeforeAdd,
    `expected vertex delete to restore count ${verticesBeforeAdd}, got ${verticesAfterDelete}`,
  );
  await page.getByTitle("Measure").click();
  await page.locator(".vertex-handle").first().click();
  await page.locator(".vertex-handle").nth(1).click();
  await page.locator(".measurement-overlay").getByText("ds").waitFor();
  await mkdir(screenshotPath.split("/").slice(0, -1).join("/") || ".", { recursive: true });
  await page.screenshot({ path: screenshotPath, fullPage: true });
  assert(
    pageErrors.length === 0,
    `expected smoke flow not to raise page errors, got ${pageErrors.map((error) => error.message).join("; ")}`,
  );
} finally {
  await browser.close();
}
