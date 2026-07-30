var { getRemoteConnector } = require("./remote-connector");
var { buildStructuredChunks } = require("./structured-chunks");
var { buildConnectorInlinedHtml } = require("./clipboard-writer");
var fs = require("fs");
var path = require("path");
var crypto = require("crypto");

var RESUME_DIR = path.join(__dirname, "..", ".figma-resume");

function ensureResumeDir() {
  try { if (!fs.existsSync(RESUME_DIR)) fs.mkdirSync(RESUME_DIR, { recursive: true }); } catch(e) {}
}

function resumeKey(html, options) {
  var h = crypto.createHash("sha256");
  h.update(html || "");
  if (options && options.flatElements) h.update(String(options.flatElements.length));
  if (options && options.tree && options.tree.element) h.update(String(options.tree.element.w || 0) + "x" + String(options.tree.element.h || 0));
  return h.digest("hex").substring(0, 16);
}

function saveResume(key, state) {
  ensureResumeDir();
  try { fs.writeFileSync(path.join(RESUME_DIR, key + ".json"), JSON.stringify(state)); } catch(e) {}
}

function loadResume(key) {
  ensureResumeDir();
  try {
    var p = path.join(RESUME_DIR, key + ".json");
    if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch(e) {}
  return null;
}

function deleteResume(key) {
  try { var p = path.join(RESUME_DIR, key + ".json"); if (fs.existsSync(p)) fs.unlinkSync(p); } catch(e) {}
}

class FigmaConnector {
  constructor(options) {
    this.local = null;
    this.remote = null;
    this._preferRemote = options && options.preferRemote !== false;
    this._mode = null;
    this._connecting = false;
    this._rendering = false;
    this._renderQueue = [];
    this._onLog = null;
    this._progress = null;
    this._logBuffer = [];
  }

  _log(msg) {
    var entry = { t: new Date().toISOString(), msg: msg };
    this._logBuffer.push(entry);
    if (this._logBuffer.length > 100) this._logBuffer.shift();
    if (this._onLog) this._onLog(msg);
    else console.log("  [FigmaConnector] " + msg);
  }

  async _initLocal() {
    if (!this.local) {
      var LocalImpl = require("./figma-connector-local");
      this.local = new LocalImpl.FigmaConnector();
    }
    return this.local;
  }

  async start() {
    this._connecting = true;

    if (this._preferRemote) {
      try {
        this.remote = getRemoteConnector();
        var started = await this.remote.start();
        if (started) {
          var remoteStatus = await this.remote.getStatus();
          if (remoteStatus.figmaConnected) {
            this._mode = "remote";
            this._connecting = false;
            this._log("Using remote MCP server (figmaConnected)");
            return true;
          }
          this._log("Remote MCP started but Figma not connected — falling back to local");
          await this.remote.stop().catch(function() {});
          this.remote = null;
        }
      } catch (e) {
        this._log("Remote connector unavailable (" + e.message + ") — falling back to local");
      }
    }

    try {
      var localConn = await this._initLocal();
      var started = await localConn.start();
      if (started) {
        this._mode = "local";
        this._connecting = false;
        this._log("Using local connector (auto-chunking for large payloads)");
        return true;
      }
    } catch (e) {
      this._log("Local connector failed: " + e.message);
    }

    this._connecting = false;
    return false;
  }

  async _sendChunk(chunk, name, options) {
    await this.local.renderHtml(chunk, name, options);
  }

  async renderHtml(html, name, options) {
    if (!this._mode) throw new Error("Connector not started. Call start() first.");

    return new Promise(function(resolve, reject) {
      this._renderQueue.push({ html: html, name: name, options: options, resolve: resolve, reject: reject });
      this._processQueue();
    }.bind(this));
  }

  async _processQueue() {
    if (this._rendering || this._renderQueue.length === 0) return;
    this._rendering = true;

    while (this._renderQueue.length > 0) {
      var job = this._renderQueue[0];

      try {
        var result = await this._executeRender(job.html, job.name, job.options);
        job.resolve(result);
      } catch (err) {
        job.reject(err);
      }

      this._renderQueue.shift();
    }

    this._rendering = false;
  }

  async _executeRender(html, name, options) {
    this._log("Rendering (mode=" + this._mode + ")...");

    if (this._mode === "remote") {
      try {
        return await this.remote.renderHtml(html, name, options);
      } catch (e) {
        this._log("Remote render failed (" + e.message + ") — falling back to local with chunking");
        this._mode = "local";
        var localConn = await this._initLocal();
        var started = await localConn.start();
        if (!started) throw new Error("Local connector also unavailable");
      }
    }

    if (this._mode === "local") {
      var chunks = [];
      var chunkMeta = null;
      var rKey = null;

      if (options && options.flatElements && options.tree) {
        var sc = buildStructuredChunks(options.flatElements, options.tree);
        chunkMeta = sc;
        for (var si = 0; si < sc.length; si++) chunks.push(sc[si].html);
        this._log("Structured: " + sc.length + " chunks, " + options.flatElements.length + " elements, priority: outer\u2192inner \u2192 L\u2192R \u2192 T\u2192B");
      } else if (html) {
        var safeHtml = html.replace(/mix-blend-mode[^;]+;/g, "").replace(/backdrop-filter[^;]+;/g, "").replace(/clip-path[^;]+;/g, "").replace(/shape-outside[^;]+;/g, "").replace(/filter[^;]+;/g, "").replace(/-webkit-[^;]+;/g, "").replace(/container-[^;]+;/g, "").replace(/mask-[^;]+;/g, "").replace(/scroll-margin[^;]+;/g, "").replace(/scroll-padding[^;]+;/g, "");

        if (safeHtml.length <= 17000) {
          chunks = [safeHtml];
          this._log("Direct: 1 chunk, " + safeHtml.length + " chars");
        } else {
          chunks = this._splitHtml(safeHtml);
          this._log("Direct: " + chunks.length + " chunks (split from " + safeHtml.length + " chars)");
        }
      } else {
        throw new Error("No HTML or tree data provided for rendering");
      }

      if (chunks.length === 0) throw new Error("No chunks generated");

      var resumeState = rKey ? loadResume(rKey) : null;
      var startIndex = 0;
      if (resumeState && resumeState.sentCount > 0 && resumeState.total === chunks.length) {
        startIndex = resumeState.sentCount;
        this._log("Resuming from chunk " + (startIndex + 1) + "/" + chunks.length + " (previous send was interrupted)");
      }

      if (chunks.length === 1) {
        this._progress = { current: 1, total: 1, phase: "sending", chunks: chunkMeta };
        try {
          this._log("Sending \"" + name + "\" (" + chunks[0].length + "B)...");
          await this._sendChunk(chunks[0], name, options);
          if (rKey) deleteResume(rKey);
          this._progress = null;
          return true;
        } finally {
          this._progress = null;
        }
      }

      this._progress = { current: startIndex, total: chunks.length, phase: "sending", chunks: chunkMeta };

      if (rKey) saveResume(rKey, { sentCount: startIndex, total: chunks.length, key: rKey, timestamp: Date.now() });

      var lastErr;
      var burstCount = 0;

      for (var ci = startIndex; ci < chunks.length; ci++) {
        if (!this._mode || this._mode === "stopping") {
          this._log("Render interrupted at chunk " + (ci + 1) + "/" + chunks.length);
          if (rKey) saveResume(rKey, { sentCount: ci, total: chunks.length, key: rKey, timestamp: Date.now() });
          throw new Error("Render interrupted");
        }

        try {
          this._progress.current = ci + 1;
          var label = chunkMeta ? chunkMeta[ci].label : "Chunk " + (ci + 1) + "/" + chunks.length;
          this._log("Sending " + label + " (" + chunks[ci].length + "B" + (chunkMeta ? ", " + chunkMeta[ci].elementCount + " elements" : "") + ")...");

          if (burstCount >= 3) {
            await new Promise(function(r) { setTimeout(r, 100); });
            burstCount = 0;
          }
          await this._sendChunk(chunks[ci], name, options);
          burstCount++;

          if (rKey) saveResume(rKey, { sentCount: ci + 1, total: chunks.length, key: rKey, timestamp: Date.now() });
        } catch (err) {
          var errLabel = chunkMeta ? chunkMeta[ci].label : "Chunk " + (ci + 1) + "/" + chunks.length;
          this._log(errLabel + " failed: " + err.message);

          var retryDelay = 300;
          var recovered = false;
          for (var retry = 1; retry <= 2; retry++) {
            this._log("Retry " + retry + "/2 for " + errLabel + " in " + retryDelay + "ms...");
            await new Promise(function(r) { setTimeout(r, retryDelay); });
            try {
              await this._sendChunk(chunks[ci], name, options);
              burstCount++;
              if (rKey) saveResume(rKey, { sentCount: ci + 1, total: chunks.length, key: rKey, timestamp: Date.now() });
              lastErr = null;
              recovered = true;
              break;
            } catch (retryErr) {
              lastErr = retryErr;
              retryDelay = Math.min(retryDelay * 2, 3000);
            }
          }

          if (!recovered) {
            if (this._progress) this._progress.errors = (this._progress.errors || 0) + 1;
          }
        }
      }

      if (rKey && !lastErr) deleteResume(rKey);
      this._progress = null;

      if (lastErr) {
        this._log("One or more chunks failed. For reliable single-frame delivery, use clipboard paste instead.");
        throw new Error("Chunked render failed: " + lastErr.message);
      }
      return { chunked: true, chunks: chunks.length, meta: chunkMeta };
    }

    throw new Error("No connector mode available");
  }

  async proposeDesignSystem(designSystem) {
    if (this._mode === "remote") {
      return await this.remote.proposeDesignSystem(designSystem);
    }
    var localConn = await this._initLocal();
    return await localConn.proposeDesignSystem(designSystem);
  }

  async getStatus() {
    if (this._mode === "remote") {
      var rs = await this.remote.getStatus();
      return { running: rs.running, initialized: rs.initialized, figmaConnected: rs.figmaConnected, mode: "remote", pid: null, progress: null, connection: null, logs: this._logBuffer };
    }
    if (this.local) {
      var ls = await this.local.getStatus();
      return { running: ls.running, initialized: ls.initialized, figmaConnected: ls.figmaConnected, mode: ls.mode || "local", pid: ls.pid, progress: this._progress, connection: ls.connection || null, logs: this._logBuffer };
    }
    return { running: false, initialized: false, figmaConnected: false, mode: null, pid: null, progress: null, connection: null, logs: this._logBuffer };
  }

  _splitHtml(html) {
    var MAX = 7000;
    var chunks = [];
    var depth = 0;
    var start = 0;
    var tagRe = /<\/?div\b[^>]*>/g;
    var lastIdx = 0;

    while (lastIdx < html.length) {
      tagRe.lastIndex = lastIdx;
      var match = tagRe.exec(html);
      if (!match) break;
      var tag = match[0];
      lastIdx = tagRe.lastIndex;

      if (tag[1] === '/') {
        depth--;
        if (depth === 0) {
          var chunkLen = lastIdx - start;
          if (chunkLen >= MAX) {
            chunks.push(html.slice(start, lastIdx));
            start = lastIdx;
          }
        }
      } else {
        depth++;
      }
    }

    var remaining = html.slice(start);
    if (remaining.length > 0) {
      if (remaining.length <= MAX) {
        chunks.push(remaining);
      } else if (chunks.length > 0) {
        chunks[chunks.length - 1] += remaining;
      } else {
        chunks.push(remaining);
      }
    }

    return chunks.length > 0 ? chunks : [html];
  }

  async stop() {
    if (this._mode === "local" && this.local) {
      this._mode = "stopping";
    }
    this._renderQueue = [];
    if (this.remote) { try { await this.remote.stop(); } catch (e) {} this.remote = null; }
    if (this.local) { try { await this.local.stop(); } catch (e) {} this.local = null; }
    this._mode = null;
    this._connecting = false;
    this._progress = null;
    this._logBuffer = [];
  }
}

var _instance = null;

function getConnector() {
  if (!_instance) _instance = new FigmaConnector();
  return _instance;
}

async function stopConnector() {
  if (_instance) {
    await _instance.stop();
    _instance = null;
  }
}

module.exports = { FigmaConnector: FigmaConnector, getConnector: getConnector, stopConnector: stopConnector };
