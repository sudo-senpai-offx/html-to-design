const path = require("path");
const fs = require("fs-extra");
const { extractFullDOM } = require("../lib/dom-extractor");
const { buildTree } = require("../lib/tree-builder");
const { buildDocument } = require("../lib/figma-builder");
const { writeFigBuffer } = require("../lib/fig-writer");
const { AssetManager } = require("../lib/asset-manager");

async function convertToFigma(html, options) {
  const { width = 1440, height = 900, scale = 2, jobId } = options;

  const tempHtmlPath = path.join(__dirname, "../temp", `${jobId || "temp"}.html`);
  await fs.ensureDir(path.dirname(tempHtmlPath));
  await fs.writeFile(tempHtmlPath, html, "utf-8");

  try {
    console.log(`  Extracting DOM (flat)...`);
    const { flatElements, pageWidth, pageHeight, rasterizedSvgs } = await extractFullDOM(tempHtmlPath, {
      width,
      scale,
    });

    if (!flatElements || flatElements.length === 0) {
      throw new Error("Failed to extract DOM elements from HTML");
    }

    console.log(`  Extracted ${flatElements.length} elements`);
    console.log(`  Building visual hierarchy (rectangle containment)...`);
    const tree = buildTree(flatElements, pageWidth, pageHeight);

    console.log(`  Building Figma nodes...`);
    const assetManager = new AssetManager();
    const graph = await buildDocument(tree, pageWidth, pageHeight, "HTML Export", assetManager, rasterizedSvgs);

    if (!graph || !graph.nodes || graph.nodes.size === 0) {
      throw new Error("Failed to build Figma document structure");
    }

    console.log(`  Serializing .fig file...`);
    const figBuffer = await writeFigBuffer(graph);

    if (!figBuffer || figBuffer.length === 0) {
      throw new Error("Generated .fig file is empty");
    }

    console.log(`  .fig file: ${(figBuffer.length / 1024).toFixed(1)}KB`);
    return figBuffer;
  } finally {
    await fs.remove(tempHtmlPath).catch(() => {});
  }
}

module.exports = { convertToFigma };
