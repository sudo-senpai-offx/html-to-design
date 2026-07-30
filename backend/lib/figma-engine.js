var fs = require("fs-extra");
var { extractFullDOM } = require("./dom-extractor");
var { buildTree } = require("./tree-builder");
var { buildDocument } = require("./figma-builder");
var { writeFigBuffer } = require("./fig-writer");
var { buildInlinedHtml } = require("./clipboard-writer");
var { buildEnhancedHtml, diagnoseStyleLoss } = require("./inline-enhancer");
var path = require("path");
var { buildBatches, serializeBatchesManifest, DEFAULT_MAX_BYTES, MAX_ELEMENTS_PER_PAGE } = require("./html-batcher");
var { AssetManager } = require("./asset-manager");
var { extractDesignSystem } = require("./design-system-extractor");
var { getTempPath, ensureTempDir, removeTempFile } = require("./temp-dir");
var { assessTierOutput, pickBestTier, generateSummary } = require("./quality-reporter");
var { inlineExternalStylesheets } = require("./css-inliner");
var { convertToFigmaPluginCode } = require("./figma-mcp");

var METHODS = [
  { id: "figma-plugin", name: "Figma Plugin (Open-Source)", quality: 95, icon: "figma" },
  { id: "fig-file", name: ".fig File", quality: 80, icon: "download" },
];

async function convertUnified(html, options) {
  var width = (options && options.width) || 1440;
  var height = (options && options.height) || 900;
  var scale = (options && options.scale) || 2;
  var jobId = options && options.jobId;
  var pageName = (options && options.pageName) || "HTML Export";

  await ensureTempDir();

  /* Pre-process HTML: inline external CSS before Puppeteer extraction */
  var cssOption = (options && options.css) || "";
  var baseDir = (options && options.baseDir) || path.resolve(__dirname, "..", "..");
  var processedHtml = inlineExternalStylesheets(html, { css: cssOption, baseDir: baseDir });
  if (processedHtml !== html) {
    console.log("  [FigmaEngine] CSS inlined: " + ((processedHtml.length - html.length) / 1024).toFixed(1) + "KB added");
  }

  var tempHtmlPath = getTempPath((jobId || "temp") + ".html");
  await fs.writeFile(tempHtmlPath, processedHtml, "utf-8");

  try {
    console.log("  [FigmaEngine] Extracting DOM once...");
    var result = await extractFullDOM(tempHtmlPath, { width: width, scale: scale, css: cssOption });
    var flatElements = result.flatElements;
    var pageWidth = result.pageWidth;
    var pageHeight = result.pageHeight;
    var rasterizedSvgs = result.rasterizedSvgs || [];

    if (!flatElements || flatElements.length === 0) {
      throw new Error("Failed to extract DOM elements from HTML");
    }

    /* Enforce element cap for OOM safety */
    if (flatElements.length > MAX_ELEMENTS_PER_PAGE) {
      console.log("  [FigmaEngine] WARNING: " + flatElements.length + " elements exceeds cap of " + MAX_ELEMENTS_PER_PAGE + " — truncating");
      flatElements = flatElements.slice(0, MAX_ELEMENTS_PER_PAGE);
    }

    console.log("  [FigmaEngine] Extracted " + flatElements.length + " elements");
    console.log("  [FigmaEngine] Building visual hierarchy...");
    var tree = buildTree(flatElements, pageWidth, pageHeight);

    var methodResults = {};
    var allErrors = [];

    var inlinedHtml = null;
    var enhancedHtml = null;
    var styleDiagnosis = null;
    var batches = null;
    var batchManifest = null;

    try {
      inlinedHtml = buildInlinedHtml(flatElements, tree);
      console.log("  [FigmaEngine] Inlined HTML: " + (inlinedHtml ? (inlinedHtml.length / 1024).toFixed(1) + "KB" : "failed"));
    } catch (e) {
      console.error("  [FigmaEngine] Inlined HTML failed:", e.message);
      allErrors.push({ method: "html", error: e.message });
    }

    /* Free flatElements after tree built and quality reports — save essentials first */
    var elementCount = flatElements.length;
    var sampleProps = flatElements[Math.min(5, flatElements.length - 1)].props || {};
    /* flatElements freed after quality_report uses it (line ~130) */

    try {
      enhancedHtml = buildEnhancedHtml(null, tree);
      console.log("  [FigmaEngine] Enhanced inline HTML: " + (enhancedHtml ? (enhancedHtml.length / 1024).toFixed(1) + "KB" : "failed"));

      styleDiagnosis = diagnoseStyleLoss(sampleProps);
      if (styleDiagnosis && styleDiagnosis.lost && styleDiagnosis.lost.length > 0) {
        console.log("  [FigmaEngine] Style diagnosis: " + styleDiagnosis.lost.length + " props dropped (first: " + styleDiagnosis.lost[0].prop + "=" + styleDiagnosis.lost[0].reason + ")");
      }

      /* Stream batches to disk during buildBatches via writeBatch callback */
      var projectRoot = path.resolve(__dirname, "..", "..");
      var sharedDir = path.join(projectRoot, "shared-output", "batches-" + (jobId || Date.now()));
      await fs.ensureDir(sharedDir);

      /* Collect write promises so we can await them all after buildBatches */
      var writePromises = [];
      var writeBatchFn = function(idx, label, filename, html) {
        var p = fs.writeFile(path.join(sharedDir, filename), html, "utf-8");
        writePromises.push(p);
        p.catch(function(err) {
          console.error("[FigmaEngine] Batch write error for " + filename + ":", err.message);
        });
      };

      batches = buildBatches(tree, 100 * 1024, "Chunk", { writeBatch: writeBatchFn });

      /* Await all batch writes that completed during buildBatches */
      await Promise.all(writePromises);
      writePromises = [];

      /* Set filePath on each batch and write any remaining batches */
      for (var bi = 0; bi < batches.length; bi++) {
        var b = batches[bi];
        var fileName = b.filename || ("chunk-" + (bi + 1) + "-of-" + batches.length + ".html");
        b.filePath = path.join(sharedDir, fileName);
        if (b._html && !b._written) {
          await fs.writeFile(b.filePath, b._html, "utf-8");
          b._written = true;
        }
      }
      batchManifest = serializeBatchesManifest(batches, pageName);
      await fs.writeFile(path.join(sharedDir, "_MANIFEST.txt"), batchManifest, "utf-8");
      if (enhancedHtml) {
        await fs.writeFile(path.join(sharedDir, "full-inlined.html"), enhancedHtml, "utf-8");
        enhancedHtml = null;
      }
      console.log("  [FigmaEngine] Batches exported to: " + sharedDir);
    } catch (e) {
      console.error("  [FigmaEngine] Enhanced HTML / batching failed:", e.message);
      allErrors.push({ method: "enhanced-html", error: e.message });
    }

    var designSystem = null;
    try {
      designSystem = extractDesignSystem(html, inlinedHtml);
      console.log("  [FigmaEngine] Design system: " + designSystem.colors.length + " colors, " + designSystem.typography.length + " typography");
    } catch (e) {
      console.error("  [FigmaEngine] Design system failed:", e.message);
    }

    var genPromises = [];
    genPromises.push(_genFigFile(tree, pageWidth, pageHeight, pageName, rasterizedSvgs, methodResults, allErrors));
    genPromises.push(_genFigmaPlugin(tree, pageWidth, pageHeight, pageName, methodResults, allErrors));

    await Promise.all(genPromises);

    var qualityReports = {};
    var totalFixes = 0;

    if (methodResults["fig-file"] && methodResults["fig-file"].status === "ready") {
      try {
        var figOutput = { tree: tree, pageWidth: pageWidth, pageHeight: pageHeight };
        var r = assessTierOutput("fig-file", figOutput, html, flatElements, { defaultBackground: "#ffffff", designTokens: designSystem });
        qualityReports["fig-file"] = r;
        if (r.fixes) totalFixes += r.fixes.applied || 0;
        if (r.qualityScore !== undefined) {
          methodResults["fig-file"].qualityScore = r.qualityScore;
          methodResults["fig-file"].verdict = r.verdict;
          methodResults["fig-file"].fixesApplied = (r.fixes && r.fixes.applied) || 0;
          methodResults["fig-file"].issues = r.issues;
        }
      } catch (e) { console.log("  [FigmaEngine] fig-file quality check skipped:", e.message); }
    }

    if (methodResults["figma-plugin"] && methodResults["figma-plugin"].status === "ready") {
      try {
        var mcpOutput = { script: methodResults["figma-plugin"].script, tree: tree };
        var r = assessTierOutput("figma-plugin", mcpOutput, html, flatElements, { defaultBackground: "#ffffff", designTokens: designSystem });
        qualityReports["figma-plugin"] = r;
        if (r.fixes) totalFixes += r.fixes.applied || 0;
        if (r.qualityScore !== undefined) {
          methodResults["figma-plugin"].qualityScore = r.qualityScore;
          methodResults["figma-plugin"].verdict = r.verdict;
          methodResults["figma-plugin"].fixesApplied = (r.fixes && r.fixes.applied) || 0;
          methodResults["figma-plugin"].issues = r.issues;
        }
      } catch (e) { console.log("  [FigmaEngine] figma-plugin quality check skipped:", e.message); }
    }

    /* Free flatElements — no longer needed after quality reporting */
    flatElements = null;

    var qualitySummary = generateSummary(qualityReports);
    var bestMethod = pickBestTier(qualityReports);

    /* If no method had quality scoring, pick from available ready methods */
    if (!bestMethod) {
      var readyMethods = [];
      for (var mk in methodResults) {
        if (methodResults[mk] && methodResults[mk].status === "ready") {
          readyMethods.push({ id: mk, quality: methodResults[mk].quality || 0 });
        }
      }
      readyMethods.sort(function(a, b) { return b.quality - a.quality; });
      bestMethod = readyMethods[0] || null;
    }

    if (totalFixes > 0) {
      console.log("  [FigmaEngine] Post-processing: " + totalFixes + " auto-fixes applied");
    }

    var pluginHtml = inlinedHtml || buildMinimalHtml(html);
    var pluginHtmlBase64 = pluginHtml ? Buffer.from(pluginHtml, "utf-8").toString("base64") : null;
    /* Free raw HTML strings — keep only base64 for response */
    pluginHtml = null;
    if (inlinedHtml) { inlinedHtml = null; }

    var batchesInfo = null;
    if (batches && batches.length > 0) {
      batchesInfo = [];
      for (var bi2 = 0; bi2 < batches.length; bi2++) {
        var b2 = batches[bi2];
        /* Use cached _html from batcher — no re-serialization */
        var batchEntry = {
          label: b2.label,
          index: b2.index,
          totalBatches: b2.totalBatches,
          size: b2.size,
          elementCount: b2.elementCount,
          oversized: !!b2.oversized,
          oversizeBy: b2.oversizeBy || 0,
          filePath: b2.filePath || null,
          filename: b2.filename || null,
          sectionName: b2.sectionName || null,
          yStart: b2.yStart,
          yEnd: b2.yEnd,
        };
        /* Include base64 HTML for all batches so frontend can render without extra fetches */
        if (b2._html) {
          batchEntry.html = Buffer.from(b2._html, "utf-8").toString("base64");
        }
        batchesInfo.push(batchEntry);
      }
    }

    var response = {
      metadata: {
        sourceWidth: pageWidth,
        sourceHeight: pageHeight,
        elementCount: elementCount,
        pageName: pageName,
        generated: new Date().toISOString(),
        fixesApplied: totalFixes,
        pluginVersion: "1.0.0",
        stylePropsExtracted: "all-computed",
        batchCount: batches ? batches.length : 0,
        batchMaxSizeKB: 100,
      },
      methods: methodResults,
      bestMethod: bestMethod && bestMethod.tierId ? { id: bestMethod.tierId, quality: bestMethod.score } : (bestMethod ? { id: bestMethod.id, quality: bestMethod.quality } : null),
      pluginHtml: pluginHtmlBase64,
      batchesExportPath: batches && batches.length > 0 && batches[0].filePath ? path.dirname(batches[0].filePath) : null,
      batches: batchesInfo,
      batchManifest: batchManifest,
      styleDiagnosis: styleDiagnosis,
      designSystem: designSystem,
      qualityReports: qualityReports,
      qualitySummary: qualitySummary,
      errors: allErrors,
    };
    /* Free remaining large references before serialization */
    qualityReports = null;
    designSystem = null;

    var outputBuffer = Buffer.from(JSON.stringify(response), "utf-8");
    console.log("  [FigmaEngine] Total: " + (outputBuffer.length / 1024).toFixed(1) + "KB");
    if (qualitySummary) console.log("  [FigmaEngine] Quality:\n" + qualitySummary);
    return outputBuffer;
  } catch (e) {
    console.error("  [FigmaEngine] Conversion failed:", e.message);
    console.error(e.stack);
    throw e;
  } finally {
    await removeTempFile((jobId || "temp") + ".html");
  }
}

function buildMinimalHtml(src) {
  var s = '<meta charset="utf-8"><div style="display:flex;flex-direction:column;width:100%;min-height:100vh;background-color:#ffffff;padding:20px;font-family:Inter,sans-serif;color:#1a1a1a">';
  s += "<p>Raw HTML used — style extraction requires Puppeteer rendering</p>";
  s += "</div>";
  return s;
}

async function _genFigFile(tree, pageWidth, pageHeight, pageName, rasterizedSvgs, methodResults, allErrors) {
  try {
    var assetManager = new AssetManager();
    var graph = await buildDocument(tree, pageWidth, pageHeight, pageName, assetManager, rasterizedSvgs);
    if (!graph || !graph.nodes || graph.nodes.size === 0) {
      methodResults["fig-file"] = { status: "failed", reason: "Empty document graph" };
      return;
    }
    var figBuffer = await writeFigBuffer(graph);
    if (!figBuffer || figBuffer.length === 0) {
      methodResults["fig-file"] = { status: "failed", reason: "Empty .fig buffer" };
      return;
    }

    methodResults["fig-file"] = {
      status: "ready",
      quality: 80,
      label: ".fig File",
      description: "Download and open in Figma or Penpot",
      data: figBuffer.toString("base64"),
      encoding: "base64",
      size: figBuffer.length,
      instructions: [
        "Download the .fig file",
        "Open Figma → File → Open → select the .fig file",
        "The design appears as native Figma layers",
      ],
      tips: [
        ".fig files work offline and don't require any plugins",
        "Also compatible with Penpot (penpot.app)",
      ],
      downloadSuffix: ".fig",
    };
    graph = null;
    console.log("  [FigmaEngine] .fig file: " + (figBuffer.length / 1024).toFixed(1) + "KB");
  } catch (e) {
    console.error("  [FigmaEngine] .fig failed:", e.message);
    methodResults["fig-file"] = { status: "failed", reason: e.message };
    allErrors.push({ format: "fig", error: e.message });
  }
}

async function _genFigmaPlugin(tree, pageWidth, pageHeight, pageName, methodResults, allErrors) {
  try {
    if (!tree || !tree.element) {
      methodResults["figma-plugin"] = { status: "failed", reason: "Empty tree" };
      return;
    }
    /* Build flat elements list from tree for the plugin code generator */
    var flatEls = [];
    function flattenTree(node) {
      if (!node || !node.element) return;
      flatEls.push(node.element);
      if (node.children) {
        for (var ci = 0; ci < node.children.length; ci++) {
          flattenTree(node.children[ci]);
        }
      }
    }
    flattenTree(tree);

    var result = convertToFigmaPluginCode(flatEls, tree, pageWidth, pageHeight, {
      pageName: pageName,
    });

    if (!result || !result.script) {
      methodResults["figma-plugin"] = { status: "failed", reason: "Empty plugin script" };
      return;
    }

    methodResults["figma-plugin"] = {
      status: "ready",
      quality: 95,
      label: "Figma Plugin Code",
      description: "Figma Plugin API script — paste into Figma Dev Console or use with MCP",
      data: Buffer.from(result.script, "utf-8").toString("base64"),
      encoding: "base64",
      script: result.script,
      size: Buffer.byteLength(result.script, "utf-8"),
      instructions: [
        "Open Figma Dev Console (Ctrl+Shift+J)",
        "Paste the script and press Enter",
        "The design is created as native Figma layers",
      ],
      tips: [
        "Works with any Figma file — no plugin installation needed",
        "Also compatible with MCP use_figma tool",
      ],
      downloadSuffix: ".js",
    };
    console.log("  [FigmaEngine] Figma Plugin code: " + (methodResults["figma-plugin"].size / 1024).toFixed(1) + "KB");
  } catch (e) {
    console.error("  [FigmaEngine] figma-plugin failed:", e.message);
    methodResults["figma-plugin"] = { status: "failed", reason: e.message };
    allErrors.push({ format: "figma-plugin", error: e.message });
  }
}

module.exports = {
  convertUnified: convertUnified,
  METHODS: METHODS,
};
