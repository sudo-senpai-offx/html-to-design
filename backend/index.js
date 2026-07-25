require("dotenv").config();
const express = require("express");
const cors = require("cors");
const multer = require("multer");
const fs = require("fs-extra");
const path = require("path");
const { v4: uuidv4 } = require("uuid");
const { convertTo } = require("./converters");
const { getPool, shutdownPool } = require("./lib/browser-pool");

const PORT = parseInt(process.env.PORT) || 3000;
const TEMP_DIR = path.resolve(process.env.TEMP_DIR || "./temp");
const MAX_FILE_SIZE = parseInt(process.env.MAX_FILE_SIZE) || 10 * 1024 * 1024;

if (PORT < 1 || PORT > 65535) {
  console.error("Invalid PORT:", process.env.PORT);
  process.exit(1);
}
if (MAX_FILE_SIZE > 50 * 1024 * 1024) {
  console.warn("MAX_FILE_SIZE exceeds 50MB, capping to 50MB");
}

const app = express();

fs.ensureDirSync(TEMP_DIR);

const corsOrigins = process.env.CORS_ORIGINS
  ? process.env.CORS_ORIGINS.split(",").map(s => s.trim())
  : ["http://localhost:5173", "http://localhost:5174", "http://localhost:80"];

app.use(cors({
  origin: function(origin, callback) {
    if (!origin) return callback(null, true);
    if (corsOrigins.includes("*") || corsOrigins.includes(origin)) {
      return callback(null, true);
    }
    callback(null, false);
  },
  methods: ["GET", "POST"],
  allowedHeaders: ["Content-Type"],
  maxAge: 86400,
}));

app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));

app.disable("x-powered-by");
app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "SAMEORIGIN");
  res.setHeader("X-XSS-Protection", "1; mode=block");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  next();
});

const upload = multer({
  dest: TEMP_DIR,
  limits: { fileSize: MAX_FILE_SIZE },
  fileFilter: (req, file, cb) => {
    const allowed = [".html", ".htm", ".txt"];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowed.includes(ext) || file.mimetype === "text/html" || file.mimetype === "text/plain") {
      cb(null, true);
    } else {
      cb(new Error("Only HTML and text files are allowed"));
    }
  },
});

const rateLimitStore = new Map();
function rateLimit(maxRequests, windowMs) {
  return (req, res, next) => {
    const ip = req.ip || req.connection.remoteAddress || "unknown";
    const now = Date.now();
    const windowStart = now - windowMs;

    if (!rateLimitStore.has(ip)) {
      rateLimitStore.set(ip, []);
    }
    const timestamps = rateLimitStore.get(ip).filter(t => t > windowStart);
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

setInterval(() => {
  const now = Date.now();
  for (const [ip, timestamps] of rateLimitStore) {
    const valid = timestamps.filter(t => t > now - 60000);
    if (valid.length === 0) rateLimitStore.delete(ip);
    else rateLimitStore.set(ip, valid);
  }
}, 60000);

const { JSDOM } = require("jsdom");

function sanitizeHtml(html) {
  if (!html) return "";
  try {
    const dom = new JSDOM(html);
    const doc = dom.window.document;

    const dangerousTags = ["script", "iframe", "object", "embed", "form", "input", "textarea", "select", "button"];
    for (const tag of dangerousTags) {
      const els = doc.querySelectorAll(tag);
      els.forEach(el => el.remove());
    }

    const dangerousAttrs = ["onload", "onerror", "onclick", "onmouseover", "onfocus", "onblur",
      "onsubmit", "onchange", "onkeydown", "onkeyup", "onkeypress",
      "onmouseenter", "onmouseleave", "onmousemove", "onmouseout",
      "onanimationend", "onanimationstart", "ontransitionend"];
    const allEls = doc.querySelectorAll("*");
    allEls.forEach(el => {
      dangerousAttrs.forEach(attr => {
        if (el.hasAttribute(attr)) el.removeAttribute(attr);
      });
      if (el.tagName === "A") {
        const href = el.getAttribute("href") || "";
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
      return html.replace("</head>", `<style>${css}</style></head>`);
    }
    return html;
  }
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>${css || ""}</style>
</head>
<body>${html}</body>
</html>`;
}

app.get("/api/health", (req, res) => {
  const pool = getPool();
  const stats = pool.getStats();
  res.json({
    status: "ok",
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    memory: process.memoryUsage(),
    browserPool: stats,
    formats: ["png", "pdf", "svg", "figma", "psd"],
  });
});

app.get("/api/formats", (req, res) => {
  res.json({
    formats: [
      { id: "png", label: "PNG", description: "Raster image (full page screenshot)" },
      { id: "pdf", label: "PDF", description: "Print-ready PDF document" },
      { id: "svg", label: "SVG", description: "Vector graphic with raster base + text overlay" },
      { id: "figma", label: "Figma", description: ".fig file with native layers and auto-layout" },
      { id: "psd", label: "PSD", description: "Adobe Photoshop document" },
    ],
  });
});

app.post("/api/import/url", rateLimit(5, 60000), async (req, res) => {
  try {
    const { url } = req.body;
    if (!url) {
      return res.status(400).json({ error: "URL is required" });
    }

    let parsedUrl;
    try {
      parsedUrl = new URL(url);
    } catch {
      return res.status(400).json({ error: "Invalid URL format" });
    }

    if (!["http:", "https:"].includes(parsedUrl.protocol)) {
      return res.status(400).json({ error: "Only HTTP and HTTPS URLs are supported" });
    }

    const pool = getPool();
    const result = await pool.execute(async (page) => {
      await page.setViewport({ width: 1440, height: 900 });
      await page.goto(url, { waitUntil: "networkidle2", timeout: 30000 });
      await page.evaluate(() => document.fonts && document.fonts.ready);
      await new Promise(r => setTimeout(r, 1000));

      const content = await page.evaluate(() => {
        const html = document.body.innerHTML;
        const styles = Array.from(document.querySelectorAll("style")).map(s => s.textContent).join("\n");
        const links = Array.from(document.querySelectorAll('link[rel="stylesheet"]'));
        return { html, styles, title: document.title };
      });

      return content;
    });

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

app.post("/api/convert/:format", rateLimit(10, 60000), upload.single("html"), async (req, res) => {
  const jobId = uuidv4();
  const format = req.params.format;

  try {
    let htmlContent = "";
    let cssContent = req.body.css || "";

    if (req.file) {
      htmlContent = fs.readFileSync(req.file.path, "utf-8");
      fs.removeSync(req.file.path);
    } else if (req.body.html) {
      htmlContent = req.body.html;
    } else {
      return res.status(400).json({ error: "No HTML content provided. Send html in body or upload a file." });
    }

    htmlContent = sanitizeHtml(htmlContent);

    const width = Math.min(Math.max(parseInt(req.body.width) || 1440, 320), 3840);
    const height = Math.min(Math.max(parseInt(req.body.height) || 900, 200), 2160);
    const scale = Math.min(Math.max(parseFloat(req.body.scale) || 2, 0.5), 4);

    const fullHtml = buildHtmlDocument(htmlContent, cssContent);

    const validFormats = ["png", "pdf", "svg", "figma", "psd"];
    if (!validFormats.includes(format)) {
      return res.status(400).json({
        error: `Unsupported format: ${format}`,
        supported: validFormats,
      });
    }

    const pdfOptions = {};
    if (format === "pdf") {
      const allowedFormats = ["A3", "A4", "A5", "Legal", "Letter", "Tabloid"];
      pdfOptions.format = allowedFormats.includes(req.body.format) ? req.body.format : "A4";
      pdfOptions.landscape = req.body.landscape === "true" || req.body.landscape === true;
      pdfOptions.printBackground = req.body.printBackground !== "false";
      pdfOptions.headerFooter = req.body.headerFooter !== "false";
      pdfOptions.margin = req.body.margin || "15mm";
    }

    console.log(`[${jobId}] Converting to ${format} (${width}x${height} @${scale}x)`);

    const result = await convertTo(format, fullHtml, {
      width,
      height,
      scale,
      jobId,
      ...pdfOptions,
    });

    const ext = { png: "png", pdf: "pdf", svg: "svg", figma: "fig", psd: "psd" }[format];
    const mime = {
      png: "image/png",
      pdf: "application/pdf",
      svg: "image/svg+xml",
      figma: "application/octet-stream",
      psd: "application/octet-stream",
    }[format];

    res.setHeader("Content-Type", mime);
    res.setHeader("Content-Disposition", `attachment; filename="export.${ext}"`);
    res.setHeader("Content-Length", Buffer.byteLength(result));
    res.send(result);

    console.log(`[${jobId}] OK ${format} (${(Buffer.byteLength(result) / 1024).toFixed(1)}KB)`);
  } catch (err) {
    console.error(`[${jobId}] FAIL ${format}:`, err.message);
    if (req.file) fs.removeSync(req.file.path);
    res.status(500).json({ error: err.message, jobId });
  }
});

app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    if (err.code === "LIMIT_FILE_SIZE") {
      return res.status(413).json({ error: "File too large. Maximum size is 10MB." });
    }
    return res.status(400).json({ error: err.message });
  }
  if (err.message && err.message.includes("Only HTML")) {
    return res.status(400).json({ error: err.message });
  }
  console.error("Unhandled error:", err);
  res.status(500).json({ error: "Internal server error" });
});

const server = app.listen(PORT, async () => {
  console.log(`\n  HTML to Design Converter API v2.0`);
  console.log(`  Running on http://localhost:${PORT}`);
  console.log(`  Health: http://localhost:${PORT}/api/health`);
  console.log(`  Formats: POST /api/convert/:format (png, pdf, svg, figma, psd)`);
  console.log(`  Import:  POST /api/import/url`);
  console.log(`  Rate limit: 10 conversions/min, 5 URL imports/min`);
  console.log(`  Platform: ${process.platform} ${process.arch}\n`);

  try {
    await getPool({ maxConcurrency: process.platform === "win32" ? 2 : 4 }).init();
  } catch (e) {
    console.error("Warning: Could not initialize browser pool:", e.message);
    console.error("Conversions will attempt to launch browsers on-demand.");
  }
});

let shuttingDown = false;
async function gracefulShutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`\n${signal} received. Shutting down gracefully...`);
  try {
    await shutdownPool();
  } catch {}
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 5000);
}

process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => gracefulShutdown("SIGINT"));
process.on("uncaughtException", (err) => {
  console.error("Uncaught exception:", err.message);
});
process.on("unhandledRejection", (reason) => {
  console.error("Unhandled rejection:", reason);
});
