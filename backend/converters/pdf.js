const { getPool } = require("../lib/browser-pool");

async function convertToPdf(html, options) {
  var { width = 1440, height = 900, scale = 2, format = "A4" } = options;
  var pool = getPool();

  return pool.execute(async (page) => {
    await page.setViewport({ width, height, deviceScaleFactor: scale });
    await page.setContent(html, { waitUntil: "networkidle2", timeout: 30000 });
    await page.evaluate(() => document.fonts && document.fonts.ready);
    await new Promise((r) => setTimeout(r, 500));

    return page.pdf({
      format: format,
      printBackground: true,
      margin: { top: "0", right: "0", bottom: "0", left: "0" },
    });
  }, { timeout: 60000, retries: 3 });
}

module.exports = { convertToPdf };
