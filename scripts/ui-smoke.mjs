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
  await page.locator(".feature-overlay", { has: page.locator(".profile.selected") }).getByText(text).waitFor();
}

async function expectAdjacentInspectorLayout({ minEditorWidth }) {
  const featureTreeBox = await page.locator(".feature-tree").boundingBox();
  const inspectorBox = await page.locator(".inspector").boundingBox();
  const editorBox = await page.locator(".editor-plane").boundingBox();
  assert(featureTreeBox !== null, "expected feature tree panel to be measurable");
  assert(inspectorBox !== null, "expected inspector panel to be measurable");
  assert(editorBox !== null, "expected editor preview panel to be measurable");
  assert(
    Math.abs(inspectorBox.x - (featureTreeBox.x + featureTreeBox.width)) <= 4,
    `expected inspector adjacent to feature tree, tree right=${(featureTreeBox.x + featureTreeBox.width).toFixed(2)} inspector left=${inspectorBox.x.toFixed(2)}`,
  );
  assert(
    editorBox.x > inspectorBox.x + inspectorBox.width,
    `expected preview to sit after the inspector, editor left=${editorBox.x.toFixed(2)} inspector right=${(inspectorBox.x + inspectorBox.width).toFixed(2)}`,
  );
  assert(
    editorBox.width >= minEditorWidth,
    `expected preview to remain usable at ${page.viewportSize()?.width}px viewport, got width=${editorBox.width.toFixed(2)} px`,
  );
  return { featureTreeBox, inspectorBox, editorBox };
}

try {
  await page.goto(url, { waitUntil: "networkidle" });
  await page.getByText("Simple spur stack").waitFor();
  const topbarBox = await page.locator(".topbar").boundingBox();
  const workspaceBox = await page.locator(".workspace").boundingBox();
  assert(topbarBox !== null, "expected top command ribbon to be measurable");
  assert(workspaceBox !== null, "expected workspace to be measurable");
  assert(
    topbarBox.height <= 88,
    `expected compact command ribbon at 1440px viewport, got height=${topbarBox.height.toFixed(2)} px`,
  );
  assert(
    workspaceBox.y <= 96,
    `expected workspace to start near top of viewport, got y=${workspaceBox.y.toFixed(2)} px`,
  );
  assert(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    "expected compact command ribbon to avoid document-level horizontal overflow",
  );
  await page.locator(".feature-tree").getByText("20T spur gear").waitFor();
  const { featureTreeBox } = await expectAdjacentInspectorLayout({ minEditorWidth: 740 });
  for (const [width, minEditorWidth] of [
    [1280, 680],
    [1024, 420],
  ]) {
    await page.setViewportSize({ width, height: 960 });
    await expectAdjacentInspectorLayout({ minEditorWidth });
    assert(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      `expected page to avoid document-level horizontal overflow at ${width}px viewport`,
    );
    if (width === 1024) {
      const ribbonScroll = await page.evaluate(() => {
        const ribbonElement = document.querySelector(".command-ribbon");
        if (!(ribbonElement instanceof HTMLElement)) {
          return null;
        }
        const initialLeft = ribbonElement.scrollLeft;
        ribbonElement.scrollLeft = ribbonElement.scrollWidth;
        const scrolledLeft = ribbonElement.scrollLeft;
        ribbonElement.scrollLeft = initialLeft;
        return {
          clientWidth: ribbonElement.clientWidth,
          scrollWidth: ribbonElement.scrollWidth,
          scrolledLeft,
        };
      });
      assert(ribbonScroll !== null, "expected command ribbon to be measurable");
      assert(
        ribbonScroll.scrollWidth > ribbonScroll.clientWidth,
        "expected compact command ribbon to keep internal horizontal scrolling at 1024px",
      );
      assert(
        ribbonScroll.scrolledLeft > 0,
        "expected compact command ribbon to allow scrolling to offscreen commands at 1024px",
      );
    }
  }
  await page.setViewportSize({ width: 1440, height: 960 });
  const visibleStackAction = page
    .locator(".feature-tree .tree-item-with-actions", { hasText: "20T spur gear" })
    .locator(".tree-row-actions");
  const visibleStackActionBox = await visibleStackAction.boundingBox();
  assert(visibleStackActionBox !== null, "expected stack row action column to be measurable");
  const featureTreeRight = featureTreeBox.x + featureTreeBox.width;
  const visibleStackActionRight = visibleStackActionBox.x + visibleStackActionBox.width;
  assert(
    visibleStackActionRight <= featureTreeRight,
    `expected stack row actions to stay inside feature tree, action right=${visibleStackActionRight.toFixed(2)} panel right=${featureTreeRight.toFixed(2)}`,
  );
  assert(
    (await page.locator(".feature-tree").getByText("Stack intervals", { exact: true }).count()) === 0,
    "expected internal stack intervals to stay out of the feature browser",
  );
  assert(
    !(await page.locator("body").innerText()).toLowerCase().includes("stack intervals"),
    "expected internal stack interval wording to stay out of the main designer UI",
  );
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
    "Libraries",
  ]) {
    const button = ribbon.getByRole("button", { name, exact: true });
    await button.waitFor();
    assert((await button.getAttribute("title")) !== null, `expected ${name} command to expose a title`);
    const buttonBox = await button.boundingBox();
    assert(buttonBox !== null, `expected ${name} command to be measurable`);
    assert(
      buttonBox.x >= 0 && buttonBox.x + buttonBox.width <= 1440,
      `expected ${name} command to be visible in the 1440px ribbon viewport`,
    );
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
  await page.locator(".viewport-controls").getByLabel("Pan up").waitFor();
  await page.locator(".viewport-controls").getByLabel("Pan down").waitFor();
  await page.locator(".datum-marker").getByText("datum").waitFor();
  assert((await page.locator(".axis-label").count()) === 0, "expected preview to avoid chart-style unit axis labels");
  await page.locator("canvas.planning-webgl-canvas[data-renderer='webgl'][data-grid='dynamic-model-space']").waitFor();
  const initialGrid = await page.locator("canvas.planning-webgl-canvas").evaluate((canvas) => ({
    minorS: Number(canvas.getAttribute("data-grid-minor-s")),
    minorD: Number(canvas.getAttribute("data-grid-minor-d")),
  }));
  assert(
    Number.isFinite(initialGrid.minorS) && initialGrid.minorS > 0,
    `expected dynamic grid to expose positive shaft-length spacing, got ${initialGrid.minorS}`,
  );
  assert(
    Number.isFinite(initialGrid.minorD) && initialGrid.minorD > 0,
    `expected dynamic grid to expose positive diameter spacing, got ${initialGrid.minorD}`,
  );
  const webglStats = await page.locator("canvas.planning-webgl-canvas").evaluate((canvas) => {
    const context = canvas.getContext("2d");
    if (context) {
      const sample = context.getImageData(0, 0, canvas.width, canvas.height).data;
      return { hasPixels: sample.some((value, index) => index % 4 !== 3 && value < 250), distinctColors: 0, shaftPixels: 0, stockPixels: 0, gridPixels: 0 };
    }
    const gl = canvas.getContext("webgl");
    if (!gl) {
      return { hasPixels: false, distinctColors: 0, shaftPixels: 0, stockPixels: 0, gridPixels: 0 };
    }
    const pixels = new Uint8Array(canvas.width * canvas.height * 4);
    gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    let hasPixels = false;
    let shaftPixels = 0;
    let stockPixels = 0;
    let gridPixels = 0;
    const colors = new Set();
    for (let index = 0; index < pixels.length; index += 16) {
      const r = pixels[index];
      const g = pixels[index + 1];
      const b = pixels[index + 2];
      if (r < 250 || g < 250 || b < 250) {
        hasPixels = true;
      }
      if (g > r * 1.04 && g >= b && r > 70 && b > 60) {
        shaftPixels += 1;
      }
      if (r > g * 1.1 && g > b * 1.15 && r > 120) {
        stockPixels += 1;
      }
      if (r >= 204 && r <= 235 && g >= 214 && g <= 244 && b >= 212 && b <= 242) {
        gridPixels += 1;
      }
      colors.add(`${Math.round(r / 16)},${Math.round(g / 16)},${Math.round(b / 16)}`);
    }
    return { hasPixels, distinctColors: colors.size, shaftPixels, stockPixels, gridPixels };
  });
  assert(webglStats.hasPixels, "expected WebGL preview canvas to render nonblank geometry");
  assert(
    webglStats.distinctColors >= 18,
    `expected WebGL preview to render shaded/material-varied geometry, got ${webglStats.distinctColors} color buckets`,
  );
  assert(
    webglStats.shaftPixels > 1000,
    `expected WebGL preview to include shaft/gear-colored pixels, got ${webglStats.shaftPixels}`,
  );
  assert(
    webglStats.stockPixels > 1000,
    `expected WebGL preview to include stock/protected warm material pixels, got ${webglStats.stockPixels}`,
  );
  assert(
    webglStats.gridPixels > 1000,
    `expected WebGL preview to include subdued dynamic grid pixels, got ${webglStats.gridPixels}`,
  );
  assert((await page.locator(".shaft-axis").count()) === 1, "expected preview to render a central shaft axis");
  assert((await page.locator(".gear-teeth").count()) >= 2, "expected gears to render visible teeth on both sides of the shaft");
  const stockBoxBeforeNavigation = await page.locator(".stock-rect").boundingBox();
  const shaftAxisBox = await page.locator(".shaft-axis").boundingBox();
  const viewportBackgroundBoxBeforeNavigation = await page.locator(".viewport-background").boundingBox();
  const viewportShellBox = await page.locator(".planning-webgl-viewport").boundingBox();
  const shaftAxisY = shaftAxisBox ? shaftAxisBox.y + shaftAxisBox.height / 2 : null;
  assert(stockBoxBeforeNavigation !== null, "expected stock material to be measurable");
  assert(shaftAxisY !== null, "expected shaft axis to be measurable");
  assert(viewportBackgroundBoxBeforeNavigation !== null, "expected viewport background to be measurable");
  assert(viewportShellBox !== null, "expected preview viewport shell to be measurable");
  assert(
    Math.abs(viewportBackgroundBoxBeforeNavigation.x - viewportShellBox.x) <= 2
      && Math.abs(viewportBackgroundBoxBeforeNavigation.y - viewportShellBox.y) <= 2
      && Math.abs(viewportBackgroundBoxBeforeNavigation.width - viewportShellBox.width) <= 4
      && Math.abs(viewportBackgroundBoxBeforeNavigation.height - viewportShellBox.height) <= 4,
    "expected model viewport background to fill the preview pane without chart margins",
  );
  assert(
    stockBoxBeforeNavigation.y < shaftAxisY && stockBoxBeforeNavigation.y + stockBoxBeforeNavigation.height > shaftAxisY,
    "expected stock material to span both sides of the shaft axis",
  );
  await page.locator(".viewport-controls").getByLabel("Zoom out").click();
  await page.getByText("0.7x").waitFor();
  const zoomedOutGrid = await page.locator("canvas.planning-webgl-canvas").evaluate((canvas) => ({
    minorS: Number(canvas.getAttribute("data-grid-minor-s")),
    minorD: Number(canvas.getAttribute("data-grid-minor-d")),
  }));
  assert(
    zoomedOutGrid.minorS > initialGrid.minorS || zoomedOutGrid.minorD > initialGrid.minorD,
    `expected grid spacing to adapt after zooming out, initial=${initialGrid.minorS}/${initialGrid.minorD} zoomed=${zoomedOutGrid.minorS}/${zoomedOutGrid.minorD}`,
  );
  const zoomedOutStockBox = await page.locator(".stock-rect").boundingBox();
  assert(zoomedOutStockBox !== null, "expected stock material to be measurable after zooming out");
  assert(
    zoomedOutStockBox.width < stockBoxBeforeNavigation.width,
    `expected zooming out below fit to make stock smaller, before=${stockBoxBeforeNavigation.width.toFixed(2)} after=${zoomedOutStockBox.width.toFixed(2)}`,
  );
  await page.locator(".viewport-controls").getByLabel("Pan right").click();
  const zoomedOutPannedStockBox = await page.locator(".stock-rect").boundingBox();
  assert(zoomedOutPannedStockBox !== null, "expected stock material to be measurable after zoomed-out pan");
  assert(
    zoomedOutPannedStockBox.x < zoomedOutStockBox.x - 20,
    `expected toolbar panning to move geometry while zoomed out, before=${zoomedOutStockBox.x.toFixed(2)} after=${zoomedOutPannedStockBox.x.toFixed(2)}`,
  );
  await page.locator(".viewport-controls").getByLabel("Fit stack").click();
  await page.getByText("1.0x").waitFor();
  await page.locator(".viewport-controls").getByLabel("Zoom in").click();
  await page.getByText("1.5x").waitFor();
  await page.locator(".viewport-controls").getByLabel("Pan right").click();
  await page.locator(".viewport-controls").getByLabel("Pan up").click();
  await page.locator(".viewport-controls").getByLabel("Fit stack").click();
  await page.getByText("1.0x").waitFor();
  const viewportBackground = page.locator(".viewport-background");
  const viewportBox = await viewportBackground.boundingBox();
  assert(viewportBox !== null, "expected viewport background to be measurable");
  const zoomAnchorLabel = page.locator(".feature-label").filter({ hasText: "20T spur gear" }).first();
  const zoomAnchorBefore = await zoomAnchorLabel.boundingBox();
  assert(zoomAnchorBefore !== null, "expected gear label to be measurable before cursor zoom");
  const zoomCursorX = zoomAnchorBefore.x + zoomAnchorBefore.width / 2;
  const zoomCursorY = zoomAnchorBefore.y + zoomAnchorBefore.height / 2;
  await page.mouse.move(zoomCursorX, zoomCursorY);
  await page.mouse.wheel(0, -500);
  await page.getByText("1.2x").waitFor();
  const zoomAnchorAfter = await zoomAnchorLabel.boundingBox();
  assert(zoomAnchorAfter !== null, "expected gear label to be measurable after cursor zoom");
  const zoomAnchorDeltaX = Math.abs((zoomAnchorAfter.x + zoomAnchorAfter.width / 2) - zoomCursorX);
  const zoomAnchorDeltaY = Math.abs((zoomAnchorAfter.y + zoomAnchorAfter.height / 2) - zoomCursorY);
  assert(
    zoomAnchorDeltaX <= 8,
    `expected cursor zoom to preserve model position under cursor, got x delta ${zoomAnchorDeltaX.toFixed(2)} px`,
  );
  assert(
    zoomAnchorDeltaY <= 8,
    `expected cursor zoom to preserve model position under cursor, got y delta ${zoomAnchorDeltaY.toFixed(2)} px`,
  );
  const panStartX = viewportBox.x + viewportBox.width * 0.55;
  const panStartY = viewportBox.y + viewportBox.height * 0.55;
  const panAnchorBefore = await zoomAnchorLabel.boundingBox();
  assert(panAnchorBefore !== null, "expected gear label to be measurable before background pan");
  await page.mouse.move(panStartX, panStartY);
  await page.keyboard.down("Shift");
  await page.mouse.down();
  await page.mouse.move(panStartX + 90, panStartY + 60, { steps: 6 });
  await page.mouse.up();
  await page.keyboard.up("Shift");
  const panAnchorAfter = await zoomAnchorLabel.boundingBox();
  assert(panAnchorAfter !== null, "expected gear label to be measurable after background pan");
  const panDeltaX = (panAnchorAfter.x + panAnchorAfter.width / 2) - (panAnchorBefore.x + panAnchorBefore.width / 2);
  const panDeltaY = (panAnchorAfter.y + panAnchorAfter.height / 2) - (panAnchorBefore.y + panAnchorBefore.height / 2);
  assert(panDeltaX > 20, `expected drag panning to move model right, got x delta ${panDeltaX.toFixed(2)} px`);
  assert(panDeltaY > 8, `expected drag panning to move model down, got y delta ${panDeltaY.toFixed(2)} px`);
  await page.mouse.move(panStartX, panStartY);
  await page.keyboard.down("Shift");
  await page.mouse.down();
  await page.mouse.move(panStartX - 90, panStartY - 60, { steps: 6 });
  await page.mouse.up();
  await page.keyboard.up("Shift");
  const panAnchorAfterReverse = await zoomAnchorLabel.boundingBox();
  assert(panAnchorAfterReverse !== null, "expected gear label to be measurable after reverse background pan");
  const reversePanDeltaX =
    (panAnchorAfterReverse.x + panAnchorAfterReverse.width / 2) - (panAnchorAfter.x + panAnchorAfter.width / 2);
  const reversePanDeltaY =
    (panAnchorAfterReverse.y + panAnchorAfterReverse.height / 2) - (panAnchorAfter.y + panAnchorAfter.height / 2);
  assert(reversePanDeltaX < -20, `expected reverse drag panning to move model left, got x delta ${reversePanDeltaX.toFixed(2)} px`);
  assert(reversePanDeltaY < -8, `expected reverse drag panning to move model up, got y delta ${reversePanDeltaY.toFixed(2)} px`);
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
  await page.locator(".feature-tree").getByText("20T spur gear").click();
  await expectInspectorSubtitle("feature.spur_20t");
  const dependentRegionCountBeforeFeatureDelete = await page.locator(".region-polygon").count();
  await page.getByRole("button", { name: "Delete feature", exact: true }).click();
  await page.waitForFunction(
    (expectedCount) => document.querySelectorAll(".region-polygon").length === expectedCount,
    dependentRegionCountBeforeFeatureDelete - 1,
  );
  assert(
    (await page.locator(".feature-tree").getByText("Gear finish region").count()) === 0,
    "expected removed dependent planning region to disappear from the browser",
  );
  await ribbon.getByRole("button", { name: "Sample", exact: true }).click();
  await page.locator(".feature-tree").getByText("20T spur gear").waitFor();
  await page.getByText("0 errors, 0 warnings").waitFor();

  await ribbon.getByRole("button", { name: "Libraries", exact: true }).click();
  await page.locator(".inspector").getByRole("button", { name: "Tools", exact: true }).click();
  await page.locator(".inspector").getByLabel("Tool").selectOption("tool.v.60deg.3mm_flat");
  await page.locator(".inspector").getByLabel("Name").fill("60 degree V cutter, smoke edited");
  assert(
    (await page.locator(".inspector").getByLabel("Name").inputValue()) === "60 degree V cutter, smoke edited",
    "expected tool library name edit to update the typed form",
  );
  await page.getByRole("button", { name: "Add cylindrical", exact: true }).click();
  assert(
    (await page.locator(".inspector").getByLabel("Name").inputValue()) === "Manual cylindrical cutter",
    "expected added cylindrical tool to become selected in the library editor",
  );
  await page.locator(".feature-tree").getByText("Right journal").click();
  await expectInspectorSubtitle("feature.right_journal");
  await page.locator("fieldset", { hasText: "Machining tools" }).getByLabel("Roughing tool").selectOption("tool.endmill.manual");
  await page.locator(".inspector").getByLabel("Roughing tool").evaluate((select) => {
    if (select.value !== "tool.endmill.manual") {
      throw new Error("expected edited library tool to be selectable from feature inspector");
    }
  });
  await ribbon.getByRole("button", { name: "Libraries", exact: true }).click();
  await page.locator(".inspector").getByRole("button", { name: "Import/export", exact: true }).click();
  await page.getByRole("button", { name: "Refresh export", exact: true }).click();
  const libraryJson = await page.locator(".inspector").getByLabel("Library JSON").inputValue();
  assert(libraryJson.includes("tool.endmill.manual"), "expected exported library JSON to include the added tool");

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
  await page.locator(".inspector").getByText("Position s").waitFor();
  await page.getByRole("button", { name: "Delete feature", exact: true }).click();
  await page.getByText("Deleted Spur gear").waitFor();
  assert(
    (await page.locator(".feature-tree").getByText("Spur gear", { exact: true }).count()) === 0,
    "expected deleted stack feature to disappear from the browser",
  );

  await page.locator(".feature-tree").getByText("stock.brass_16x100").click();
  await expectInspectorSubtitle("stock.brass_16x100");
  assert(
    (await page.locator(".stock-rect.selected").count()) === 1,
    "expected stock selection to be highlighted in the preview",
  );
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
  const gearStackRows = page
    .locator(".feature-tree .tree-section")
    .filter({ hasText: "Gear stack" })
    .first()
    .locator(".tree-item-with-actions");
  await gearStackRows.filter({ hasText: "Right journal" }).dragTo(gearStackRows.filter({ hasText: "20T spur gear" }));
  await page.getByText("Moved Right journal").waitFor();
  await gearStackRows.first().getByText("Right journal").waitFor();

  await ribbon.getByRole("button", { name: "Protect", exact: true }).click();
  await page.locator(".feature-tree").getByText("protect.manual").waitFor();
  await expectInspectorSubtitle("protect.manual");
  await expectSelectedTreeItem("protect.manual");
  const protectedPurpose = page.locator(".inspector").getByLabel("Purpose");
  await protectedPurpose.fill("keep_clear");
  await page.locator(".feature-tree").getByText("keep_clear").waitFor();
  await page.locator(".inspector").getByLabel("Start s mm").fill("48");
  await page.locator(".feature-tree").getByText("48.00").waitFor();
  await page.getByRole("button", { name: "Delete protected interval", exact: true }).click();
  await page.getByText("Deleted protect.manual").waitFor();
  assert(
    (await page.locator(".feature-tree").getByText("protect.manual").count()) === 0,
    "expected deleted protected interval to disappear from the browser",
  );

  await page.locator(".feature-tree").getByText("Right journal").click();
  await expectInspectorSubtitle("feature.right_journal");
  await expectSelectedTreeItem("Right journal");
  await expectSelectedProfileLabel("Right journal");
  await page.locator(".feature-overlay", { hasText: "Left journal" }).locator(".profile").click();
  await expectInspectorSubtitle("feature.left_journal");
  await expectSelectedTreeItem("Left journal");
  await expectSelectedProfileLabel("Left journal");

  await page.locator(".region-polygon").nth(1).click();
  await page.getByText("Axis-aligned rectangle").waitFor();
  const verticesBeforeAdd = await page.locator(".vertex-handle").count();
  await page.locator(".vertex-row").first().getByRole("button", { name: "Add" }).click();
  const verticesAfterAdd = await page.locator(".vertex-handle").count();
  assert(
    verticesAfterAdd === verticesBeforeAdd + 1,
    `expected vertex add to increase count from ${verticesBeforeAdd}, got ${verticesAfterAdd}`,
  );
  await page.getByText("Polygon").waitFor();
  await page.locator(".vertex-row").nth(1).getByRole("button", { name: "Delete" }).click();
  const verticesAfterDelete = await page.locator(".vertex-handle").count();
  assert(
    verticesAfterDelete === verticesBeforeAdd,
    `expected vertex delete to restore count ${verticesBeforeAdd}, got ${verticesAfterDelete}`,
  );
  await page.getByTitle("Measure").click();
  await page.locator(".vertex-handle").first().click();
  await page.locator(".vertex-handle").nth(1).click();
  await page.locator(".measurement-overlay").getByText("ds").waitFor();
  const regionCountBeforeDelete = await page.locator(".region-polygon").count();
  await page.getByRole("button", { name: "Delete planning region", exact: true }).click();
  await page.waitForFunction(
    (expectedCount) => document.querySelectorAll(".region-polygon").length === expectedCount,
    regionCountBeforeDelete - 1,
  );
  const regionCountAfterDelete = await page.locator(".region-polygon").count();
  assert(
    regionCountAfterDelete === regionCountBeforeDelete - 1,
    `expected region delete to reduce region count from ${regionCountBeforeDelete}, got ${regionCountAfterDelete}`,
  );
  await mkdir(screenshotPath.split("/").slice(0, -1).join("/") || ".", { recursive: true });
  await page.screenshot({ path: screenshotPath, fullPage: true });
  assert(
    pageErrors.length === 0,
    `expected smoke flow not to raise page errors, got ${pageErrors.map((error) => error.message).join("; ")}`,
  );
} finally {
  await browser.close();
}
