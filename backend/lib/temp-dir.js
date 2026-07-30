const os = require("os");
const path = require("path");
const fs = require("fs-extra");

const TEMP_ROOT = path.join(os.tmpdir(), "html-to-design");

function getTempDir() {
  return TEMP_ROOT;
}

function getTempPath(filename) {
  return path.join(TEMP_ROOT, filename);
}

async function ensureTempDir() {
  await fs.ensureDir(TEMP_ROOT);
}

async function removeTempFile(filename) {
  var filePath = path.join(TEMP_ROOT, filename);
  await fs.remove(filePath).catch(function() {});
}

module.exports = { getTempDir: getTempDir, getTempPath: getTempPath, ensureTempDir: ensureTempDir, removeTempFile: removeTempFile };
