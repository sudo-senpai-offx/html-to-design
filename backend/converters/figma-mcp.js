const fs = require("fs-extra");
const { extractFullDOM } = require("../lib/dom-extractor");
const { buildTree } = require("../lib/tree-builder");
const { convertToFigmaPluginCode } = require("../lib/figma-mcp");
const { getTempPath, ensureTempDir, removeTempFile } = require("../lib/temp-dir");

async function convertToFigmaMcp(html, options) {
  var width = (options && options.width) || 1440;
  var height = (options && options.height) || 900;
  var scale = (options && options.scale) || 2;
  var jobId = options && options.jobId;
  var pageName = (options && options.pageName) || "HTML Export";

  await ensureTempDir();
  var tempHtmlPath = getTempPath((jobId || "temp") + ".html");
  await fs.writeFile(tempHtmlPath, html, "utf-8");

  try {
    console.log("  [MCP] Extracting DOM...");
    var result = await extractFullDOM(tempHtmlPath, { width: width, scale: scale, css: (options && options.css) || "" });
    var flatElements = result.flatElements;
    var pageWidth = result.pageWidth;
    var pageHeight = result.pageHeight;

    if (!flatElements || flatElements.length === 0) {
      throw new Error("Failed to extract DOM elements from HTML");
    }

    console.log("  [MCP] Extracted " + flatElements.length + " elements");
    console.log("  [MCP] Building visual hierarchy...");
    var tree = buildTree(flatElements, pageWidth, pageHeight);

    console.log("  [MCP] Generating Figma Plugin API code...");
    var result = convertToFigmaPluginCode(flatElements, tree, pageWidth, pageHeight, {
      pageName: pageName,
    });

    var output = JSON.stringify({
      script: result.script,
      description: result.description,
      usage: result.usage,
      metadata: {
        sourceWidth: pageWidth,
        sourceHeight: pageHeight,
        elementCount: flatElements.length,
        pageName: pageName,
      },
    }, null, 2);

    console.log("  [MCP] Output: " + (output.length / 1024).toFixed(1) + "KB");
    return Buffer.from(output, "utf-8");
  } finally {
    await removeTempFile((jobId || "temp") + ".html");
  }
}

module.exports = { convertToFigmaMcp };
