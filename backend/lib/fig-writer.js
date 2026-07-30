const fs = require("fs");
const path = require("path");

var _exportFigFile = null;
var _loadFailed = false;

async function loadExportFigFile() {
  if (_loadFailed) {
    throw new Error("@open-pencil/core/io failed to load previously, skipping .fig generation");
  }
  if (!_exportFigFile) {
    try {
      var io = await import("@open-pencil/core/io");
      _exportFigFile = io.exportFigFile;
      if (!_exportFigFile) {
        throw new Error("exportFigFile not found in @open-pencil/core/io");
      }
    } catch (e) {
      _loadFailed = true;
      console.error("  [FigWriter] Failed to load @open-pencil/core/io:", e.message);
      throw new Error("@open-pencil/core/io module could not be loaded: " + e.message);
    }
  }
  return _exportFigFile;
}

async function writeFigFile(graph, outputPath) {
  var buffer = await writeFigBuffer(graph);
  var dir = path.dirname(outputPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(outputPath, buffer);
  return outputPath;
}

async function writeFigBuffer(graph) {
  var exportFigFile = await loadExportFigFile();
  var figArray = await exportFigFile(graph);
  return Buffer.from(figArray);
}

module.exports = { writeFigFile, writeFigBuffer };
