import axios from 'axios';

const api = axios.create({
  baseURL: '/api',
  timeout: 120000,
});

export interface ConvertOptions {
  width?: number;
  height?: number;
  scale?: number;
  pageName?: string;
}

export interface UrlImportResult {
  html: string;
  css: string;
  title: string;
  url: string;
}

export interface PdfOptions {
  format?: string;
  landscape?: boolean;
  printBackground?: boolean;
  headerFooter?: boolean;
  margin?: string;
}

export async function convertToFormat(
  format: string,
  html: string,
  options: ConvertOptions = {},
  pdfOptions?: PdfOptions
): Promise<Blob> {
  const payload: Record<string, unknown> = { html, ...options };
  if (pdfOptions && format === 'pdf') {
    Object.assign(payload, pdfOptions);
  }
  const response = await api.post(`/convert/${format}`, payload, {
    responseType: 'blob',
  });
  return response.data;
}

export async function importFromUrl(url: string): Promise<UrlImportResult> {
  const response = await api.post('/import/url', { url });
  return response.data;
}

export async function healthCheck(): Promise<boolean> {
  try {
    const res = await api.get('/health');
    return res.data.status === 'ok';
  } catch {
    return false;
  }
}
