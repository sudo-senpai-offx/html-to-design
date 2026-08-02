var path = require("path");
var fs = require("fs-extra");
var { splitAndInlineHtml, DEFAULT_MAX_BYTES } = require("../lib/html-splitter");
var { inlineCssStyles, inlineExternalStylesheets } = require("../lib/css-inliner");
var { getTempPath, ensureTempDir, removeTempFile } = require("../lib/temp-dir");

var CHUNK_MAX_BYTES = require("../lib/config").getConfig("inline").maxBatchBytes;

async function convertToInlineHtml(html, options) {
  var jobId = options && options.jobId;
  var cssContent = (options && options.css) || "";
  var pageName = (options && options.pageName) || "HTML Export";

  await ensureTempDir();

  /* 1. Resolve <link> tags and inject externally-provided CSS */
  var baseDir = (options && options.baseDir) || path.resolve(__dirname, "..", "..");
  var processedHtml = inlineExternalStylesheets(html, { css: cssContent, baseDir: baseDir });

  console.log("  [Inline] Splitting and inlining CSS via juice...");

  /* 2. Split source HTML into ≤100KB chunks with juice-inlined styles */
  var chunks;
  try {
    chunks = splitAndInlineHtml(processedHtml, cssContent, CHUNK_MAX_BYTES);
  } catch (e) {
    console.error("  [Inline] splitAndInlineHtml failed:", e.message);
    /* Fallback: try Puppeteer computed-style inlining */
    console.log("  [Inline] Falling back to Puppeteer-based inlining...");
    return await fallbackToPuppeteer(html, options);
  }

  if (!chunks || chunks.length === 0) {
    console.error("  [Inline] No chunks produced, falling back to Puppeteer...");
    return await fallbackToPuppeteer(html, options);
  }

  console.log("  [Inline] Produced " + chunks.length + " chunk(s) via juice inlining");

  /* 3. Write chunks to shared-output directory */
  var projectRoot = path.resolve(__dirname, "..", "..");
  var sharedDir = path.join(projectRoot, "shared-output", "inline-" + (jobId || Date.now()));
  await fs.ensureDir(sharedDir);

  var batchesInfo = [];
  for (var ci = 0; ci < chunks.length; ci++) {
    var ch = chunks[ci];
    var fileName = "chunk-" + (ci + 1) + "-of-" + chunks.length + ".html";
    var filePath = path.join(sharedDir, fileName);
    await fs.writeFile(filePath, ch._html || ch.html, "utf-8");
    ch.filePath = filePath;
    ch.filename = fileName;
    ch.totalBatches = chunks.length;
    ch.sectionName = null;
    ch.yStart = 0;
    ch.yEnd = 0;
    ch.oversized = false;
    ch.oversizeBy = 0;
    batchesInfo.push({
      label: ch.label,
      index: ci,
      totalBatches: chunks.length,
      size: ch.size,
      elementCount: ch.elementCount || 0,
      filePath: filePath,
      filename: fileName,
      sectionName: null,
      oversized: false,
      oversizeBy: 0,
      yStart: 0,
      yEnd: 0,
      html: ci === 0 ? Buffer.from(ch._html || ch.html, "utf-8").toString("base64") : undefined,
    });
  }

  /* Write full combined HTML for convenience (body content of each chunk) */
  var chunkHead = "<!DOCTYPE html>\n<html lang=\"en\">\n<head>\n<meta charset=\"UTF-8\">\n<meta name=\"viewport\" content=\"width=device-width, initial-scale=1.0\">\n<style>\n/* Combined inline chunks from " + chunks.length + " chunk(s) */\n</style>\n</head>\n<body>\n";
  var chunkTail = "\n</body>\n</html>";
  var combinedHtml = chunkHead;
  for (var ci3 = 0; ci3 < chunks.length; ci3++) {
    var ch3 = chunks[ci3];
    combinedHtml += "<!-- Chunk " + (ci3 + 1) + "/" + chunks.length + " -->\n";
    combinedHtml += extractBodyContent(ch3._html || ch3.html);
  }
  combinedHtml += chunkTail;
  var combinedSize = Buffer.byteLength(combinedHtml, "utf-8");

  await fs.writeFile(path.join(sharedDir, "full-inlined.html"), combinedHtml, "utf-8");

  /* Build manifest */
  var manifestLines = [
    "=== INLINE HTML BATCHES ===",
    "Source: " + pageName,
    "Chunks: " + chunks.length,
    "Max Chunk Size: " + (CHUNK_MAX_BYTES / 1024) + "KB",
    "Generated: " + new Date().toISOString(),
    "",
  ];
  for (var mi = 0; mi < batchesInfo.length; mi++) {
    var b = batchesInfo[mi];
    manifestLines.push("Chunk " + (mi + 1) + "/" + batchesInfo.length + " — " + b.label + " — " + (b.size / 1024).toFixed(1) + "KB — " + b.filename);
  }
  var manifest = manifestLines.join("\n");
  await fs.writeFile(path.join(sharedDir, "_MANIFEST.txt"), manifest, "utf-8");

  console.log("  [Inline] Output: " + chunks.length + " chunks (" + combinedSize / 1024 + "KB total) — " + sharedDir);

  /* Build response as JSON (like figma-all) */
  var response = {
    metadata: {
      generated: new Date().toISOString(),
      chunkCount: chunks.length,
      chunkMaxSizeKB: CHUNK_MAX_BYTES / 1024,
      totalSizeKB: (combinedSize / 1024).toFixed(1),
      source: "juice-inlined",
      pageName: pageName,
    },
    batches: batchesInfo,
    batchManifest: manifest,
    batchesExportPath: sharedDir,
    html: Buffer.from(combinedHtml, "utf-8").toString("base64"),
  };

  return Buffer.from(JSON.stringify(response, null, 2), "utf-8");
}

function extractBodyContent(fullHtml) {
  var bodyMatch = fullHtml.match(/<body[^>]*>([\s\S]*)<\/body>/i);
  if (bodyMatch) return bodyMatch[1].trim();
  /* No body tag — assume it's a fragment */
  return fullHtml;
}

/* Fallback: Puppeteer-based computed-style inlining (original approach, kept for reliability) */
async function fallbackToPuppeteer(html, options) {
  var width = (options && options.width) || 1440;
  var scale = (options && options.scale) || 2;
  var cssContent = (options && options.css) || "";
  var jobId = options && options.jobId;

  var pool;
  try {
    pool = require("../lib/browser-pool").getPool();
  } catch (e) {
    throw new Error("Browser pool not available for fallback: " + e.message);
  }

  await ensureTempDir();
  var tempHtmlPath = getTempPath((jobId || "temp") + "-inline.html");
  await fs.writeFile(tempHtmlPath, html, "utf-8");

  try {
    console.log("  [Inline] Fallback: loading HTML in browser...");
    var result = await pool.execute(async (page) => {
      var fileUrl = "file:///" + path.resolve(tempHtmlPath).replace(/\\/g, "/");
      await page.setViewport({ width: width, height: 900, deviceScaleFactor: scale });
      await page.goto(fileUrl, { waitUntil: "networkidle0", timeout: 30000 });
      await page.evaluate(function() { return document.fonts && document.fonts.ready; });
      if (cssContent) {
        await page.addStyleTag({ content: cssContent });
        await new Promise(function(r) { setTimeout(r, 200); });
      }
      await new Promise(function(r) { setTimeout(r, 500); });

      console.log("  [Inline] Inlining computed styles...");
      var res = await page.evaluate(FALLBACK_INLINE_SCRIPT);
      return res;
    }, { timeout: 60000, retries: 2 });

    if (!result || !result.html) {
      throw new Error("Failed to inline CSS styles");
    }

    console.log("  [Inline] Fallback: inlined " + result.count + " elements, " + (result.html.length / 1024).toFixed(1) + "KB");
    return Buffer.from(result.html, "utf-8");
  } finally {
    await removeTempFile((jobId || "temp") + "-inline.html");
  }
}

var FALLBACK_INLINE_SCRIPT = `
(function() {
  var SKIP_TAGS = { "SCRIPT": 1, "STYLE": 1, "NOSCRIPT": 1, "LINK": 1, "META": 1, "TITLE": 1, "HEAD": 1 };
  var SKIP_PROPS = {
    "pointer-events": 1, "touch-action": 1, "will-change": 1, "contain": 1,
    "box-sizing": 1, "clear": 1, "float": 1, "cursor": 1,
    "orphans": 1, "widows": 1, "page-break-after": 1, "page-break-before": 1, "page-break-inside": 1,
  };
  var KEEP_PROPS = [
    "display", "position", "z-index",
    "top", "right", "bottom", "left", "inset",
    "width", "height", "min-width", "min-height", "max-width", "max-height",
    "margin-top", "margin-right", "margin-bottom", "margin-left",
    "padding-top", "padding-right", "padding-bottom", "padding-left",
    "border-top-width", "border-right-width", "border-bottom-width", "border-left-width",
    "border-top-color", "border-right-color", "border-bottom-color", "border-left-color",
    "border-top-style", "border-right-style", "border-bottom-style", "border-left-style",
    "border-top-left-radius", "border-top-right-radius",
    "border-bottom-right-radius", "border-bottom-left-radius",
    "background-color", "background", "background-image",
    "background-size", "background-position", "background-repeat",
    "color", "font-family", "font-size", "font-weight", "font-style",
    "line-height", "letter-spacing", "text-align", "text-decoration",
    "text-transform", "text-overflow", "white-space", "word-wrap", "word-break",
    "text-shadow", "text-indent", "vertical-align",
    "overflow", "overflow-x", "overflow-y",
    "opacity", "visibility",
    "box-shadow", "filter", "backdrop-filter",
    "flex-direction", "flex-wrap", "flex", "flex-basis", "flex-grow", "flex-shrink",
    "justify-content", "align-items", "align-self", "align-content",
    "gap", "column-gap", "row-gap",
    "grid-template-columns", "grid-template-rows",
    "grid-column-gap", "grid-row-gap",
    "grid-auto-flow", "grid-auto-columns", "grid-auto-rows",
    "grid-column-start", "grid-column-end", "grid-row-start", "grid-row-end",
    "object-fit", "object-position",
    "list-style-type", "list-style-position",
    "border-collapse", "border-spacing",
    "table-layout", "empty-cells",
    "writing-mode", "direction",
    "content", "outline-width", "outline-color", "outline-style", "outline-offset",
    "transform", "transform-origin",
  ];

  var MAX_ELEMENTS = 25000;
  var MAX_DEPTH = 80;
  var count = 0;
  function inline(el, depth) {
    if (!depth) depth = 0;
    if (!el || depth > MAX_DEPTH || el.nodeType !== 1) return;
    if (count >= MAX_ELEMENTS) return;
    var tag = el.tagName.toUpperCase();
    if (SKIP_TAGS[tag]) return;
    var cs = window.getComputedStyle(el);
    var parts = [];
    for (var i = 0; i < KEEP_PROPS.length; i++) {
      var prop = KEEP_PROPS[i];
      if (SKIP_PROPS[prop]) continue;
      var val = cs.getPropertyValue(prop);
      if (!val) continue;
      if (prop === "display" && val === "block") continue;
      if (prop === "visibility" && val === "visible") continue;
      if (prop === "opacity" && val === "1") continue;
      if (prop === "overflow" && val === "visible") continue;
      if (prop === "position" && val === "static") continue;
      if (prop === "z-index" && val === "auto") continue;
      if (prop === "color" && val === "rgb(0, 0, 0)") continue;
      if (prop === "line-height" && val === "normal") continue;
      if (prop === "letter-spacing" && val === "normal") continue;
      if (prop === "word-spacing" && val === "normal") continue;
      if (prop === "text-transform" && val === "none") continue;
      if (prop === "text-decoration" && (val === "none" || val === "none solid rgb(0, 0, 0)")) continue;
      if (prop === "text-shadow" && val === "none") continue;
      if (prop === "box-shadow" && val === "none") continue;
      if (prop === "filter" && val === "none") continue;
      if (prop === "backdrop-filter" && val === "none") continue;
      if (prop === "transform" && val === "none") continue;
      if (prop === "flex-basis" && val === "auto") continue;
      if (prop === "flex-grow" && val === "0") continue;
      if (prop === "flex-shrink" && val === "1") continue;
      if (prop === "flex-wrap" && val === "nowrap") continue;
      if (prop === "justify-content" && val === "flex-start") continue;
      if (prop === "align-items" && val === "stretch") continue;
      if (prop === "gap" && val === "0px") continue;
      if (prop === "column-gap" && val === "0px") continue;
      if (prop === "row-gap" && val === "0px") continue;
      if (prop === "object-fit" && val === "fill") continue;
      if (prop === "border-collapse" && val === "separate") continue;
      if (prop === "direction" && val === "ltr") continue;
      if (prop === "writing-mode" && val === "horizontal-tb") continue;
      if (prop === "list-style-type" && val === "disc") continue;
      if (prop === "content" && val === "normal") continue;
      if (prop === "outline-width" && val === "0px") continue;
      if (prop.includes("-color") && (val === "rgb(0, 0, 0)" || val === "rgba(0, 0, 0, 0)")) continue;
      if (prop.includes("-style") && val === "none") continue;
      if (prop.includes("-style") && val === "solid") continue;
      if (prop.includes("-width") && val === "0px") continue;
      parts.push(prop + ": " + val + ";");
    }
    if (parts.length > 0) {
      el.setAttribute("style", parts.join(" "));
      count++;
    }
    for (var j = 0; j < el.children.length; j++) {
      inline(el.children[j], depth + 1);
    }
  }
  inline(document.body, 0);
  var styles = document.querySelectorAll("style");
  for (var s = 0; s < styles.length; s++) { styles[s].parentNode.removeChild(styles[s]); }
  var links = document.querySelectorAll('link[rel="stylesheet"]');
  for (var l = 0; l < links.length; l++) { links[l].parentNode.removeChild(links[l]); }
  return { count: count, html: document.documentElement.outerHTML };
})();
`;

module.exports = { convertToInlineHtml };
