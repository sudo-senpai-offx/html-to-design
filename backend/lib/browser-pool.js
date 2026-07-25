const puppeteer = require("puppeteer");
const os = require("os");

class BrowserPool {
  constructor(options) {
    this.maxConcurrency = options?.maxConcurrency || Math.min(os.cpus().length - 1, 4);
    this.maxTasksPerInstance = options?.maxTasksPerInstance || 100;
    this.puppeteerOptions = options?.puppeteerOptions || {};
    this.instances = [];
    this.queue = [];
    this.initialized = false;
  }

  async init() {
    if (this.initialized) return;
    for (let i = 0; i < this.maxConcurrency; i++) {
      this.instances.push(await this._createInstance());
    }
    this.initialized = true;
    console.log(`  Browser pool initialized: ${this.maxConcurrency} instances`);
  }

  async _createInstance() {
    const browser = await puppeteer.launch({
      headless: "new",
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-gpu",
        "--no-first-run",
        "--no-zygote",
        "--single-process",
        "--disable-extensions",
      ],
      ...this.puppeteerOptions,
    });
    return { browser, taskCount: 0, busy: false };
  }

  async execute(taskFn) {
    if (!this.initialized) await this.init();

    let instance = this.instances.find(i => !i.busy);
    if (!instance) {
      await new Promise(resolve => this.queue.push(resolve));
      instance = this.instances.find(i => !i.busy);
    }
    if (!instance) throw new Error("No browser instance available");

    instance.busy = true;
    let page;
    try {
      page = await instance.browser.newPage();
      const result = await taskFn(page);
      instance.taskCount++;
      if (instance.taskCount >= this.maxTasksPerInstance) {
        await this._retire(instance);
      }
      return result;
    } finally {
      if (page) await page.close().catch(() => {});
      instance.busy = false;
      if (this.queue.length) this.queue.shift()();
    }
  }

  async _retire(instance) {
    try { await instance.browser.close(); } catch {}
    const idx = this.instances.indexOf(instance);
    if (idx !== -1) {
      this.instances[idx] = await this._createInstance();
    }
  }

  async destroy() {
    await Promise.all(this.instances.map(i => i.browser.close().catch(() => {})));
    this.instances = [];
    this.initialized = false;
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
