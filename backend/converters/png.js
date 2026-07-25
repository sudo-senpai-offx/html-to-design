const { getPool } = require("../lib/browser-pool");

async function convertToPng(html, options) {
  var { width = 1440, height = 900, scale = 2 } = options;
  var pool = getPool();

  return pool.execute(async (page) => {
    await page.setViewport({ width, height, deviceScaleFactor: scale });
    await page.setContent(html, { waitUntil: "networkidle2", timeout: 30000 });
    await page.evaluate(() => document.fonts && document.fonts.ready);
    await new Promise((r) => setTimeout(r, 500));

    return page.screenshot({
      type: "png",
      fullPage: true,
      omitBackground: false,
    });
  }, { timeout: 60000, retries: 3 });
}

module.exports = { convertToPng };
