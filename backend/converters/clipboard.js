const fs = require("fs-extra");
const { extractFullDOM } = require("../lib/dom-extractor");
const { buildTree } = require("../lib/tree-builder");
const { convertToClipboard } = require("../lib/clipboard-writer");
const { getTempPath, ensureTempDir, removeTempFile } = require("../lib/temp-dir");
const { writeHtmlToClipboard } = require("../lib/clipboard-system");

async function convertToClipboardFormat(html, options) {
  var width = (options && options.width) || 1440;
  var height = (options && options.height) || 900;
  var scale = (options && options.scale) || 2;
  var jobId = options && options.jobId;
  var pageName = (options && options.pageName) || "HTML Export";

  await ensureTempDir();
  var tempHtmlPath = getTempPath((jobId || "temp") + ".html");
  await fs.writeFile(tempHtmlPath, html, "utf-8");

  try {
    console.log("  [Clipboard] Extracting DOM (flat)...");
    var result = await extractFullDOM(tempHtmlPath, { width: width, scale: scale, css: (options && options.css) || "" });
    var flatElements = result.flatElements;
    var pageWidth = result.pageWidth;
    var pageHeight = result.pageHeight;

    if (!flatElements || flatElements.length === 0) {
      throw new Error("Failed to extract DOM elements from HTML");
    }

    console.log("  [Clipboard] Extracted " + flatElements.length + " elements");
    console.log("  [Clipboard] Building visual hierarchy...");
    var tree = buildTree(flatElements, pageWidth, pageHeight);

    console.log("  [Clipboard] Generating fig-kiwi clipboard HTML...");
    var clipboardHtml = await convertToClipboard(flatElements, tree, pageWidth, pageHeight, {
      pageName: pageName,
    });

    if (!clipboardHtml || clipboardHtml.length === 0) {
      throw new Error("Generated clipboard HTML is empty");
    }

    console.log("  [Clipboard] Output: " + (clipboardHtml.length / 1024).toFixed(1) + "KB");

    if (options && options.writeClipboard) {
      var written = await writeHtmlToClipboard(clipboardHtml);
      if (written) console.log("  [Clipboard] Pastable in Figma (Ctrl+V)");
    }

    return Buffer.from(clipboardHtml, "utf-8");
  } finally {
    await removeTempFile((jobId || "temp") + ".html");
  }
}

module.exports = { convertToClipboardFormat };
