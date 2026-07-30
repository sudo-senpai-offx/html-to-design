const https = require("https");
const http = require("http");
const fs = require("fs");
const path = require("path");
const { computeSHA1, computeSHA1Bytes } = require("./utils");

class AssetManager {
  constructor(cacheDir) {
    this.cacheDir = cacheDir || path.resolve(__dirname, "../.image-cache");
    this.cache = new Map();
    this.pending = new Map();
    if (!fs.existsSync(this.cacheDir)) fs.mkdirSync(this.cacheDir, { recursive: true });
  }

  async download(url) {
    if (this.cache.has(url)) return this.cache.get(url);

    if (this.pending.has(url)) return this.pending.get(url);

    var promise = this._doDownload(url);
    this.pending.set(url, promise);
    try {
      var result = await promise;
      return result;
    } finally {
      this.pending.delete(url);
    }
  }

  async _doDownload(url) {
    var cacheKey = computeSHA1(Buffer.from(url));
    var cachePath = path.join(this.cacheDir, cacheKey + ".img");

    if (fs.existsSync(cachePath)) {
      var buf = fs.readFileSync(cachePath);
      var hash = computeSHA1(buf);
      var hashBytes = computeSHA1Bytes(buf);
      var result = { hash: hash, hashBytes: hashBytes, buffer: buf };
      this.cache.set(url, result);
      return result;
    }

    var lastErr = null;
    for (var attempt = 0; attempt < 3; attempt++) {
      try {
        var buf = await this.fetchUrl(url);
        fs.writeFileSync(cachePath, buf);
        var hash = computeSHA1(buf);
        var hashBytes = computeSHA1Bytes(buf);
        var result = { hash: hash, hashBytes: hashBytes, buffer: buf };
        this.cache.set(url, result);
        return result;
      } catch (e) {
        lastErr = e;
        if (attempt < 2) {
          var delay = Math.pow(2, attempt) * 1000;
          console.error("  WARN: Retry " + (attempt + 1) + "/3 for " + url + " after " + delay + "ms: " + e.message);
          await new Promise(function(r) { setTimeout(r, delay); });
        }
      }
    }
    console.error("  WARN: Failed to download after 3 retries:", url, lastErr.message);
    return null;
  }

  fetchUrl(url, redirectCount) {
    redirectCount = redirectCount || 0;
    if (redirectCount > 5) {
      return Promise.reject(new Error("Too many redirects"));
    }
    var self = this;
    return new Promise(function(resolve, reject) {
      var mod = url.startsWith("https") ? https : http;
      var req = mod.get(url, {
        timeout: 10000,
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
          "Accept": "image/*,*/*",
        },
      }, function(res) {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          var location = res.headers.location;
          if (!location.startsWith("http")) {
            var parsed = new URL(url);
            location = parsed.origin + location;
          }
          res.resume();
          return self.fetchUrl(location, redirectCount + 1).then(resolve).catch(reject);
        }
        if (res.statusCode !== 200) {
          res.resume();
          return reject(new Error("HTTP " + res.statusCode));
        }
        var chunks = [];
        res.on("data", function(c) { chunks.push(c); });
        res.on("end", function() { resolve(Buffer.concat(chunks)); });
        res.on("error", reject);
      });
      req.on("error", reject);
      req.on("timeout", function() { req.destroy(); reject(new Error("timeout")); });
    });
  }

  cleanup(maxAge) {
    maxAge = maxAge || 24 * 60 * 60 * 1000;
    var now = Date.now();
    try {
      var files = fs.readdirSync(this.cacheDir);
      var cleaned = 0;
      for (var file of files) {
        var filePath = path.join(this.cacheDir, file);
        var stat = fs.statSync(filePath);
        if (now - stat.mtimeMs > maxAge) {
          fs.unlinkSync(filePath);
          cleaned++;
        }
      }
      if (cleaned > 0) console.log(`  Cleaned ${cleaned} cached images`);
    } catch (e) {
      console.error("  Cache cleanup error:", e.message);
    }
  }

  injectImageFill(doc, nodeGuid, hashBytes, scaleMode) {
    if (!doc.images) doc.images = new Map();
    var found = null;
    for (var [k, v] of this.cache) {
      if (v.hashBytes && Buffer.from(v.hashBytes).equals(Buffer.from(hashBytes))) {
        found = v;
        break;
      }
    }
    if (found) {
      doc.images.set(found.hash, found.buffer);
    }

    var node = null;
    for (var n of doc.message.nodeChanges) {
      if (n.guid && n.guid.localID === nodeGuid.localID) { node = n; break; }
    }
    if (!node) return;

    node.fillPaints = [{
      type: "IMAGE",
      opacity: 1, visible: true, blendMode: "NORMAL",
      transform: { m00: 1, m01: 0, m02: 0, m10: 0, m11: 1, m12: 0 },
      image: { hash: hashBytes },
      imageScaleMode: scaleMode || "FILL",
    }];
  }
}

module.exports = { AssetManager };
