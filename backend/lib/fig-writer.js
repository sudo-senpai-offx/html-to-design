const fs = require("fs");
const path = require("path");

var _exportFigFile = null;

async function loadExportFigFile() {
  if (!_exportFigFile) {
    var io = await import("@open-pencil/core/io");
    _exportFigFile = io.exportFigFile;
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
