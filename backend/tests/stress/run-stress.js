/*
 * Feed the heavy stress fixture through every converter, save each output to
 * tests/stress/output/, validate it, and time it. Also renders reference PNGs
 * of the source for later similarity comparisons.
 *
 * Usage: node tests/stress/run-stress.js [format ...]   (no args = all formats)
 */
const fs = require("fs-extra");
const path = require("path");
const { convertTo } = require("../../converters");
const { getPool, shutdownPool } = require("../../lib/browser-pool");
const { validateFormat } = require("../harness/validators");
const { compareBuffers } = require("../harness/pixel-diff");

const FIXTURE = path.join(__dirname, "fixtures", "heavy.html");
const OUT_DIR = path.join(__dirname, "output");
const WIDTH = 1440;
const HEIGHT = 900;

const EXT = {
  png: "png", pdf: "pdf", svg: "svg", psd: "psd", xd: "sketch",
  figma: "fig", clipboard: "html", inline: "json",
  "figma-mcp": "json", "figma-plugin": "json", "figma-all": "json",
};

function pad(s, n) { s = String(s); while (s.length < n) s = " " + s; return s; }
function fmt(n) {
  if (n > 1024 * 1024) return (n / 1048576).toFixed(1) + "MB";
  if (n > 1024) return (n / 1024).toFixed(1) + "KB";
  return n + "B";
}
function ms(t) { return t >= 1000 ? (t / 1000).toFixed(1) + "s" : Math.round(t) + "ms"; }

async function renderReference(fileUrl, forceWhite) {
  const pool = getPool();
  return pool.execute(
    async (page) => {
      await page.setViewport({ width: WIDTH, height: HEIGHT, deviceScaleFactor: 1 });
      await page.goto(fileUrl, { waitUntil: "networkidle0", timeout: 60000 });
      await page.evaluate(() => document.fonts && document.fonts.ready);
      await new Promise((r) => setTimeout(r, 1000));
      if (forceWhite) {
        await page.evaluate(() => { document.body.style.backgroundColor = "#ffffff"; });
      }
      const h = await page.evaluate(() => Math.max(document.documentElement.scrollHeight, window.innerHeight));
      return page.screenshot({
        type: "png",
        clip: { x: 0, y: 0, width: WIDTH, height: Math.min(h, 30000) },
      });
    },
    { timeout: 180000, retries: 2 }
  );
}

async function main() {
  if (!process.env.CONVERT_SETCONTENT_TIMEOUT) process.env.CONVERT_SETCONTENT_TIMEOUT = String(180000);
  if (!process.env.CONVERT_TASK_TIMEOUT) process.env.CONVERT_TASK_TIMEOUT = String(600000);
  if (!process.env.CONVERT_MAX_HEIGHT) process.env.CONVERT_MAX_HEIGHT = String(30000);

  const only = process.argv.slice(2).length > 0 ? process.argv.slice(2) : null;
  const allFormats = ["png", "pdf", "svg", "psd", "xd", "figma", "clipboard", "inline", "figma-mcp", "figma-plugin", "figma-all"];
  const formats = only ? allFormats.filter((f) => only.includes(f)) : allFormats;

  const html = await fs.readFile(FIXTURE, "utf-8");
  const fileUrl = "file:///" + path.resolve(FIXTURE).replace(/\\/g, "/");
  await fs.ensureDir(OUT_DIR);

  const tStart = Date.now();
  console.log("Reference render (natural)…");
  const naturalRef = await renderReference(fileUrl, false);
  await fs.writeFile(path.join(OUT_DIR, "reference.natural.png"), naturalRef);
  console.log("Reference render (white)…");
  const whiteRef = await renderReference(fileUrl, true);
  await fs.writeFile(path.join(OUT_DIR, "reference.white.png"), whiteRef);
  console.log("  refs done (" + fmt(naturalRef.length) + " / " + fmt(whiteRef.length) + ")");

  const rows = [];
  for (const format of formats) {
    const opts = {
      width: WIDTH, height: HEIGHT, scale: 1, fullPage: true,
      pageName: "heavy", baseDir: path.join(__dirname, "fixtures"),
      maxHeight: 30000,
    };
    const t0 = Date.now();
    let buf = null, err = null;
    process.stdout.write("  " + pad(format, 12) + " ... ");
    try {
      buf = await convertTo(format, html, opts);
    } catch (e) {
      err = e.message || String(e);
    }
    const elapsed = Date.now() - t0;
    const ok = !err && !!buf && buf.length > 0;
    let valid = false, validDetail = "";
    if (ok) {
      const v = validateFormat(format, buf);
      valid = v.ok; validDetail = v.detail;
      await fs.writeFile(path.join(OUT_DIR, "heavy." + format + "." + EXT[format]), buf);
    }
    let acc = null;
    if (ok && format === "png") {
      try { acc = await compareBuffers(whiteRef, buf, {}); } catch (e) { acc = { error: e.message }; }
    }
    rows.push({ format, ok, valid, validDetail, elapsedMs: elapsed, size: ok ? buf.length : 0, error: err, accuracy: acc });
    process.stdout.write(
      (ok && valid ? "OK" : ok ? "BAD" : "ERR") + "  " + (ok ? fmt(buf.length) : "") + "  " + ms(elapsed) +
      (acc && acc.accuracyScore !== undefined ? "  acc=" + acc.accuracyScore + "%" : "") + "\n"
    );
    if (err) process.stdout.write("       error: " + err + "\n");
  }

  await shutdownPool();
  const report = {
    fixture: FIXTURE, lines: html.split("\n").length, sizeBytes: html.length,
    generated: new Date().toISOString(), totalMs: Date.now() - tStart, results: rows,
  };
  await fs.writeFile(path.join(OUT_DIR, "stress-report.json"), JSON.stringify(report, null, 2), "utf-8");
  const failed = rows.filter((r) => !r.ok || !r.valid).length;
  console.log("\nTotal: " + (rows.length - failed) + " ok / " + failed + " failed · " + ms(Date.now() - tStart));
  console.log("Report: " + path.join(OUT_DIR, "stress-report.json"));
}

main().catch((e) => { console.error("Stress run failed:", e); process.exit(1); });
