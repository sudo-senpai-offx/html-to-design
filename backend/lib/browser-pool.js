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

class BrowserPool {
  constructor(options) {
    this.maxConcurrency = options?.maxConcurrency || (WIN32 ? 2 : Math.min(os.cpus().length, 4));
    this.maxTasksPerBrowser = options?.maxTasksPerBrowser || 50;
    this.timeout = options?.timeout || 60000;
    this.browsers = [];
    this.busyBrowsers = new Set();
    this.queue = [];
    this.initialized = false;
    this._browserCounter = 0;
  }

  async init() {
    if (this.initialized) return;
    console.log(`  Browser pool: launching ${this.maxConcurrency} browser(s) (platform: ${process.platform})`);
    for (let i = 0; i < this.maxConcurrency; i++) {
      await this._launchBrowser();
    }
    this.initialized = true;
    console.log(`  Browser pool ready: ${this.browsers.length} instance(s)`);
  }

  async _launchBrowser() {
    let lastErr;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const browser = await puppeteer.launch({
          headless: "new",
          args: BROWSER_ARGS,
          defaultViewport: null,
        });

        const id = ++this._browserCounter;
        const entry = { id, browser, taskCount: 0 };
        this.browsers.push(entry);

        browser.on("disconnected", () => {
          console.log(`  Browser #${id} disconnected`);
          this.browsers = this.browsers.filter(b => b.id !== id);
          this.busyBrowsers.delete(id);
          this._refill();
        });

        console.log(`  Browser #${id} launched`);
        return entry;
      } catch (err) {
        lastErr = err;
        console.error(`  Browser launch attempt ${attempt}/3 failed: ${err.message}`);
        if (attempt < 3) await new Promise(r => setTimeout(r, 2000 * attempt));
      }
    }
    throw new Error(`Failed to launch browser after 3 attempts: ${lastErr?.message}`);
  }

  async _refill() {
    if (!this.initialized) return;
    const needed = this.maxConcurrency - this.browsers.length;
    for (let i = 0; i < needed; i++) {
      try {
        await this._launchBrowser();
      } catch (err) {
        console.error(`  Failed to refill browser pool: ${err.message}`);
      }
    }
  }

  _getAvailableBrowser() {
    return this.browsers.find(b => !this.busyBrowsers.has(b.id));
  }

  async execute(taskFn, options) {
    if (!this.initialized) await this.init();

    const retries = options?.retries || 3;
    const retryDelay = options?.retryDelay || 1000;

    let lastError;
    for (let attempt = 1; attempt <= retries; attempt++) {
      let entry = this._getAvailableBrowser();
      if (!entry) {
        await new Promise(resolve => this.queue.push(resolve));
        entry = this._getAvailableBrowser();
      }
      if (!entry) {
        throw new Error("No browser instance available after queue");
      }

      this.busyBrowsers.add(entry.id);
      let page;
      try {
        page = await entry.browser.newPage();
        await page.setViewport({ width: 1440, height: 900 });

        const result = await Promise.race([
          taskFn(page),
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error("Task timed out")), options?.timeout || this.timeout)
          ),
        ]);

        entry.taskCount++;
        if (entry.taskCount >= this.maxTasksPerBrowser) {
          await this._recycleBrowser(entry);
        }

        lastError = null;
        return result;
      } catch (err) {
        lastError = err;
        console.error(`  Task attempt ${attempt}/${retries} failed: ${err.message}`);

        if (err.message.includes("Target closed") || err.message.includes("Connection closed") || err.message.includes("Browser disconnected")) {
          this.busyBrowsers.delete(entry.id);
          await this._recycleBrowser(entry);
        }

        if (attempt < retries) {
          await new Promise(r => setTimeout(r, retryDelay * attempt));
        }
      } finally {
        if (page && !page.isClosed()) {
          await page.close().catch(() => {});
        }
        this.busyBrowsers.delete(entry.id);
        if (this.queue.length) this.queue.shift()();
      }
    }

    throw lastError || new Error("All retry attempts failed");
  }

  async _recycleBrowser(entry) {
    this.browsers = this.browsers.filter(b => b.id !== entry.id);
    this.busyBrowsers.delete(entry.id);
    try {
      await entry.browser.close();
    } catch {}
    try {
      await this._launchBrowser();
    } catch (err) {
      console.error(`  Failed to recycle browser: ${err.message}`);
    }
  }

  async destroy() {
    this.initialized = false;
    const closePromises = this.browsers.map(async (entry) => {
      try {
        await entry.browser.close();
      } catch {}
    });
    await Promise.all(closePromises);
    this.browsers = [];
    this.busyBrowsers.clear();
    this.queue.forEach(resolve => resolve());
    this.queue = [];
  }

  getStats() {
    return {
      total: this.browsers.length,
      busy: this.busyBrowsers.size,
      idle: this.browsers.length - this.busyBrowsers.size,
      queued: this.queue.length,
    };
  }
}

let sharedPool = null;

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

module.exports = { BrowserPool, getPool, shutdownPool };
