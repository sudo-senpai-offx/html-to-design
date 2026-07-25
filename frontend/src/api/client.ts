import axios from "axios";

const api = axios.create({
  baseURL: "/api",
  timeout: 120000,
});

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
