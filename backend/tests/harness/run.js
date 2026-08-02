const fs = require("fs-extra");
const path = require("path");
const { convertTo } = require("../../converters");
const { getPool, shutdownPool } = require("../../lib/browser-pool");
const { validateFormat } = require("./validators");
const { compareBuffers } = require("./pixel-diff");

const FIXTURES_DIR = path.join(__dirname, "..", "fixtures");
const OUTPUT_DIR = path.join(__dirname, "..", "output");
const WIDTH = 1440;
const HEIGHT = 900;

function pad(s, n) {
  s = String(s);
  while (s.length < n) s = " " + s;
  return s;
}

function formatBytes(n) {
  if (n > 1024 * 1024) return (n / 1024 / 1024).toFixed(1) + "MB";
  if (n > 1024) return (n / 1024).toFixed(1) + "KB";
  return n + "B";
}

function formatMs(ms) {
  return ms >= 1000 ? (ms / 1000).toFixed(1) + "s" : Math.round(ms) + "ms";
}

async function renderPage(html, name, forceWhite) {
  const pool = getPool();
  const png = await pool.execute(
    async (page) => {
      await page.setViewport({ width: WIDTH, height: HEIGHT, deviceScaleFactor: 1 });
      await page.setContent(html, { waitUntil: "networkidle2", timeout: 60000 });
      await page.evaluate(() => document.fonts && document.fonts.ready);
      await new Promise((r) => setTimeout(r, 600));
      if (forceWhite) {
        await page.evaluate(() => {
          document.body.style.backgroundColor = "#ffffff";
        });
      }
      const scrollHeight = await page.evaluate(() => Math.max(document.documentElement.scrollHeight, window.innerHeight));
      return page.screenshot({
        type: "png",
        clip: { x: 0, y: 0, width: WIDTH, height: Math.min(scrollHeight, 30000) },
      });
    },
    { timeout: 90000, retries: 2 }
  );
  if (name) {
    const outPath = path.join(OUTPUT_DIR, name + ".reference.png");
    await fs.writeFile(outPath, png);
  }
  return png;
}

async function renderSvgToPng(svgBuffer, name) {
  const pool = getPool();
  const svgStr = svgBuffer.toString("utf-8");
  const out = await pool.execute(
    async (page) => {
      await page.setContent('<html><body style="margin:0;background:#fff"><img id="i" src="data:image/svg+xml;base64,' + svgBuffer.toString("base64") + '" style="display:block"></body></html>', { waitUntil: "load", timeout: 30000 });
      await new Promise((r) => setTimeout(r, 800));
      const dims = await page.evaluate(() => {
        const img = document.getElementById("i");
        return { w: Math.round(img.naturalWidth || img.clientWidth), h: Math.round(img.naturalHeight || img.clientHeight) };
      });
      if (dims.w <= 0 || dims.h <= 0) throw new Error("SVG produced no dimensions");
      const clipHeight = Math.min(dims.h, 30000);
      const png = await page.screenshot({
        type: "png",
        clip: { x: 0, y: 0, width: Math.min(dims.w, 4096), height: clipHeight },
      });
      return png;
    },
    { timeout: 60000, retries: 2 }
  );
  return out;
}

async function convertOne(format, html, fixtureName, options, refPng) {
  const t0 = Date.now();
  let buffer = null;
  let error = null;
  try {
    buffer = await convertTo(format, html, options);
  } catch (e) {
    error = e.message || String(e);
  }
  const elapsed = Date.now() - t0;

  const row = {
    format,
    fixture: fixtureName,
    success: !error && !!buffer && buffer.length > 0,
    elapsedMs: elapsed,
    size: buffer ? buffer.length : 0,
    error,
  };

  if (row.success) {
    const v = validateFormat(format, buffer);
    row.valid = v.ok;
    row.validDetail = v.detail;
    row.extra = v.extra || null;
    row.buffer = buffer;
  }

  if (format === "png" && row.success) {
    if (refPng) {
      try {
        row.accuracy = await compareBuffers(refPng, buffer, {});
      } catch (e) {
        row.accuracy = { error: e.message };
      }
    }
  }

  if (format === "svg" && row.success) {
    try {
      const svgPng = await renderSvgToPng(buffer, fixtureName + ".svg");
      if (refPng) {
        row.accuracy = await compareBuffers(refPng, svgPng, {});
      }
    } catch (e) {
      row.accuracy = { error: e.message };
    }
  }

  return row;
}

async function runFixture(fixtureName, html, formats) {
  console.log("\n===== Fixture: " + fixtureName + " =====");
  const naturalRef = await renderPage(html, fixtureName, false);
  const whiteRef = await renderPage(html, fixtureName + ".white", true);
  const refSize = naturalRef.length;
  console.log("  Reference PNG: " + formatBytes(refSize) + ", " + WIDTH + "px wide");

  const results = [];
  for (const format of formats) {
    const opts = {
      width: WIDTH,
      height: HEIGHT,
      scale: 1,
      pageName: fixtureName,
      baseDir: FIXTURES_DIR,
      fullPage: true,
    };
    process.stdout.write("  " + pad(format, 12) + " ... ");
    const refPng = format === "png" ? whiteRef : naturalRef;
    const row = await convertOne(format, html, fixtureName, opts, refPng);
    results.push(row);
    process.stdout.write(
      (row.success ? (row.valid ? "OK " : "BAD") : "ERR") +
        "  " + (row.success ? formatBytes(row.size) : "") +
        "  " + formatMs(row.elapsedMs) +
        (row.accuracy && row.accuracy.accuracyScore !== undefined ? "  acc=" + row.accuracy.accuracyScore + "%" : "") +
        "\n"
    );
    if (row.error) process.stdout.write("       error: " + row.error + "\n");
    if (!row.valid && row.validDetail) process.stdout.write("       invalid: " + row.validDetail + "\n");
    row.buffer = undefined;
  }

  return { fixture: fixtureName, refSize, results };
}

async function main() {
  const onlyFormats = process.argv.slice(2).length > 0 ? process.argv.slice(2) : null;
  const allFormats = [
    "png", "pdf", "svg", "psd", "xd", "figma", "clipboard", "inline",
    "figma-mcp", "figma-plugin", "figma-all",
  ];
  const formats = onlyFormats ? onlyFormats.filter((f) => allFormats.includes(f)) : allFormats;

  await fs.ensureDir(OUTPUT_DIR);
  const fixtureFiles = await fs.readdir(FIXTURES_DIR);
  const fixtures = fixtureFiles.filter((f) => f.endsWith(".html")).sort();

  if (fixtures.length === 0) {
    console.error("No fixtures found in " + FIXTURES_DIR);
    process.exit(1);
  }

  const summary = [];
  const tStart = Date.now();
  for (const f of fixtures) {
    const html = await fs.readFile(path.join(FIXTURES_DIR, f), "utf-8");
    summary.push(await runFixture(f.replace(/\.html$/i, ""), html, formats));
  }

  await shutdownPool();
  const totalMs = Date.now() - tStart;

  console.log("\n\n========== SUMMARY ==========");
  const header = pad("format", 12) + "  " + pad("fixture", 12) + "  " + pad("ok", 4) + "  " + pad("valid", 6) + "  " + pad("size", 9) + "  " + pad("time", 8) + "  " + pad("acc", 7) + "  " + pad("rmse", 7);
  console.log(header);
  console.log("-".repeat(header.length));

  const report = { generated: new Date().toISOString(), totalMs, fixtures: [] };
  let totalOk = 0;
  let totalFailed = 0;

  for (const s of summary) {
    const fixtureReport = { name: s.fixture, refSize: s.refSize, results: [] };
    for (const r of s.results) {
      const acc = r.accuracy && r.accuracy.accuracyScore !== undefined ? r.accuracy.accuracyScore : (r.accuracy && r.accuracy.error ? "n/a" : "—");
      const rmse = r.accuracy && r.accuracy.rmse !== undefined ? r.accuracy.rmse : "—";
      const ok = r.success && r.valid !== false ? "OK" : "ERR";
      if (ok === "OK") totalOk++;
      else totalFailed++;
      console.log(
        pad(r.format, 12) + "  " + pad(s.fixture, 12) + "  " + pad(ok, 4) + "  " + pad(r.valid ? "y" : "n", 6) +
        "  " + pad(formatBytes(r.size), 9) + "  " + pad(formatMs(r.elapsedMs), 8) + "  " + pad(acc, 7) + "  " + pad(rmse, 7)
      );
      fixtureReport.results.push({
        format: r.format,
        success: ok === "OK",
        valid: r.valid,
        validDetail: r.validDetail || null,
        elapsedMs: r.elapsedMs,
        size: r.size,
        error: r.error || null,
        accuracy: r.accuracy || null,
        extra: r.extra || null,
      });
    }
    report.fixtures.push(fixtureReport);
  }

  const reportPath = path.join(OUTPUT_DIR, "report.json");
  await fs.writeFile(reportPath, JSON.stringify(report, null, 2), "utf-8");
  console.log("\nTotal: " + totalOk + " ok / " + totalFailed + " failed · " + formatMs(totalMs) + " · report: " + reportPath);
}

main().catch((e) => {
  console.error("Harness failed:", e);
  process.exit(1);
});
