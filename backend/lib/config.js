/* Centralized per-format conversion configuration.
 *
 * Every converter resolves its options through this module so that:
 *   - defaults live in one place (DEFAULT_CONFIG),
 *   - environment variables can override them for deployment tuning
 *     (e.g. CONVERT_MAX_ELEMENTS, CONVERT_MAX_HEIGHT, PDF_FORMAT),
 *   - runtime options always win over env + defaults.
 */

function envInt(name, fallback) {
  var v = process.env[name];
  if (v === undefined || v === "") return fallback;
  var n = parseInt(v, 10);
  return isNaN(n) ? fallback : n;
}

function envFloat(name, fallback) {
  var v = process.env[name];
  if (v === undefined || v === "") return fallback;
  var n = parseFloat(v);
  return isNaN(n) ? fallback : n;
}

function envBool(name, fallback) {
  var v = process.env[name];
  if (v === undefined || v === "") return fallback;
  return v === "true" || v === "1" || v === "yes";
}

var DEFAULT_CONFIG = {
  width: 1440,
  height: 900,
  scale: 2,
  fullPage: true,
  transparent: false,
  maxHeight: 16384,
  maxElements: 25000,
  maxDepth: 60,
  maxBatchBytes: 100 * 1024,
  screenshotCap: 30000,
  setContentTimeout: 30000,
  taskTimeout: 0,
  pdf: {
    format: "A4",
    landscape: false,
    printBackground: true,
    headerFooter: true,
    margin: "15mm",
  },
};

var PAGE_SIZES = ["A3", "A4", "A5", "Legal", "Letter", "Tabloid"];

function getConfig(name) {
  if (name === "pdf") {
    var format = process.env.PDF_FORMAT || DEFAULT_CONFIG.pdf.format;
    if (PAGE_SIZES.indexOf(format) < 0) format = DEFAULT_CONFIG.pdf.format;
    return {
      format: format,
      landscape: envBool("PDF_LANDSCAPE", DEFAULT_CONFIG.pdf.landscape),
      printBackground: envBool("PDF_PRINT_BACKGROUND", DEFAULT_CONFIG.pdf.printBackground),
      headerFooter: envBool("PDF_HEADER_FOOTER", DEFAULT_CONFIG.pdf.headerFooter),
      margin: process.env.PDF_MARGIN || DEFAULT_CONFIG.pdf.margin,
    };
  }
  return {
    width: envInt("CONVERT_DEFAULT_WIDTH", DEFAULT_CONFIG.width),
    height: envInt("CONVERT_DEFAULT_HEIGHT", DEFAULT_CONFIG.height),
    scale: envFloat("CONVERT_DEFAULT_SCALE", DEFAULT_CONFIG.scale),
    fullPage: envBool("CONVERT_FULL_PAGE", DEFAULT_CONFIG.fullPage),
    transparent: envBool("CONVERT_TRANSPARENT", DEFAULT_CONFIG.transparent),
    maxHeight: envInt("CONVERT_MAX_HEIGHT", DEFAULT_CONFIG.maxHeight),
    maxElements: envInt("CONVERT_MAX_ELEMENTS", DEFAULT_CONFIG.maxElements),
    maxDepth: envInt("CONVERT_MAX_DEPTH", DEFAULT_CONFIG.maxDepth),
    maxBatchBytes: envInt("CONVERT_MAX_BATCH_BYTES", DEFAULT_CONFIG.maxBatchBytes),
    screenshotCap: envInt("CONVERT_SCREENSHOT_CAP", DEFAULT_CONFIG.screenshotCap),
    setContentTimeout: envInt("CONVERT_SETCONTENT_TIMEOUT", DEFAULT_CONFIG.setContentTimeout),
    taskTimeout: envInt("CONVERT_TASK_TIMEOUT", DEFAULT_CONFIG.taskTimeout),
  };
}

/* Merge order: hardcoded defaults -> environment overrides -> caller options. */
function resolveFormatOptions(format, options) {
  var opts = Object.assign({}, getConfig(), options || {});
  if (format === "pdf") {
    opts.pdf = Object.assign({}, getConfig("pdf"), (options && options.pdf) || {});
    /* Keep scalar pdf options flowing through (server passes them flat) */
    if (options) {
      if (options.format && PAGE_SIZES.indexOf(options.format) >= 0) opts.pdf.format = options.format;
      if (options.landscape !== undefined) opts.pdf.landscape = options.landscape;
      if (options.printBackground !== undefined) opts.pdf.printBackground = options.printBackground;
      if (options.headerFooter !== undefined) opts.pdf.headerFooter = options.headerFooter;
      if (options.margin) opts.pdf.margin = options.margin;
    }
  }
  return opts;
}

function getDefaults() {
  return Object.assign({}, DEFAULT_CONFIG, getConfig(), {
    pdf: getConfig("pdf"),
  });
}

module.exports = {
  DEFAULT_CONFIG: DEFAULT_CONFIG,
  getConfig: getConfig,
  getDefaults: getDefaults,
  resolveFormatOptions: resolveFormatOptions,
  envInt: envInt,
  envFloat: envFloat,
  envBool: envBool,
};
