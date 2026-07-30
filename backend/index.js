require("dotenv").config();
const express = require("express");
const cors = require("cors");
const multer = require("multer");
const fs = require("fs-extra");
const path = require("path");
const { v4: uuidv4 } = require("uuid");
const { convertTo } = require("./converters");
const { getPool, shutdownPool } = require("./lib/browser-pool");
const { getConnector, stopConnector } = require("./lib/figma-connector");
const { getTempDir } = require("./lib/temp-dir");

const PORT = parseInt(process.env.PORT) || 3000;
const TEMP_DIR = getTempDir();
const MAX_FILE_SIZE = parseInt(process.env.MAX_FILE_SIZE) || 10 * 1024 * 1024;

if (PORT < 1 || PORT > 65535) {
  console.error("Invalid PORT:", process.env.PORT);
  process.exit(1);
}

const app = express();

fs.ensureDirSync(TEMP_DIR);

var corsOrigins = process.env.CORS_ORIGINS
  ? process.env.CORS_ORIGINS.split(",").map(function(s) { return s.trim(); })
  : ["*"];

app.use(cors({
  origin: function(origin, callback) {
    if (!origin) return callback(null, true);
    if (corsOrigins.includes("*")) return callback(null, true);
    if (corsOrigins.includes(origin)) return callback(null, true);
    callback(null, false);
  },
  methods: ["GET", "POST", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Accept", "Authorization"],
  maxAge: 86400,
}));

app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));

app.disable("x-powered-by");
app.use(function(req, res, next) {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "SAMEORIGIN");
  res.setHeader("X-XSS-Protection", "1; mode=block");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  next();
});

app.use(function(req, res, next) {
  req.setTimeout(300000);
  res.setTimeout(300000);
  next();
});

var upload = multer({
  dest: TEMP_DIR,
  limits: { fileSize: MAX_FILE_SIZE },
  fileFilter: function(req, file, cb) {
    var allowed = [".html", ".htm", ".txt"];
    var ext = path.extname(file.originalname).toLowerCase();
    if (allowed.includes(ext) || file.mimetype === "text/html" || file.mimetype === "text/plain") {
      cb(null, true);
    } else {
      cb(new Error("Only HTML and text files are allowed"));
    }
  },
});

var rateLimitStore = new Map();
function rateLimit(maxRequests, windowMs) {
  return function(req, res, next) {
    var ip = req.ip || req.connection.remoteAddress || "unknown";
    var now = Date.now();
    var windowStart = now - windowMs;

    if (!rateLimitStore.has(ip)) {
      rateLimitStore.set(ip, []);
    }
    var timestamps = rateLimitStore.get(ip).filter(function(t) { return t > windowStart; });
    rateLimitStore.set(ip, timestamps);

    if (timestamps.length >= maxRequests) {
      return res.status(429).json({
        error: "Too many requests. Please try again later.",
        retryAfter: Math.ceil((timestamps[0] + windowMs - now) / 1000),
      });
    }
    timestamps.push(now);
    next();
  };
}

setInterval(function() {
  var now = Date.now();
  for (var [ip, timestamps] of rateLimitStore) {
    var valid = timestamps.filter(function(t) { return t > now - 60000; });
    if (valid.length === 0) rateLimitStore.delete(ip);
    else rateLimitStore.set(ip, valid);
  }
}, 60000);

var { JSDOM } = require("jsdom");

function sanitizeHtml(html) {
  if (!html) return "";
  try {
    var dom = new JSDOM(html);
    var doc = dom.window.document;

    var dangerousTags = ["script", "iframe", "object", "embed", "form", "input", "textarea", "select", "button"];
    for (var i = 0; i < dangerousTags.length; i++) {
      var els = doc.querySelectorAll(dangerousTags[i]);
      els.forEach(function(el) { el.remove(); });
    }

    var dangerousAttrs = ["onload", "onerror", "onclick", "onmouseover", "onfocus", "onblur",
      "onsubmit", "onchange", "onkeydown", "onkeyup", "onkeypress",
      "onmouseenter", "onmouseleave", "onmousemove", "onmouseout",
      "onanimationend", "onanimationstart", "ontransitionend"];
    var allEls = doc.querySelectorAll("*");
    allEls.forEach(function(el) {
      dangerousAttrs.forEach(function(attr) {
        if (el.hasAttribute(attr)) el.removeAttribute(attr);
      });
      if (el.tagName === "A") {
        var href = el.getAttribute("href") || "";
        if (href.startsWith("javascript:")) el.removeAttribute("href");
      }
    });

    return dom.window.document.body.innerHTML;
  } catch (e) {
    return html.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "")
      .replace(/\bon\w+\s*=\s*["'][^"']*["']/gi, "")
      .replace(/javascript:/gi, "");
  }
}

function buildHtmlDocument(html, css) {
  if (html.includes("<!DOCTYPE") || html.includes("<html")) {
    if (css) {
      return html.replace("</head>", "<style>" + css + "</style></head>");
    }
    return html;
  }
  return "<!DOCTYPE html>\n<html lang=\"en\">\n<head>\n  <meta charset=\"UTF-8\">\n  <meta name=\"viewport\" content=\"width=device-width, initial-scale=1.0\">\n  <style>" + (css || "") + "</style>\n</head>\n<body>" + html + "\n</body>\n</html>";
}

var VALID_FORMATS = ["png", "pdf", "svg", "figma", "psd", "xd", "clipboard", "figma-mcp", "figma-all", "inline", "figma-plugin"];

var FORMAT_META = {
  png: { ext: "png", mime: "image/png" },
  pdf: { ext: "pdf", mime: "application/pdf" },
  svg: { ext: "svg", mime: "image/svg+xml" },
  figma: { ext: "fig", mime: "application/octet-stream" },
  psd: { ext: "psd", mime: "application/octet-stream" },
  xd: { ext: "sketch", mime: "application/octet-stream" },
  clipboard: { ext: "html", mime: "text/html" },
  "figma-mcp": { ext: "json", mime: "application/json" },
  "figma-all": { ext: "json", mime: "application/json" },
  inline: { ext: "json", mime: "application/json" },
  "figma-plugin": { ext: "json", mime: "application/json" },
};

app.get("/api/health", function(req, res) {
  var pool = getPool();
  var stats = pool.getStats();
  res.json({
    status: "ok",
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    memory: process.memoryUsage(),
    browserPool: stats,
    formats: VALID_FORMATS,
  });
});

app.get("/api/formats", function(req, res) {
  res.json({
    formats: [
      { id: "png", label: "PNG", description: "Raster image (full page screenshot)" },
      { id: "pdf", label: "PDF", description: "Print-ready PDF document" },
      { id: "svg", label: "SVG", description: "Vector graphic with raster base + text overlay" },
      { id: "figma", label: "Figma (.fig)", description: ".fig file with native layers and auto-layout" },
      { id: "clipboard", label: "Figma Clipboard", description: "fig-kiwi clipboard HTML - paste directly into Figma (Cmd+V)" },
      { id: "figma-mcp", label: "Figma MCP", description: "Figma Plugin API code for MCP write-to-canvas integration" },
      { id: "figma-all", label: "Figma All-in-One", description: "All 3 Figma outputs: .fig + clipboard + MCP script in one shot" },
      { id: "inline", label: "Inline HTML", description: "Single HTML file with all CSS styles inlined" },
      { id: "psd", label: "PSD", description: "Adobe Photoshop document with editable layers" },
      { id: "xd", label: "XD", description: "Sketch-compatible design file (opens in Figma, Sketch, Penpot, XD)" },
    ],
  });
});

app.post("/api/import/url", rateLimit(5, 60000), async function(req, res) {
  try {
    var url = req.body && req.body.url;
    if (!url) {
      return res.status(400).json({ error: "URL is required" });
    }

    var parsedUrl;
    try {
      parsedUrl = new URL(url);
    } catch (e) {
      return res.status(400).json({ error: "Invalid URL format" });
    }

    if (!["http:", "https:"].includes(parsedUrl.protocol)) {
      return res.status(400).json({ error: "Only HTTP and HTTPS URLs are supported" });
    }

    var pool = getPool();
    var result = await pool.execute(async function(page) {
      await page.setViewport({ width: 1440, height: 900 });
      await page.goto(url, { waitUntil: "networkidle2", timeout: 30000 });
      await page.evaluate(function() { return document.fonts && document.fonts.ready; });
      await new Promise(function(r) { setTimeout(r, 1000); });

      var content = await page.evaluate(function() {
        var html = document.body.innerHTML;
        var styles = Array.from(document.querySelectorAll("style")).map(function(s) { return s.textContent; }).join("\n");
        return { html: html, styles: styles, title: document.title };
      });

      return content;
    }, { timeout: 60000, retries: 2 });

    res.json({
      html: result.html,
      css: result.styles,
      title: result.title,
      url: url,
    });
  } catch (err) {
    console.error("URL import error:", err.message);
    res.status(500).json({ error: "Failed to import URL: " + err.message });
  }
});

app.post("/api/convert/:format", rateLimit(30, 60000), upload.single("html"), async function(req, res) {
  var jobId = uuidv4();
  var format = req.params.format;

  try {
    var htmlContent = "";
    var cssContent = (req.body && req.body.css) || "";

    if (req.file) {
      htmlContent = fs.readFileSync(req.file.path, "utf-8");
      fs.removeSync(req.file.path);
    } else if (req.body && req.body.html) {
      htmlContent = req.body.html;
    } else {
      return res.status(400).json({ error: "No HTML content provided. Send html in body or upload a file." });
    }

    htmlContent = sanitizeHtml(htmlContent);

    var width = Math.min(Math.max(parseInt(req.body.width) || 1440, 320), 3840);
    var height = Math.min(Math.max(parseInt(req.body.height) || 900, 200), 2160);
    var scale = Math.min(Math.max(parseFloat(req.body.scale) || 2, 0.5), 4);

    var fullHtml = buildHtmlDocument(htmlContent, cssContent);

    if (!VALID_FORMATS.includes(format)) {
      return res.status(400).json({
        error: "Unsupported format: " + format,
        supported: VALID_FORMATS,
      });
    }

    var pdfOptions = {};
    if (format === "pdf") {
      var allowedFormats = ["A3", "A4", "A5", "Legal", "Letter", "Tabloid"];
      pdfOptions.format = allowedFormats.includes(req.body.format) ? req.body.format : "A4";
      pdfOptions.landscape = req.body.landscape === "true" || req.body.landscape === true;
      pdfOptions.printBackground = req.body.printBackground !== "false";
      pdfOptions.headerFooter = req.body.headerFooter !== "false";
      pdfOptions.margin = req.body.margin || "15mm";
    }

    var conversionTimeout = 180000;
    if (format === "figma-all") conversionTimeout = 300000;
    if (format === "figma" || format === "psd" || format === "xd") conversionTimeout = 180000;
    if (format === "inline") conversionTimeout = 60000;

    console.log("[" + jobId + "] Converting to " + format + " (" + width + "x" + height + " @" + scale + "x) timeout=" + conversionTimeout + "ms");

    var result = await convertTo(format, fullHtml, {
      width: width,
      height: height,
      scale: scale,
      css: cssContent,
      jobId: jobId,
      timeout: conversionTimeout,
      autoRun: req.body && req.body.autoRun,
      writeClipboard: req.body && req.body.writeClipboard,
      pageName: (req.body && req.body.pageName) || "HTML Export",
      ...pdfOptions,
    });

    var meta = FORMAT_META[format] || { ext: format, mime: "application/octet-stream" };

    /* Skip forced download for complex multi-format outputs — display in-viewer instead */
    var noDownload = ["figma-all", "figma-mcp", "inline"];
    var disposition = noDownload.indexOf(format) >= 0 ? "inline" : "attachment";
    res.setHeader("Content-Type", meta.mime);
    if (disposition === "attachment") {
      res.setHeader("Content-Disposition", disposition + '; filename="export.' + meta.ext + '"');
    }
    /* For large payloads, omit Content-Length to use chunked encoding */
    if (Buffer.byteLength(result) > 10 * 1024 * 1024) {
      console.log("[" + jobId + "] Large response (" + (Buffer.byteLength(result) / 1024 / 1024).toFixed(1) + "MB) — streaming chunked");
    } else {
      res.setHeader("Content-Length", Buffer.byteLength(result));
    }
    res.send(result);

    console.log("[" + jobId + "] OK " + format + " (" + (Buffer.byteLength(result) / 1024).toFixed(1) + "KB)");
  } catch (err) {
    console.error("[" + jobId + "] FAIL " + format + ":", err.message);
    if (req.file) fs.removeSync(req.file.path);
    if (res.headersSent) {
      try { res.end(); } catch (e) {}
    } else {
      res.status(500).json({ error: err.message || "Conversion failed", jobId: jobId });
    }
  }
});

var { compare: compareOutput } = require("./lib/comparator");

app.post("/api/compare", rateLimit(5, 60000), async function(req, res) {
  try {
    var html = req.body && req.body.html;
    var css = (req.body && req.body.css) || "";
    var format = (req.body && req.body.format) || "png";
    var convertedBuffer = req.body && req.body.convertedBuffer;

    if (!html) {
      return res.status(400).json({ error: "HTML content is required" });
    }

    var fullHtml = buildHtmlDocument(sanitizeHtml(html), css);
    var convBuf = null;
    if (convertedBuffer) {
      try {
        convBuf = Buffer.from(convertedBuffer, "base64");
      } catch (e) {}
    }

    console.log("Comparing output for format: " + format);
    var result = await compareOutput(html, css, format, convBuf);
    console.log("Comparison complete: " + result.overallScore.toFixed(1) + "% overall");

    res.json(result);
  } catch (err) {
    console.error("Comparison error:", err.message);
    res.status(500).json({ error: "Comparison failed: " + err.message });
  }
});

app.get("/api/figma/status", async function(req, res) {
  try {
    var connector = getConnector();
    var status = await connector.getStatus();
    res.json({ status: "ok", connector: status });
  } catch (err) {
    res.json({ status: "ok", connector: { running: false, initialized: false, figmaConnected: false, mode: null, pid: null, progress: null, error: err.message } });
  }
});

app.post("/api/figma/connect", rateLimit(10, 60000), async function(req, res) {
  try {
    var connector = getConnector();
    var started = await connector.start();
    var status = await connector.getStatus();
    res.json({ status: "ok", started: started, connector: status });
  } catch (err) {
    console.error("Figma connect error:", err.message);
    res.status(500).json({ error: "Failed to connect: " + err.message });
  }
});

app.post("/api/figma/stop", rateLimit(10, 60000), async function(req, res) {
  try {
    var connector = getConnector();
    await connector.stop();
    res.json({ status: "ok", stopped: true });
  } catch (err) {
    res.status(500).json({ error: "Failed to stop: " + err.message });
  }
});

app.post("/api/figma/restart", rateLimit(5, 60000), async function(req, res) {
  try {
    await stopConnector();
    var connector = getConnector();
    var started = await connector.start();
    var status = await connector.getStatus();
    res.json({ status: "ok", started: started, connector: status });
  } catch (err) {
    console.error("Figma restart error:", err.message);
    res.status(500).json({ error: "Failed to restart: " + err.message });
  }
});

app.post("/api/figma/disconnect", rateLimit(3, 60000), async function(req, res) {
  try {
    await stopConnector();
    res.json({ status: "ok", disconnected: true });
  } catch (err) {
    res.status(500).json({ error: "Failed to disconnect: " + err.message });
  }
});

app.post("/api/figma/run", rateLimit(15, 60000), async function(req, res) {
  try {
    var html = req.body && req.body.html;
    var name = (req.body && req.body.name) || "HTML Export";
    if (!html) {
      return res.status(400).json({ error: "html is required" });
    }

    var connector = getConnector();
    var status = await connector.getStatus();

    if (!status.running || !status.figmaConnected) {
      if (status.running) {
        await stopConnector();
        connector = getConnector();
      }
      var started = await connector.start();
      if (!started) {
        return res.status(503).json({ error: "Could not start Figma connector. Ensure Figma is running with the plugin." });
      }
      status = await connector.getStatus();
    }

    if (!status.figmaConnected) {
      return res.status(503).json({ error: "Figma not connected. Open the html.to.design or mcp.to.design plugin in Figma." });
    }

    var result = await connector.renderHtml(html, name, { designSystem: req.body.designSystem !== false });
    res.json({ status: "ok", result: result });
  } catch (err) {
    console.error("Figma run error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

app.use(function(err, req, res, next) {
  if (err instanceof multer.MulterError) {
    if (err.code === "LIMIT_FILE_SIZE") {
      return res.status(413).json({ error: "File too large. Maximum size is 10MB." });
    }
    return res.status(400).json({ error: err.message });
  }
  if (err.message && err.message.includes("Only HTML")) {
    return res.status(400).json({ error: err.message });
  }
  console.error("Unhandled error:", err.message || err);
  if (!res.headersSent) {
    res.status(500).json({ error: err.message || "Internal server error" });
  }
});

var server = app.listen(PORT, async function() {
  console.log("\n  HTML to Design Converter API v3.0");
  console.log("  Running on http://localhost:" + PORT);
  console.log("  Health: http://localhost:" + PORT + "/api/health");
  console.log("  Formats: POST /api/convert/:format");
  console.log("  Import:  POST /api/import/url");
  console.log("  Rate limit: 30 conversions/min, 5 URL imports/min, 15 Figma runs/min");
  console.log("  Platform: " + process.platform + " " + process.arch + "\n");

  try {
    await getPool({ maxConcurrency: process.platform === "win32" ? 2 : 3 }).init();
  } catch (e) {
    console.error("Warning: Could not initialize browser pool:", e.message);
    console.error("Conversions will attempt to launch browsers on-demand.");
  }
});

var shuttingDown = false;
async function gracefulShutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log("\n" + signal + " received. Shutting down gracefully...");
  try {
    await shutdownPool();
    await stopConnector();
  } catch (e) {}
  server.close(function() { process.exit(0); });
  setTimeout(function() { process.exit(1); }, 5000);
}

process.on("SIGTERM", function() { gracefulShutdown("SIGTERM"); });
process.on("SIGINT", function() { gracefulShutdown("SIGINT"); });
process.on("exit", function(code) {
  console.error("Process exiting with code " + code);
});
["SIGSEGV", "SIGABRT", "SIGBUS"].forEach(function(sig) {
  process.on(sig, function() {
    console.error("Received " + sig + " - native crash");
    process.exit(1);
  });
});
process.on("uncaughtException", function(err) {
  console.error("Uncaught exception:", err.message);
  console.error(err.stack);
  if (server && server.listening) {
    console.error("Server still listening, continuing...");
  } else {
    console.error("Server not listening, exiting...");
    process.exit(1);
  }
});
process.on("unhandledRejection", function(reason) {
  console.error("Unhandled rejection:", reason && reason.stack ? reason.stack : reason);
  if (server && server.listening) {
    console.error("Server still listening, continuing...");
  } else {
    console.error("Server not listening, exiting...");
    process.exit(1);
  }
});
