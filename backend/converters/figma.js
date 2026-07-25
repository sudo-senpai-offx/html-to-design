const path = require("path");
const fs = require("fs-extra");
const { extractFullDOM } = require("../lib/dom-extractor");
const { buildDocument } = require("../lib/figma-builder");
const { writeFigBuffer } = require("../lib/fig-writer");
const { AssetManager } = require("../lib/asset-manager");

async function convertToFigma(html, options) {
  const { width = 1440, height = 900, scale = 2, jobId } = options;

  const tempHtmlPath = path.join(__dirname, "../temp", `${jobId || "temp"}.html`);
  await fs.ensureDir(path.dirname(tempHtmlPath));
  await fs.writeFile(tempHtmlPath, html, "utf-8");

  try {
    console.log(`  Extracting DOM...`);
    const { domTree, pageWidth, pageHeight, rasterizedSvgs } = await extractFullDOM(tempHtmlPath, {
      width,
      scale,
    });

    console.log(`  Building Figma nodes...`);
    const assetManager = new AssetManager();
    const doc = buildDocument(domTree, pageWidth, pageHeight, "HTML Export", assetManager, rasterizedSvgs);

    console.log(`  Serializing .fig file...`);
    const figBuffer = await writeFigBuffer(doc);

    return figBuffer;
  } finally {
    await fs.remove(tempHtmlPath).catch(() => {});
  }
}

module.exports = { convertToFigma };
