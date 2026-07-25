const { getPool } = require("../lib/browser-pool");

async function convertToPsd(html, options) {
  var { width = 1440, height = 900, scale = 2 } = options;
  var pool = getPool();

  var pngBuffer = await pool.execute(async (page) => {
    await page.setViewport({ width, height, deviceScaleFactor: scale });
    await page.setContent(html, { waitUntil: "networkidle2", timeout: 30000 });
    await page.evaluate(() => document.fonts && document.fonts.ready);
    await new Promise((r) => setTimeout(r, 500));

    return page.screenshot({
      type: "png",
      fullPage: false,
      clip: { x: 0, y: 0, width, height },
    });
  }, { timeout: 60000, retries: 3 });

  var psdBuffer = createMinimalPsd(width * scale, height * scale, pngBuffer);
  return psdBuffer;
}

function createMinimalPsd(width, height, imageBuffer) {
  var channels = 4;
  var depth = 8;

  var buf = Buffer.alloc(0);

  function writeString(str) {
    buf = Buffer.concat([buf, Buffer.from(str, "ascii")]);
  }

  function writeUint16(val) {
    var b = Buffer.alloc(2);
    b.writeUInt16BE(val);
    buf = Buffer.concat([buf, b]);
  }

  function writeUint32(val) {
    var b = Buffer.alloc(4);
    b.writeUInt32BE(val);
    buf = Buffer.concat([buf, b]);
  }

  function writeUint8(val) {
    var b = Buffer.alloc(1);
    b.writeUInt8(val);
    buf = Buffer.concat([buf, b]);
  }

  writeString("8BPS");
  writeUint16(1);
  writeUint16(0);
  writeUint16(0);
  writeUint16(channels);
  writeUint32(height);
  writeUint32(width);
  writeUint16(depth);
  writeUint16(3);

  writeUint32(0);
  writeUint32(0);
  writeUint32(0);

  writeUint16(0);

  for (var c = 0; c < channels; c++) {
    for (var y = 0; y < height; y++) {
      var rowStart = (y * width * channels) + c;
      for (var x = 0; x < width; x++) {
        var idx = rowStart + (x * channels);
        if (idx < imageBuffer.length) {
          writeUint8(imageBuffer[idx]);
        } else {
          writeUint8(0);
        }
      }
    }
  }

  return buf;
}

module.exports = { convertToPsd };
