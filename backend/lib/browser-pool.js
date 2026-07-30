const puppeteer = require("puppeteer");
const os = require("os");

const WIN32 = process.platform === "win32";

const BROWSER_ARGS = [
  "--no-sandbox",
  "--disable-setuid-sandbox",
  "--disable-dev-shm-usage",
  "--disable-gpu",
  "--no-first-run",
  "--disable-extensions",
  "--disable-background-timer-throttling",
  "--disable-backgrounding-occluded-windows",
  "--disable-renderer-backgrounding",
  "--disable-features=TranslateUI",
  "--disable-ipc-flooding-protection",
  "--disable-breakpad",
  "--disable-client-side-phishing-detection",
  "--disable-sync",
  "--no-experiments",
  "--in-process-gpu",
];

if (WIN32) {
  BROWSER_ARGS.push("--disable-features=Win32kLockDown");
}

var DISCONNECT_ERRORS = [
  "Target closed",
  "Connection closed",
  "Browser disconnected",
  "ECONNRESET",
  "ECONNREFUSED",
  "socket hang up",
  "read ECONNRESET",
  "write EPIPE",
  "WebSocket connection closed",
  "Session closed",
  "Protocol error",
];

function isDisconnectError(err) {
  if (!err || !err.message) return false;
  var msg = err.message;
  for (var i = 0; i < DISCONNECT_ERRORS.length; i++) {
    if (msg.includes(DISCONNECT_ERRORS[i])) return true;
  }
  return false;
}

class BrowserPool {
  constructor(options) {
    this.maxConcurrency = options?.maxConcurrency || (WIN32 ? 2 : Math.min(os.cpus().length, 4));
    this.maxTasksPerBrowser = options?.maxTasksPerBrowser || 50;
    this.maxIdleTime = options?.maxIdleTime || 300000;
    this.timeout = options?.timeout || 90000;
    this.browsers = [];
    this.busyBrowsers = new Set();
    this.lastUsedTimestamps = new Map();
    this.queue = [];
    this.initialized = false;
    this._browserCounter = 0;
    this._cleanupInterval = null;
    this._activeTasks = 0;
    this._maxActiveTasks = options?.maxActiveTasks || (this.maxConcurrency * 2);
  }

  async init() {
    if (this.initialized) return;
    console.log("  Browser pool: launching " + this.maxConcurrency + " browser(s) (platform: " + process.platform + ")");
    for (var i = 0; i < this.maxConcurrency; i++) {
      await this._launchBrowser();
    }
    this.initialized = true;
    this._cleanupInterval = setInterval(function() { this._cleanupIdleBrowsers(); }.bind(this), 60000);
    console.log("  Browser pool ready: " + this.browsers.length + " instance(s)");
  }

  async _launchBrowser() {
    var lastErr;
    for (var attempt = 1; attempt <= 3; attempt++) {
      try {
        var browser = await puppeteer.launch({
          headless: "new",
          args: BROWSER_ARGS,
          defaultViewport: null,
        });

        var id = ++this._browserCounter;
        var entry = { id: id, browser: browser, taskCount: 0 };
        this.browsers.push(entry);

        var self = this;
        browser.on("disconnected", function() {
          console.log("  Browser #" + id + " disconnected");
          self.browsers = self.browsers.filter(function(b) { return b.id !== id; });
          self.busyBrowsers.delete(id);
          self.lastUsedTimestamps.delete(id);
          self._refill();
        });

        console.log("  Browser #" + id + " launched");
        return entry;
      } catch (err) {
        lastErr = err;
        console.error("  Browser launch attempt " + attempt + "/3 failed: " + err.message);
        if (attempt < 3) await new Promise(function(r) { setTimeout(r, 2000 * attempt); });
      }
    }
    throw new Error("Failed to launch browser after 3 attempts: " + (lastErr ? lastErr.message : "unknown"));
  }

  async _refill() {
    if (!this.initialized) return;
    var needed = this.maxConcurrency - this.browsers.length;
    for (var i = 0; i < needed; i++) {
      try {
        await this._launchBrowser();
      } catch (err) {
        console.error("  Failed to refill browser pool: " + err.message);
      }
    }
  }

  _getAvailableBrowser() {
    if (this._activeTasks >= this._maxActiveTasks) return null;
    return this.browsers.find(function(b) { return !this.busyBrowsers.has(b.id); }.bind(this));
  }

  _processQueue() {
    if (this.queue.length === 0) return;
    var entry = this._getAvailableBrowser();
    if (!entry) return;
    var item = this.queue.shift();
    if (item && item.resolve) {
      item.resolve(entry);
    }
  }

  async execute(taskFn, options) {
    if (!this.initialized) await this.init();

    var retries = (options && options.retries != null) ? options.retries : 2;
    var retryDelay = (options && options.retryDelay) || 1500;
    var taskTimeout = (options && options.timeout) || this.timeout;

    var lastError;
    for (var attempt = 1; attempt <= retries; attempt++) {
      var entry = this._getAvailableBrowser();
      if (!entry) {
        var queueTimeout = (options && options.queueTimeout) || 60000;
        var waitResult = await new Promise(function(resolve) {
          var item = { resolve: resolve, timer: null };
          item.timer = setTimeout(function() {
            var idx = this.queue.indexOf(item);
            if (idx >= 0) this.queue.splice(idx, 1);
            resolve("__timeout__");
          }.bind(this), queueTimeout);
          this.queue.push(item);
        }.bind(this));

        if (waitResult === "__timeout__") {
          throw new Error("No browser available within " + queueTimeout + "ms (queue full)");
        }
        if (waitResult === null) {
          throw new Error("Browser pool was shut down while waiting for a browser");
        }
        entry = waitResult;
        if (entry.timer) clearTimeout(entry.timer);
      }
      if (!entry || !entry.browser) {
        throw new Error("No browser instance available after queue");
      }

      this.busyBrowsers.add(entry.id);
      this.lastUsedTimestamps.delete(entry.id);
      this._activeTasks++;
      var page;
      try {
        page = await entry.browser.newPage();
        await page.setViewport({ width: 1440, height: 900 });

        var self = this;
        var result = await Promise.race([
          taskFn(page),
          new Promise(function(_, reject) {
            setTimeout(function() { reject(new Error("Task timed out after " + taskTimeout + "ms")); }, taskTimeout);
          }),
        ]);

        entry.taskCount++;
        if (entry.taskCount >= this.maxTasksPerBrowser) {
          await this._recycleBrowser(entry);
        }

        lastError = null;
        return result;
      } catch (err) {
        lastError = err;
        console.error("  Task attempt " + attempt + "/" + retries + " failed: " + err.message);

        if (isDisconnectError(err)) {
          this.busyBrowsers.delete(entry.id);
          await this._recycleBrowser(entry);
          entry = null;
        }

        if (attempt < retries) {
          await new Promise(function(r) { setTimeout(r, retryDelay * attempt); });
        }
      } finally {
        if (page) {
          try { await page.close().catch(function() {}); } catch (e) {}
        }
        if (entry) {
          this.busyBrowsers.delete(entry.id);
          this.lastUsedTimestamps.set(entry.id, Date.now());
        }
        this._activeTasks--;
        this._processQueue();
      }
    }

    throw lastError || new Error("All retry attempts failed");
  }

  _cleanupIdleBrowsers() {
    if (!this.initialized) return;
    var now = Date.now();
    for (var i = this.browsers.length - 1; i >= 0; i--) {
      var entry = this.browsers[i];
      if (this.busyBrowsers.has(entry.id)) continue;
      var lastUsed = this.lastUsedTimestamps.get(entry.id) || 0;
      if (lastUsed > 0 && (now - lastUsed) > this.maxIdleTime && this.browsers.length > 1) {
        console.log("  Browser #" + entry.id + " idle for " + Math.round((now - lastUsed) / 1000) + "s, closing");
        this.browsers.splice(i, 1);
        this.lastUsedTimestamps.delete(entry.id);
        entry.browser.close().catch(function() {});
      }
    }
  }

  async _recycleBrowser(entry) {
    this.browsers = this.browsers.filter(function(b) { return b.id !== entry.id; });
    this.busyBrowsers.delete(entry.id);
    this.lastUsedTimestamps.delete(entry.id);
    try {
      await entry.browser.close();
    } catch (e) {}
    try {
      await this._launchBrowser();
    } catch (err) {
      console.error("  Failed to recycle browser: " + err.message);
    }
  }

  async destroy() {
    this.initialized = false;
    if (this._cleanupInterval) {
      clearInterval(this._cleanupInterval);
      this._cleanupInterval = null;
    }
    var closePromises = this.browsers.map(async function(entry) {
      try {
        await entry.browser.close();
      } catch (e) {}
    });
    await Promise.all(closePromises);
    this.browsers = [];
    this.busyBrowsers.clear();
    this.lastUsedTimestamps.clear();
    while (this.queue.length) {
      var item = this.queue.shift();
      if (item && item.resolve) {
        try { item.resolve(null); } catch (e) {}
        if (item.timer) clearTimeout(item.timer);
      }
    }
  }

  getStats() {
    return {
      total: this.browsers.length,
      busy: this.busyBrowsers.size,
      idle: this.browsers.length - this.busyBrowsers.size,
      queued: this.queue.length,
      activeTasks: this._activeTasks,
    };
  }
}

var sharedPool = null;

function getPool(options) {
  if (!sharedPool) {
    sharedPool = new BrowserPool(options);
  }
  return sharedPool;
}

async function shutdownPool() {
  if (sharedPool) {
    await sharedPool.destroy();
    sharedPool = null;
  }
}

module.exports = { BrowserPool: BrowserPool, getPool: getPool, shutdownPool: shutdownPool };
