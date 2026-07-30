var https = require("https");
var urlModule = require("url");

var API_BASE = "https://api.to.design";
var CREDIT_COST = 1;

function getApiKey() {
  return process.env.CODE_TO_DESIGN_API_KEY || process.env.HTML_TO_DESIGN_API_KEY || null;
}

function hasApiKey() {
  var key = getApiKey();
  return !!key && key.length > 0;
}

async function convertHtml(html, options) {
  var key = getApiKey();
  if (!key) {
    return { success: false, error: "No API key configured. Set CODE_TO_DESIGN_API_KEY env var.", requiresKey: true };
  }

  var clip = options && options.clip !== undefined ? options.clip : true;
  var width = (options && options.width) || 1280;
  var height = (options && options.height) || 720;
  var topLayerName = (options && options.topLayerName) || "HTML Export";
  var noAutoLayout = (options && options.noAutoLayout) || false;
  var fullsizeImages = (options && options.fullsizeImages) || false;
  var theme = (options && options.theme) || "light";

  var body = JSON.stringify({
    html: html,
    clip: clip,
    topLayerName: topLayerName,
    noAutoLayout: noAutoLayout,
    fullsizeImages: fullsizeImages,
    width: width,
    height: height,
    theme: theme,
  });

  return new Promise(function(resolve, reject) {
    var parsed = urlModule.parse(API_BASE + "/html");

    var reqOptions = {
      hostname: parsed.hostname,
      port: parsed.port || 443,
      path: parsed.pathname,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": "Bearer " + key,
        "Content-Length": Buffer.byteLength(body),
      },
      timeout: 120000,
    };

    var req = https.request(reqOptions, function(res) {
      var chunks = [];

      res.on("data", function(chunk) {
        chunks.push(chunk);
      });

      res.on("end", function() {
        var raw = Buffer.concat(chunks);

        if (res.statusCode === 429) {
          resolve({ success: false, error: "Rate limited (429). Try again later.", rateLimited: true });
          return;
        }

        if (res.statusCode === 303) {
          var redirectUrl = res.headers.location;
          if (!redirectUrl) {
            resolve({ success: false, error: "Redirect (303) with no location header.", statusCode: 303 });
            return;
          }
          _followRedirect(redirectUrl, function(redirectErr, redirectData) {
            if (redirectErr) {
              resolve({ success: false, error: "Redirect follow failed: " + redirectErr.message, statusCode: 303 });
              return;
            }
            _processResponse(redirectData, clip, resolve);
          });
          return;
        }

        if (res.statusCode !== 200) {
          resolve({ success: false, error: "API returned " + res.statusCode + ": " + raw.toString("utf-8").substring(0, 500), statusCode: res.statusCode });
          return;
        }

        _processResponse(raw, clip, resolve);
      });
    });

    req.on("error", function(err) {
      resolve({ success: false, error: "Request failed: " + err.message });
    });

    req.on("timeout", function() {
      req.destroy();
      resolve({ success: false, error: "Request timed out after 120s" });
    });

    req.write(body);
    req.end();
  });
}

function _processResponse(raw, clip, resolve) {
  if (clip) {
    resolve({
      success: true,
      mode: "clipboard",
      clipboardData: raw.toString("utf-8"),
      size: raw.length,
      creditCost: CREDIT_COST,
    });
  } else {
    try {
      var json = JSON.parse(raw.toString("utf-8"));
      resolve({
        success: true,
        mode: "plugin",
        model: json.model || null,
        images: json.images || null,
        size: raw.length,
        creditCost: CREDIT_COST,
      });
    } catch (e) {
      resolve({
        success: false,
        error: "Failed to parse plugin mode response: " + e.message,
        raw: raw.toString("utf-8").substring(0, 500),
      });
    }
  }
}

function _followRedirect(url, callback) {
  var parsed = urlModule.parse(url);
  var opts = {
    hostname: parsed.hostname,
    port: parsed.port || 443,
    path: parsed.pathname + (parsed.search || ""),
    method: "GET",
    timeout: 60000,
  };

  var req = https.request(opts, function(res) {
    var chunks = [];
    res.on("data", function(c) { chunks.push(c); });
    res.on("end", function() {
      callback(null, Buffer.concat(chunks));
    });
  });

  req.on("error", callback);
  req.on("timeout", function() { req.destroy(); callback(new Error("Redirect timeout")); });
  req.end();
}

module.exports = {
  convertHtml: convertHtml,
  hasApiKey: hasApiKey,
  getApiKey: getApiKey,
  API_BASE: API_BASE,
  CREDIT_COST: CREDIT_COST,
};
