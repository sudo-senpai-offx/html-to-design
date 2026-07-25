const { encodeFigParts, assembleCanvasFig, createFigZip } = require("openfig-core");
const { ZstdCodec } = require("zstd-codec");
const fs = require("fs");
const path = require("path");

function zstdCompress(data, level) {
  level = level || 3;
  return new Promise(function(resolve, reject) {
    ZstdCodec.run(function(zstd) {
      try {
        var simple = new zstd.Simple();
        resolve(new Uint8Array(simple.compress(Buffer.from(data), level)));
      } catch (e) { reject(e); }
    });
  });
}

async function writeFigFile(doc, outputPath) {
  var parts = encodeFigParts(doc);
  var messageCompressed = await zstdCompress(parts.messageRaw, 3);
  var canvasFig = assembleCanvasFig({
    prelude: parts.prelude,
    version: parts.version,
    schemaCompressed: parts.schemaCompressed,
    messageCompressed: messageCompressed,
    passThrough: parts.passThrough,
  });
  var figZip = createFigZip({
    canvasFig: canvasFig,
    meta: doc.meta,
    thumbnail: doc.thumbnail,
    images: doc.images,
  });
  var dir = path.dirname(outputPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(outputPath, Buffer.from(figZip));
  return outputPath;
}

async function writeFigBuffer(doc) {
  var parts = encodeFigParts(doc);
  var messageCompressed = await zstdCompress(parts.messageRaw, 3);
  var canvasFig = assembleCanvasFig({
    prelude: parts.prelude,
    version: parts.version,
    schemaCompressed: parts.schemaCompressed,
    messageCompressed: messageCompressed,
    passThrough: parts.passThrough,
  });
  var figZip = createFigZip({
    canvasFig: canvasFig,
    meta: doc.meta,
    thumbnail: doc.thumbnail,
    images: doc.images,
  });
  return Buffer.from(figZip);
}

module.exports = { writeFigFile, writeFigBuffer };
