import axios from "axios";

const api = axios.create({
  baseURL: "/api",
  timeout: 120000,
});

const RETRY_NETWORK_ERRORS = [
  "ECONNRESET",
  "ECONNREFUSED",
  "ERR_CONNECTION_REFUSED",
  "ERR_NETWORK",
  "Network Error",
  "socket hang up",
  "timeout",
];

const MAX_RETRIES = 3;
const BASE_DELAY = 1000;

api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const config = error.config;
    if (!config || config.method === "get") {
      return Promise.reject(error);
    }

    const msg = error.code || error.message || "";
    const status = error.response?.status;
    const isNetworkError = RETRY_NETWORK_ERRORS.some((e) =>
      msg.toLowerCase().includes(e.toLowerCase())
    );
    const isTimeout =
      error.code === "ECONNABORTED" || msg.includes("timeout of");
    const isProxyDown = status === 502 || status === 503 || (status === 500 && !error.response?.data);
    const isRetryable = isNetworkError || isTimeout || isProxyDown;

    config.__retryCount = config.__retryCount || 0;

    if (isRetryable && config.__retryCount < MAX_RETRIES) {
      config.__retryCount += 1;
      const delay = BASE_DELAY * Math.pow(2, config.__retryCount - 1);
      console.log(
        `[api] retry ${config.__retryCount}/${MAX_RETRIES} after ${delay}ms (${msg})`
      );
      await new Promise((r) => setTimeout(r, delay));
      return api(config);
    }

    return Promise.reject(error);
  }
);

export interface ConvertOptions {
  width?: number;
  height?: number;
  scale?: number;
  pageName?: string;
}

export interface PdfOptions {
  format?: string;
  landscape?: boolean;
  printBackground?: boolean;
  headerFooter?: boolean;
  margin?: string;
}

export interface UrlImportResult {
  html: string;
  css: string;
  title: string;
  url: string;
}

export interface CompareResult {
  visualScore: number;
  structuralScore: number;
  layoutScore: number;
  overallScore: number;
  pixelAccuracy: number;
  comparisonMode?: string;
  formatNote?: string;
  originalImageUrl?: string;
  convertedImageUrl?: string;
  diffImageUrl?: string;
  differences: Array<{
    type: string;
    severity: string;
    description: string;
    element?: string;
    original?: string;
    converted?: string;
  }>;
  recommendations: string[];
  elementCount: { original: number; converted: number };
}

export async function convertToFormat(
  format: string,
  html: string,
  options: ConvertOptions = {},
  pdfOptions?: PdfOptions
): Promise<Blob> {
  const body: Record<string, any> = {
    html,
    width: options.width || 1440,
    height: options.height || 900,
    scale: options.scale || 2,
    autoRun: format === "figma-all" || format === "figma-plugin",
  };

  if (format === "pdf" && pdfOptions) {
    Object.assign(body, pdfOptions);
  }

  const response = await api.post(`/convert/${format}`, body, {
    responseType: "blob",
  });

  return response.data;
}

export async function importFromUrl(url: string): Promise<UrlImportResult> {
  const response = await api.post("/import/url", { url });
  return response.data;
}

export async function healthCheck(): Promise<boolean> {
  try {
    const response = await api.get("/health");
    return response.data?.status === "ok";
  } catch {
    return false;
  }
}

export async function compareOutput(
  html: string,
  css: string,
  format: string,
  convertedBlob?: Blob
): Promise<CompareResult> {
  let convertedBuffer = undefined;
  if (convertedBlob) {
    const arrayBuffer = await convertedBlob.arrayBuffer();
    const uint8Array = new Uint8Array(arrayBuffer);
    let binary = "";
    for (let i = 0; i < uint8Array.length; i++) {
      binary += String.fromCharCode(uint8Array[i]);
    }
    convertedBuffer = btoa(binary);
  }

  const response = await api.post("/compare", {
    html,
    css,
    format,
    convertedBuffer,
  });

  return response.data;
}

export interface FigmaChunkMeta {
  html: string;
  label: string;
  bounds: { x: number; y: number; w: number; h: number };
  elementCount: number;
  index: number;
  total: number;
  size?: number;
}

export interface FigmaConnectorProgress {
  current: number;
  total: number;
  phase: string;
  errors?: number;
  chunks?: FigmaChunkMeta[] | null;
}

export interface FigmaConnectionInfo {
  connected: boolean;
  stableSince: string | null;
  stability: string | null;
  lastConnected: string | null;
  lastDisconnected: string | null;
  reconnectCount: number;
}

export interface FigmaLogEntry {
  t: string;
  msg: string;
}

export interface FigmaConnectorStatus {
  running: boolean;
  initialized: boolean;
  figmaConnected: boolean;
  mode: string | null;
  pid: number | null;
  progress: FigmaConnectorProgress | null;
  connection: FigmaConnectionInfo | null;
  logs?: FigmaLogEntry[] | null;
  error?: string;
}

export async function getFigmaStatus(): Promise<FigmaConnectorStatus> {
  const response = await api.get("/figma/status");
  return response.data?.connector || { running: false, initialized: false, figmaConnected: false, mode: null, pid: null, progress: null, connection: null };
}

export async function connectFigma(): Promise<{ started: boolean; connector: FigmaConnectorStatus }> {
  const response = await api.post("/figma/connect");
  return response.data;
}

export async function stopFigma(): Promise<void> {
  await api.post("/figma/stop");
}

export async function restartFigma(): Promise<{ started: boolean; connector: FigmaConnectorStatus }> {
  const response = await api.post("/figma/restart");
  return response.data;
}

export async function disconnectFigma(): Promise<void> {
  await api.post("/figma/disconnect");
}

export async function runInFigma(html: string, name?: string): Promise<any> {
  const response = await api.post("/figma/run", { html, name });
  return response.data;
}
