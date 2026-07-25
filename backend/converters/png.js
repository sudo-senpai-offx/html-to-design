const { getPool } = require("../lib/browser-pool");

async function convertToPng(html, options) {
  var { width = 1440, height = 900, scale = 2 } = options;
  var pool = getPool();

  return pool.execute(async (page) => {
    await page.setViewport({ width, height, deviceScaleFactor: scale });
    await page.setContent(html, { waitUntil: "networkidle2", timeout: 30000 });
    await page.evaluate(() => document.fonts && document.fonts.ready);
    await new Promise((r) => setTimeout(r, 500));

    await page.evaluate(() => {
      return new Promise((resolve) => {
        const images = document.querySelectorAll("img");
        let loaded = 0;
        const total = images.length;
        if (total === 0) return resolve();
        images.forEach((img) => {
          if (img.complete) {
            loaded++;
            if (loaded === total) resolve();
          } else {
            img.onload = () => {
              loaded++;
              if (loaded === total) resolve();
            };
            img.onerror = () => {
              loaded++;
              if (loaded === total) resolve();
            };
          }
        });
        setTimeout(resolve, 3000);
      });
    });

    const scrollHeight = await page.evaluate(() => document.documentElement.scrollHeight);
    const viewportHeight = await page.evaluate(() => window.innerHeight);
    const fullHeight = Math.max(scrollHeight, viewportHeight, height);

    return page.screenshot({
      type: "png",
      fullPage: true,
      omitBackground: false,
      clip: { x: 0, y: 0, width: width, height: Math.min(fullHeight, 16384) },
    });
  }, { timeout: 60000, retries: 3 });
}

module.exports = { convertToPng };
