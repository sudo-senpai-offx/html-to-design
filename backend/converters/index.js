const { convertToPng } = require("./png");
const { convertToPdf } = require("./pdf");
const { convertToSvg } = require("./svg");
const { convertToFigma } = require("./figma");
const { convertToPsd } = require("./psd");

const converters = {
  png: convertToPng,
  pdf: convertToPdf,
  svg: convertToSvg,
  figma: convertToFigma,
  psd: convertToPsd,
};

async function convertTo(format, html, options) {
  const converter = converters[format];
  if (!converter) {
    throw new Error(`Unsupported format: ${format}. Supported: ${Object.keys(converters).join(", ")}`);
  }
  return converter(html, options);
}

module.exports = { convertTo };
