const fs = require("fs-extra");
const { extractFullDOM } = require("../lib/dom-extractor");
const { buildTree } = require("../lib/tree-builder");
const { buildInlinedHtml, buildConnectorInlinedHtml } = require("../lib/clipboard-writer");
const { getConnector } = require("../lib/figma-connector");
const { extractDesignSystem } = require("../lib/design-system-extractor");
const { getTempPath, ensureTempDir, removeTempFile } = require("../lib/temp-dir");

async function convertToPluginRun(html, options) {
  var width = (options && options.width) || 1440;
  var height = (options && options.height) || 900;
  var scale = (options && options.scale) || 2;
  var jobId = options && options.jobId;
  var pageName = (options && options.pageName) || "HTML Export";
  var autoRun = options && options.autoRun;

  await ensureTempDir();
  var tempHtmlPath = getTempPath((jobId || "temp") + ".html");
  await fs.writeFile(tempHtmlPath, html, "utf-8");

  try {
    console.log("  [FigmaPlugin] Extracting DOM...");
    var result = await extractFullDOM(tempHtmlPath, { width: width, scale: scale, css: (options && options.css) || "" });
    var flatElements = result.flatElements;
    var pageWidth = result.pageWidth;
    var pageHeight = result.pageHeight;

    if (!flatElements || flatElements.length === 0) {
      throw new Error("Failed to extract DOM elements from HTML");
    }

    console.log("  [FigmaPlugin] Extracted " + flatElements.length + " elements");
    console.log("  [FigmaPlugin] Building visual hierarchy...");
    var tree = buildTree(flatElements, pageWidth, pageHeight);

    console.log("  [FigmaPlugin] Building inlined HTML...");
    var inlinedHtml = buildInlinedHtml(flatElements, tree);

    var figmaResult = null;
    if (autoRun) {
      console.log("  [FigmaPlugin] Queuing Figma render (fire-and-forget)...");
      figmaResult = { success: true, message: "Render queued (" + flatElements.length + " nodes)", queued: true };

      (async function() {
        try {
          var connector = getConnector();
          var status = await connector.getStatus();

          if (!status.running) {
            console.log("  [FigmaPlugin] Starting connector...");
            var started = await connector.start();
            if (!started) {
              console.error("  [FigmaPlugin] Could not start Figma connector");
              return;
            }
            status = await connector.getStatus();
          }

          if (!status.figmaConnected) {
            console.error("  [FigmaPlugin] Figma not connected (mode=" + status.mode + "). Open the html.to.design (local) or mcp.to.design (remote) plugin in Figma.");
            return;
          }

          console.log("  [FigmaPlugin] Extracting design system from HTML...");
          var designSystem = extractDesignSystem(html);
          designSystem.name = pageName + " Design System";
          console.log("  [FigmaPlugin] Design system: " + designSystem.colors.length + " colors, " + designSystem.typography.length + " typography, " + designSystem.spacing.length + " spacing");

          try {
            await connector.proposeDesignSystem(designSystem);
            console.log("  [FigmaPlugin] Design system proposed — waiting 3s for user confirmation...");
            await new Promise(function(resolve) { setTimeout(resolve, 3000); });
          } catch (e) {
            console.error("  [FigmaPlugin] Design system proposal failed (continuing):", e.message);
          }

          try {
            console.log("  [FigmaPlugin] Sending structured chunks (computed-style, " + flatElements.length + " elements)");
          } catch (e) {}
          await connector.renderHtml(inlinedHtml, pageName, {
            designSystem: true,
            flatElements: flatElements,
            tree: tree,
          });
          console.log("  [FigmaPlugin] Sent to Figma successfully");
        } catch (e) {
          console.error("  [FigmaPlugin] Background render failed:", e.message);
        }
      })();
    }

    var output = JSON.stringify({
      inlinedHtml: inlinedHtml,
      figmaResult: figmaResult,
      metadata: {
        sourceWidth: pageWidth,
        sourceHeight: pageHeight,
        elementCount: flatElements.length,
        pageName: pageName,
        autoRun: !!autoRun,
      },
    }, null, 2);

    console.log("  [FigmaPlugin] Output: " + (output.length / 1024).toFixed(1) + "KB");
    return Buffer.from(output, "utf-8");
  } finally {
    await removeTempFile((jobId || "temp") + ".html");
  }
}

module.exports = { convertToPluginRun };
