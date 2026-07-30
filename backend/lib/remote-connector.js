var { spawn } = require("child_process");
var path = require("path");
var os = require("os");
var fs = require("fs-extra");

var REMOTE_MCP_URL = "https://mcp.to.design";
var REMOTE_TIMEOUT = 180000;
var MAX_REMOTE_HTML_SIZE = 500000;

class RemoteConnector {
  constructor() {
    this.process = null;
    this.requestId = 0;
    this.pendingRequests = new Map();
    this.initialized = false;
    this.figmaConnected = false;
    this.tools = [];
    this._stdoutBuf = "";
    this._starting = false;
  }

  async start() {
    if (this.process && !this.process.killed && this.initialized) return true;
    if (this._starting) return false;
    this._starting = true;

    try {
      var result = await this._tryDirectHttp();
      if (result) {
        this._starting = false;
        return true;
      }
    } catch (e) {
      console.log("  [RemoteConnector] Direct HTTP failed (" + e.message + ") — falling back to mcp-remote bridge");
    }

    try {
      await this._spawnBridge();
      await this._initialize();
      this._starting = false;
      return true;
    } catch (err) {
      this._starting = false;
      console.error("  [RemoteConnector] Start failed: " + err.message);
      return false;
    }
  }

  async _tryDirectHttp() {
    var OAuthEndpoint = REMOTE_MCP_URL + "/.well-known/oauth-protected-resource";
    var resp = await fetch(OAuthEndpoint, { method: "HEAD", signal: AbortSignal.timeout(5000) });
    if (!resp.ok) throw new Error("Remote MCP server unreachable: " + resp.status);

    var configPath = this._getConfigPath();
    if (await fs.pathExists(configPath)) {
      var config = await fs.readJson(configPath);
      if (config.clientId && config.clientSecret) {
        this._config = config;
        this._transport = "http";
        this.initialized = true;
        this.figmaConnected = true;
        console.log("  [RemoteConnector] Using direct HTTP with service account credentials");
        return true;
      }
      if (config.refreshToken) {
        this._config = config;
        this._transport = "http";
        this.initialized = true;
        this.figmaConnected = true;
        console.log("  [RemoteConnector] Using direct HTTP with refresh token");
        return true;
      }
    }
    throw new Error("No service account credentials configured. Create ~/.html-to-design/mcp-config.json or use the mcp-remote bridge.");
  }

  _getConfigPath() {
    return path.join(os.homedir(), ".html-to-design", "mcp-config.json");
  }

  async _spawnBridge() {
    var self = this;
    return new Promise(function(resolve, reject) {
      console.log("  [RemoteConnector] Spawning mcp-remote bridge to " + REMOTE_MCP_URL + "...");

      var cmd = "npx -y mcp-remote " + REMOTE_MCP_URL;
      var resolved = false;

      self.process = spawn(cmd, [], {
        stdio: ["pipe", "pipe", "pipe"],
        env: { ...process.env },
        shell: true,
      });

      var startupTimeout = setTimeout(function() {
        if (!resolved) {
          resolved = true;
          reject(new Error("mcp-remote bridge startup timed out after 30s"));
        }
      }, 30000);

      function onReady() {
        if (!resolved) {
          resolved = true;
          clearTimeout(startupTimeout);
          console.log("  [RemoteConnector] Bridge ready");
          resolve();
        }
      }

      self.process.stdout.on("data", function(chunk) {
        self._stdoutBuf += chunk.toString();
        var nlIdx;
        while ((nlIdx = self._stdoutBuf.indexOf("\n")) !== -1) {
          var line = self._stdoutBuf.substring(0, nlIdx);
          self._stdoutBuf = self._stdoutBuf.substring(nlIdx + 1);
          if (line.trim()) self._handleMessage(line);
        }
        if (!resolved && self._stdoutBuf.length > 20) {
          onReady();
        }
      });

      self.process.stderr.on("data", function(data) {
        var msg = data.toString().trim();
        if (msg) {
          console.log("  [RemoteConnector:bridge] " + msg);
          if (msg.includes("Figma connected") || msg.includes("ready") || msg.includes("listening")) {
            self.figmaConnected = true;
          }
          if (msg.includes("Authorization required") || msg.includes("Open this link")) {
            self.figmaConnected = false;
          }
          if (msg.includes("Proxy established") || msg.includes("STDIO server running")) {
            onReady();
          }
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
        console.log("  [RemoteConnector] Bridge exited (code=" + code + ", signal=" + signal + ")");
        self.process = null;
        self.initialized = false;
        self.figmaConnected = false;
        self._stdoutBuf = "";
        self._drainPending("Bridge exited (code=" + code + ")");
        if (!resolved) {
          resolved = true;
          clearTimeout(startupTimeout);
          reject(new Error("mcp-remote bridge exited before ready (code=" + code + ")"));
        }
      });

      self.process.on("spawn", function() {
        var msg = self._stdoutBuf.trim();
        if (msg.length > 0) onReady();
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
      console.log("  [RemoteConnector] MCP protocol initialized");
    }

    await this._sendRequest("notifications/initialized", {}, 5000).catch(function() {});

    try {
      var toolsResult = await this._sendRequest("tools/list", {}, 10000);
      if (toolsResult && toolsResult.tools) {
        this.tools = toolsResult.tools;
        console.log("  [RemoteConnector] Available tools: " + this.tools.map(function(t) { return t.name; }).join(", "));
      }
    } catch (e) {
      console.log("  [RemoteConnector] Could not list tools (continuing): " + e.message);
    }
  }

  async _getAccessToken() {
    if (!this._config) return null;
    if (this._accessToken && Date.now() < this._tokenExpiry) return this._accessToken;

    var cfg = this._config;

    if (cfg.clientId && cfg.clientSecret) {
      var body = new URLSearchParams();
      body.append("grant_type", "client_credentials");
      body.append("resource", REMOTE_MCP_URL);
      body.append("scope", "mcp");

      var resp = await fetch(REMOTE_MCP_URL + "/token", {
        method: "POST",
        headers: {
          "Authorization": "Basic " + Buffer.from(cfg.clientId + ":" + cfg.clientSecret).toString("base64"),
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: body.toString(),
      });

      if (!resp.ok) throw new Error("Token request failed: " + resp.status);
      var data = await resp.json();
      this._accessToken = data.access_token;
      this._tokenExpiry = Date.now() + (data.expires_in - 60) * 1000;
      return this._accessToken;
    }

    if (cfg.refreshToken) {
      if (!cfg.clientId) throw new Error("client_id required for refresh token flow");
      var rtBody = new URLSearchParams();
      rtBody.append("grant_type", "refresh_token");
      rtBody.append("refresh_token", cfg.refreshToken);
      rtBody.append("resource", REMOTE_MCP_URL);

      var rtResp = await fetch(REMOTE_MCP_URL + "/token", {
        method: "POST",
        headers: {
          "Authorization": "Basic " + Buffer.from(cfg.clientId + ":" + (cfg.clientSecret || "")).toString("base64"),
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: rtBody.toString(),
      });

      if (!rtResp.ok) throw new Error("Token refresh failed: " + rtResp.status);
      var rtData = await rtResp.json();
      this._accessToken = rtData.access_token;
      this._tokenExpiry = Date.now() + (rtData.expires_in - 60) * 1000;
      return this._accessToken;
    }

    return null;
  }

  async renderHtml(html, name, options) {
    if (!this.initialized) throw new Error("Connector not initialized");

    if (html.length > MAX_REMOTE_HTML_SIZE) {
      throw new Error("HTML too large for remote connector (" + html.length + "B > " + MAX_REMOTE_HTML_SIZE + "B limit) — use local connector with chunking");
    }

    var inlineCount = (html.match(/style="/g) || []).length;
    console.log("  [RemoteConnector] Sending HTML to remote server (" + html.length + " chars, " + inlineCount + " inline styles)...");

    try {
      var args = { html: html, name: name || "HTML Export" };
      if (options && options.designSystem) args.designSystem = true;

      var result;

      if (this._transport === "http") {
        result = await this._httpCallTool("import-html", args);
      } else {
        result = await this._sendRequest("tools/call", {
          name: "import-html",
          arguments: args,
        }, REMOTE_TIMEOUT);
      }

      console.log("  [RemoteConnector] Render complete via remote server");
      return result;
    } catch (err) {
      console.error("  [RemoteConnector] Remote render failed (" + err.message + ") — falling back to local render");
      throw err;
    }
  }

  async proposeDesignSystem(designSystem) {
    if (!this.initialized) throw new Error("Connector not initialized");

    console.log("  [RemoteConnector] Proposing design system: " + designSystem.name + "...");

    try {
      var result;

      if (this._transport === "http") {
        result = await this._httpCallTool("propose_design_system", designSystem);
      } else {
        result = await this._sendRequest("tools/call", {
          name: "propose_design_system",
          arguments: designSystem,
        }, 30000);
      }

      console.log("  [RemoteConnector] Design system proposed");
      return result;
    } catch (err) {
      console.error("  [RemoteConnector] Design system proposal failed (" + err.message + ")");
      throw err;
    }
  }

  async _httpCallTool(toolName, args) {
    var token = await this._getAccessToken();
    if (!token) throw new Error("No access token available - check ~/.html-to-design/mcp-config.json");

    var request = {
      jsonrpc: "2.0",
      id: ++this.requestId,
      method: "tools/call",
      params: {
        name: toolName,
        arguments: args,
      },
    };

    var resp = await fetch(REMOTE_MCP_URL + "/mcp", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": "Bearer " + token,
      },
      body: JSON.stringify(request),
      signal: AbortSignal.timeout(REMOTE_TIMEOUT),
    });

    if (!resp.ok) {
      var errText = await resp.text().catch(function() { return resp.statusText; });
      throw new Error("MCP call failed: " + resp.status + " " + errText);
    }

    var data = await resp.json();
    if (data.error) throw new Error(data.error.message || JSON.stringify(data.error));
    return data.result;
  }

  async getStatus() {
    var running = !!(this.process && !this.process.killed) || this._transport === "http";
    var figmaConnected = this.figmaConnected;
    var initialized = this.initialized;

    if (this._transport === "http") {
      initialized = true;
      figmaConnected = true;
    }

    return {
      running: running,
      initialized: initialized,
      figmaConnected: figmaConnected,
      remote: this._transport === "http",
      tools: this.tools.map(function(t) { return t.name; }),
    };
  }

  async stop() {
    if (this.process) {
      console.log("  [RemoteConnector] Stopping bridge...");
      this._drainPending("Connector stopping");
      try { this.process.kill(); } catch (e) {}
      this.process = null;
      this.initialized = false;
      this.figmaConnected = false;
      this._stdoutBuf = "";
    }
    this.initialized = false;
  }

  _sendRequest(method, params, timeout) {
    if (!this.process || this.process.killed) {
      throw new Error("Bridge not running");
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
      console.log("  [RemoteConnector] Tools list changed");
    }
    if (message.method === "notifications/figma_connected") {
      this.figmaConnected = true;
      console.log("  [RemoteConnector] Figma connected via remote");
    }
    if (message.method === "notifications/figma_disconnected") {
      this.figmaConnected = false;
      console.log("  [RemoteConnector] Figma disconnected");
    }
  }

  _drainPending(reason) {
    for (var entry of this.pendingRequests) {
      var pending = entry[1];
      if (pending.timer) clearTimeout(pending.timer);
      pending.reject(new Error(reason));
    }
    this.pendingRequests.clear();
  }
}

var _remoteInstance = null;

function getRemoteConnector() {
  if (!_remoteInstance) _remoteInstance = new RemoteConnector();
  return _remoteInstance;
}

async function stopRemoteConnector() {
  if (_remoteInstance) {
    await _remoteInstance.stop();
    _remoteInstance = null;
  }
}

module.exports = { RemoteConnector: RemoteConnector, getRemoteConnector: getRemoteConnector, stopRemoteConnector: stopRemoteConnector };