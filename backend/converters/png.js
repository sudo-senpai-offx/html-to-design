const { getPool } = require("../lib/browser-pool");
const { resolveFormatOptions } = require("../lib/config");

function getImageLoadPromise(page) {
  return page.evaluate(() => {
    return new Promise((resolve) => {
      var images = document.querySelectorAll("img");
      var loaded = 0;
      var total = images.length;
      if (total === 0) return resolve();
      images.forEach((img) => {
        if (img.complete) {
          loaded++;
          if (loaded === total) resolve();
        } else {
          img.onload = () => { loaded++; if (loaded === total) resolve(); };
          img.onerror = () => { loaded++; if (loaded === total) resolve(); };
        }
      });
      setTimeout(resolve, 5000);
    });
  });
}

async function convertToPng(html, options) {
  var cfg = resolveFormatOptions("png", options);
  var {
    width = cfg.width,
    height = cfg.height,
    scale = cfg.scale,
    fullPage = cfg.fullPage,
    transparent = cfg.transparent,
    maxHeight = cfg.maxHeight,
    clipHeight = cfg.clipHeight,
  } = options || {};

  var pool = getPool();

  return pool.execute(async (page) => {
    await page.setViewport({ width, height, deviceScaleFactor: scale });
    await page.setContent(html, { waitUntil: "networkidle2", timeout: cfg.setContentTimeout });
    await page.evaluate(() => document.fonts && document.fonts.ready);
    await new Promise((r) => setTimeout(r, 500));

    if (!transparent) {
      await page.evaluate(() => {
        document.body.style.backgroundColor = "#ffffff";
      });
    }

    await getImageLoadPromise(page);

    var scrollHeight = await page.evaluate(() => document.documentElement.scrollHeight);
    var viewportHeight = await page.evaluate(() => window.innerHeight);

    var fullH = Math.max(scrollHeight, viewportHeight, height);
    if (fullH > maxHeight) {
      fullH = maxHeight;
    }

    if (fullPage && !clipHeight) {
      if (fullH <= maxHeight) {
        return page.screenshot({
          type: "png",
          fullPage: true,
          omitBackground: transparent,
        });
      }
      /* Full page exceeds maxHeight — fall back to clipped capture */
      return page.screenshot({
        type: "png",
        fullPage: false,
        omitBackground: transparent,
        clip: { x: 0, y: 0, width: width, height: maxHeight },
      });
    }

    if (clipHeight) {
      return page.screenshot({
        type: "png",
        fullPage: false,
        omitBackground: transparent,
        clip: { x: 0, y: 0, width: width, height: Math.min(clipHeight, maxHeight) },
      });
    }

    return page.screenshot({
      type: "png",
      fullPage: false,
      omitBackground: transparent,
    });
  }, { timeout: cfg.taskTimeout || 60000, retries: 3 });
}

module.exports = { convertToPng };
