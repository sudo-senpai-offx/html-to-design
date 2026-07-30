var { spawn } = require("child_process");

class FigmaConnector {
  constructor() {
    this.process = null;
    this.requestId = 0;
    this.pendingRequests = new Map();
    this.initialized = false;
    this.figmaConnected = false;
    this.starting = false;
    this._autoRestart = true;
    this._stopping = false;
    this._restartCooldown = 0;
    this._restartCount = 0;
    this._onLog = null;
    this._stdoutBuf = "";
    this._metrics = {
      lastConnected: null,
      lastDisconnected: null,
      reconnectCount: 0,
      stableSince: null,
    };
    this._stableCheckTimer = null;
  }

  _log(msg) {
    if (this._onLog) this._onLog(msg);
    else console.log("  [FigmaConnector] " + msg);
  }

  _updateMetrics(connected) {
    var now = new Date().toISOString();
    if (connected) {
      this._metrics.reconnectCount++;
      this._metrics.lastConnected = now;
      this._metrics.stableSince = now;
      if (this._stableCheckTimer) { clearTimeout(this._stableCheckTimer); this._stableCheckTimer = null; }
      this._stableCheckTimer = setTimeout(function(self) {
        self._stableCheckTimer = null;
      }, 5000, this);
    } else {
      this._metrics.lastDisconnected = now;
      this._metrics.stableSince = null;
      if (this._stableCheckTimer) { clearTimeout(this._stableCheckTimer); this._stableCheckTimer = null; }
    }
  }

  async start() {
    if (this.process && !this.process.killed) {
      this._log("Already running (pid=" + this.process.pid + ")");
      return true;
    }
    if (this._stopping) {
      this._log("Currently stopping — reject start");
      return false;
    }
    if (this.starting) {
      this._log("Already starting...");
      return false;
    }
    this._autoRestart = true;
    this.starting = true;
    this.initialized = false;
    this.figmaConnected = false;

    try {
      await this._spawnProcess();
      await this._initialize();
      this.starting = false;
      this._restartCount = 0;
      return true;
    } catch (err) {
      this.starting = false;
      this._log("Start failed: " + err.message);
      return false;
    }
  }

  _spawnProcess() {
    var self = this;
    return new Promise(function(resolve, reject) {
      self._log("Launching @ai.to.design/figma-connector...");
      self._stdoutBuf = "";
      self._metrics.reconnectCount = 0;
      self._metrics.lastConnected = null;
      self._metrics.lastDisconnected = null;
      self._metrics.stableSince = null;
      var resolved = false;

      self.process = spawn("npx -y @ai.to.design/figma-connector@latest", [], {
        stdio: ["pipe", "pipe", "pipe"],
        env: { ...process.env },
        shell: true,
      });

      var startupTimeout = setTimeout(function() {
        if (!resolved) {
          resolved = true;
          reject(new Error("Connector startup timed out after 30s"));
        }
      }, 30000);

      self.process.stdout.on("data", function(chunk) {
        self._stdoutBuf += chunk.toString();
        var nlIdx;
        while ((nlIdx = self._stdoutBuf.indexOf("\n")) !== -1) {
          var line = self._stdoutBuf.substring(0, nlIdx);
          self._stdoutBuf = self._stdoutBuf.substring(nlIdx + 1);
          if (line.trim()) self._handleMessage(line);
        }
        if (!resolved && self._stdoutBuf.length > 10) {
          resolved = true;
          clearTimeout(startupTimeout);
          resolve();
        }
      });

      self.process.stderr.on("data", function(data) {
        var msg = data.toString().trim();
        if (msg) {
          self._log("[stderr] " + msg);
          if (msg.includes("Figma connected") || msg.includes("session accepted")) {
            self.figmaConnected = true;
            self._updateMetrics(true);
          }
          if (msg.includes("session closed") || msg.includes("Figma disconnected")) {
            self.figmaConnected = false;
            self._updateMetrics(false);
          }
        }
        if (!resolved && msg.includes("ready")) {
          resolved = true;
          clearTimeout(startupTimeout);
          resolve();
        }
      });

      self.process.on("error", function(err) {
        if (!resolved) {
          resolved = true;
          clearTimeout(startupTimeout);
          reject(err);
        }
      });

      self.process.on("exit", function(code, signal) {
        if (!resolved) {
          resolved = true;
          clearTimeout(startupTimeout);
          reject(new Error("Process exited before ready (code=" + code + ", signal=" + signal + ")"));
        }
        self._log("Process exited (code=" + code + ", signal=" + signal + ")");
        self.process = null;
        self.initialized = false;
        self.figmaConnected = false;
        self._stdoutBuf = "";
        self._drainPending("Connector process exited");
        if (signal === "SIGTERM") {
          self._log("Process killed intentionally — no auto-restart");
          return;
        }
        if (!self._autoRestart) return;
        var now = Date.now();
        if (now < self._restartCooldown) {
          self._log("Restart cooldown active — skipping auto-restart");
          return;
        }
        self._restartCount++;
        if (self._restartCount > 5) {
          self._log("Too many restarts (" + self._restartCount + ") — giving up");
          self._autoRestart = false;
          return;
        }
        var delay = Math.min(2000 * self._restartCount, 15000);
        self._restartCooldown = now + 60000;
        self._log("Auto-restarting in " + delay + "ms (attempt " + self._restartCount + "/5)...");
        setTimeout(function(c) { c.start().catch(function(e) { c._log("Auto-restart failed: " + e.message); }); }, delay, self);
      });
    });
  }

  async _initialize() {
    var result = await this._sendRequest("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: { tools: {} },
      clientInfo: { name: "html-to-design", version: "3.0.0" },
    }, 15000);

    if (result) {
      this.initialized = true;
      this._log("MCP protocol initialized");
    }

    await this._sendRequest("notifications/initialized", {}, 5000).catch(function() {});
  }

  _sendRequest(method, params, timeout) {
    if (!this.process || this.process.killed) {
      throw new Error("Connector not running");
    }

    var id = ++this.requestId;
    var request = { jsonrpc: "2.0", id: id, method: method, params: params || {} };
    var payload = JSON.stringify(request);

    var self = this;
    return new Promise(function(resolve, reject) {
      var timer = setTimeout(function() {
        self.pendingRequests.delete(id);
        reject(new Error("Request timed out: " + method));
      }, timeout || 30000);

      self.pendingRequests.set(id, { resolve: resolve, reject: reject, timer: timer });

      try {
        var written = self.process.stdin.write(payload + "\n");
        if (written === false) {
          self.process.stdin.once("drain", function() {});
        }
      } catch (err) {
        clearTimeout(timer);
        self.pendingRequests.delete(id);
        reject(err);
      }
    });
  }

  _handleMessage(line) {
    try {
      var message = JSON.parse(line);
    } catch (e) {
      this._log("JSON parse error (" + line.length + " chars): " + e.message);
      return;
    }

    if (message.id != null && this.pendingRequests.has(message.id)) {
      var pending = this.pendingRequests.get(message.id);
      this.pendingRequests.delete(message.id);
      if (pending.timer) clearTimeout(pending.timer);

      if (message.error) {
        pending.reject(new Error(message.error.message || JSON.stringify(message.error)));
      } else {
        pending.resolve(message.result);
      }
    }

    if (message.method === "notifications/tools/list_changed") {
      this._log("Tools list changed");
    }

    if (message.method === "notifications/figma_connected") {
      this.figmaConnected = true;
      this._updateMetrics(true);
      this._log("Figma connected (notification)");
    }

    if (message.method === "notifications/figma_disconnected") {
      this.figmaConnected = false;
      this._updateMetrics(false);
      this._log("Figma disconnected (notification)");
    }
  }

  _drainPending(reason) {
    for (var [id, pending] of this.pendingRequests) {
      if (pending.timer) clearTimeout(pending.timer);
      pending.reject(new Error(reason));
    }
    this.pendingRequests.clear();
  }

  async listTools() {
    if (!this.initialized) throw new Error("Connector not initialized");
    var result = await this._sendRequest("tools/list", {}, 10000);
    return result && result.tools ? result.tools : [];
  }

  async renderHtml(html, name, options) {
    if (!this.initialized) throw new Error("Connector not initialized. Call start() first.");

    var args = { html: html, name: name || "HTML Export" };
    if (options && options.designSystem) args.designSystem = true;

    var inlineCount = (html.match(/style="/g) || []).length;
    this._log("Rendering HTML in Figma (" + html.length + " chars, " + inlineCount + " inline styles, designSystem=" + !!options.designSystem + ")...");

    try {
      var result = await this._sendRequest("tools/call", {
        name: "render_html",
        arguments: args,
      }, 180000);

      this._log("Render complete");
      return result;
    } catch (err) {
      this._log("Render failed: " + err.message);
      throw err;
    }
  }

  async proposeDesignSystem(designSystem) {
    if (!this.initialized) throw new Error("Connector not initialized. Call start() first.");

    this._log("Proposing design system: " + designSystem.name + " (" + designSystem.colors.length + " colors, " + designSystem.typography.length + " type styles, " + designSystem.spacing.length + " spacing tokens)...");

    try {
      var result = await this._sendRequest("tools/call", {
        name: "propose_design_system",
        arguments: designSystem,
      }, 30000);

      this._log("Design system proposed — user will confirm in plugin");
      return result;
    } catch (err) {
      this._log("Design system proposal failed: " + err.message);
      throw err;
    }
  }

  async getStatus() {
    var running = !!(this.process && !this.process.killed);
    var figmaConnected = this.figmaConnected;
    var initialized = this.initialized;

    if (running && !this.initialized) {
      try {
        await this._sendRequest("ping", {}, 3000);
        this.initialized = true;
        initialized = true;
      } catch (e) {}
    }

    var stability = null;
    var stableSince = this._metrics.stableSince;
    if (figmaConnected && stableSince) {
      var elapsed = Date.now() - new Date(stableSince).getTime();
      if (elapsed < 3000) stability = "connecting";
      else if (elapsed < 10000) stability = "stable";
      else stability = "stable";
    }

    return {
      running: running,
      initialized: initialized,
      figmaConnected: figmaConnected,
      pid: this.process ? this.process.pid : null,
      mode: "local",
      connection: {
        connected: figmaConnected,
        stableSince: stableSince,
        stability: stability,
        lastConnected: this._metrics.lastConnected,
        lastDisconnected: this._metrics.lastDisconnected,
        reconnectCount: this._metrics.reconnectCount,
      },
    };
  }

  async stop() {
    this._stopping = true;
    if (this.process) {
      this._log("Stopping connector...");
      this._drainPending("Connector stopping");
      try { this.process.kill(); } catch (e) {}
      this.process = null;
      this.initialized = false;
      this.figmaConnected = false;
      this._stdoutBuf = "";
      this._metrics.stableSince = null;
      this._log("Stopped");
    }
    this._stopping = false;
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