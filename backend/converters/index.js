const { convertToPng } = require("./png");
const { convertToPdf } = require("./pdf");
const { convertToSvg } = require("./svg");
const { convertToFigma } = require("./figma");
const { convertToPsd } = require("./psd");
const { convertToXd } = require("./xd");
const { convertToClipboardFormat } = require("./clipboard");
const { convertToFigmaMcp } = require("./figma-mcp");
const { convertToAll } = require("./figma-all");
const { convertToInlineHtml } = require("./inline");
const { convertToPluginRun } = require("./figma-plugin");

const converters = {
  png: convertToPng,
  pdf: convertToPdf,
  svg: convertToSvg,
  figma: convertToFigma,
  psd: convertToPsd,
  xd: convertToXd,
  clipboard: convertToClipboardFormat,
  "figma-mcp": convertToFigmaMcp,
  "figma-all": convertToAll,
  inline: convertToInlineHtml,
  "figma-plugin": convertToPluginRun,
};

async function convertTo(format, html, options) {
  var converter = converters[format];
  if (!converter) {
    throw new Error("Unsupported format: " + format + ". Supported: " + Object.keys(converters).join(", "));
  }
  return converter(html, options);
}

module.exports = { convertTo: convertTo };
