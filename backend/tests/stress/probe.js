/*
 * Probe a fixture in a real browser: report load time, rendered page height,
 * DOM node count, and extraction timing/count at the maxElements cap.
 * Usage: node tests/stress/probe.js [html-file]
 */
const path = require("path");
const puppeteer = require("puppeteer");

async function main() {
  const file = process.argv[2] || path.join(__dirname, "fixtures", "heavy.html");
  const url = "file:///" + path.resolve(file).replace(/\\/g, "/");
  const browser = await puppeteer.launch({ headless: "new", args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });

  const t0 = Date.now();
  await page.goto(url, { waitUntil: "load", timeout: 120000 });
  const tLoad = Date.now() - t0;
  await new Promise((r) => setTimeout(r, 3000));

  const info = await page.evaluate(() => ({
    scrollHeight: document.documentElement.scrollHeight,
    scrollWidth: document.documentElement.scrollWidth,
    nodeCount: document.getElementsByTagName("*").length,
    styleSheets: document.styleSheets.length,
    cssRules: (() => { let n = 0; try { for (const s of document.styleSheets) n += (s.cssRules || []).length; } catch (e) {} return n; })(),
    bodyChildren: document.body.children.length,
  }));
  console.log("load=" + tLoad + "ms");
  console.log(JSON.stringify(info, null, 2));

  const t1 = Date.now();
  const png = await page.screenshot({ type: "png", clip: { x: 0, y: 0, width: Math.min(info.scrollWidth, 1440), height: Math.min(info.scrollHeight, 30000) } });
  console.log("screenshot(" + Math.min(info.scrollHeight, 30000) + "px tall)=" + (Date.now() - t1) + "ms, " + (png.length / 1048576).toFixed(1) + "MB");

  await browser.close();
}

main().catch((e) => { console.error("PROBE FAILED:", e.message); process.exit(1); });
