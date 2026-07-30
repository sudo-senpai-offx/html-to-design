const { convertUnified } = require("../lib/figma-engine");

async function convertToAll(html, options) {
  var buffer = await convertUnified(html, options);
  var parsed = JSON.parse(buffer.toString("utf-8"));

  var outputs = {};
  if (parsed.methods) {
    for (var id in parsed.methods) {
      var m = parsed.methods[id];
      if (m && m.status === "ready" && m.data) {
        outputs[id] = m.data;
      }
    }
  }

  var pluginHtml = null;
  if (parsed.pluginHtml) {
    pluginHtml = Buffer.from(parsed.pluginHtml, "base64").toString("utf-8");
  }

  var response = {
    metadata: parsed.metadata,
    outputs: outputs,
    pluginHtml: pluginHtml,
    pluginHtmlRaw: parsed.pluginHtmlRaw || null,
    errors: parsed.errors || [],
    methods: parsed.methods,
    bestMethod: parsed.bestMethod,
    qualityReports: parsed.qualityReports,
    qualitySummary: parsed.qualitySummary,
    designSystem: parsed.designSystem,
  };

  return Buffer.from(JSON.stringify(response), "utf-8");
}

module.exports = { convertToAll };
