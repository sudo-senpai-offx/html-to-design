import { useState, useCallback, useEffect } from 'react';
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels';
import { Toaster, toast } from 'sonner';
import { Download, Zap } from 'lucide-react';
import CodeEditor from './components/Editor';
import Preview from './components/Preview';
import ExportPanel from './components/ExportPanel';
import Settings from './components/Settings';
import UrlImport from './components/UrlImport';
import ErrorBoundary from './components/ErrorBoundary';
import { convertToFormat } from './api/client';
import { useDebounce } from './hooks/useDebounce';

const DEFAULT_HTML = `<div class="dashboard">
  <aside class="sidebar">
    <div class="logo">Acme Inc</div>
    <nav class="nav">
      <a class="nav-item active" href="#">Dashboard</a>
      <a class="nav-item" href="#">Analytics</a>
      <a class="nav-item" href="#">Customers</a>
      <a class="nav-item" href="#">Products</a>
      <a class="nav-item" href="#">Settings</a>
    </nav>
  </aside>
  <main class="main">
    <header class="header">
      <h1>Dashboard</h1>
      <div class="header-actions">
        <button class="btn btn-outline">Export</button>
        <button class="btn btn-primary">New Report</button>
      </div>
    </header>
    <div class="stats">
      <div class="stat-card">
        <span class="stat-label">Revenue</span>
        <span class="stat-value">$45,231</span>
        <span class="stat-change positive">+20.1%</span>
      </div>
      <div class="stat-card">
        <span class="stat-label">Users</span>
        <span class="stat-value">2,350</span>
        <span class="stat-change positive">+12.5%</span>
      </div>
      <div class="stat-card">
        <span class="stat-label">Orders</span>
        <span class="stat-value">1,247</span>
        <span class="stat-change negative">-3.2%</span>
      </div>
      <div class="stat-card">
        <span class="stat-label">Conversion</span>
        <span class="stat-value">3.6%</span>
        <span class="stat-change positive">+1.8%</span>
      </div>
    </div>
    <div class="content-grid">
      <div class="card chart-card">
        <h3>Revenue Overview</h3>
        <div class="chart-placeholder">
          <div class="chart-bar" style="height:60%"></div>
          <div class="chart-bar" style="height:80%"></div>
          <div class="chart-bar" style="height:45%"></div>
          <div class="chart-bar" style="height:90%"></div>
          <div class="chart-bar" style="height:70%"></div>
          <div class="chart-bar" style="height:55%"></div>
        </div>
      </div>
      <div class="card recent-card">
        <h3>Recent Orders</h3>
        <div class="order-item">
          <span class="order-name">Order #1234</span>
          <span class="order-status shipped">Shipped</span>
        </div>
        <div class="order-item">
          <span class="order-name">Order #1235</span>
          <span class="order-status pending">Pending</span>
        </div>
        <div class="order-item">
          <span class="order-name">Order #1236</span>
          <span class="order-status delivered">Delivered</span>
        </div>
      </div>
    </div>
  </main>
</div>`;

const DEFAULT_CSS = `* { margin: 0; padding: 0; box-sizing: border-box; }
body { font-family: Inter, -apple-system, sans-serif; background: #f1f5f9; color: #1e293b; }
.dashboard { display: flex; min-height: 100vh; }
.sidebar { width: 240px; background: #0f172a; color: #e2e8f0; padding: 24px 16px; flex-shrink: 0; }
.logo { font-size: 20px; font-weight: 700; margin-bottom: 32px; padding: 0 12px; }
.nav { display: flex; flex-direction: column; gap: 4px; }
.nav-item { padding: 10px 12px; border-radius: 8px; text-decoration: none; color: #94a3b8; font-size: 14px; font-weight: 500; transition: all 0.2s; }
.nav-item.active { background: #1e293b; color: #f1f5f9; }
.nav-item:hover { color: #f1f5f9; background: #1e293b; }
.main { flex: 1; padding: 24px 32px; }
.header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 24px; }
.header h1 { font-size: 24px; font-weight: 700; }
.header-actions { display: flex; gap: 12px; }
.btn { padding: 8px 16px; border-radius: 8px; font-size: 14px; font-weight: 500; cursor: pointer; border: none; }
.btn-primary { background: #3b82f6; color: white; }
.btn-primary:hover { background: #2563eb; }
.btn-outline { background: white; color: #374151; border: 1px solid #d1d5db; }
.btn-outline:hover { background: #f9fafb; }
.stats { display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px; margin-bottom: 24px; }
.stat-card { background: white; padding: 20px; border-radius: 12px; box-shadow: 0 1px 3px rgba(0,0,0,0.06); display: flex; flex-direction: column; gap: 4px; }
.stat-label { font-size: 13px; color: #6b7280; font-weight: 500; }
.stat-value { font-size: 24px; font-weight: 700; }
.stat-change { font-size: 12px; font-weight: 600; }
.stat-change.positive { color: #16a34a; }
.stat-change.negative { color: #dc2626; }
.content-grid { display: grid; grid-template-columns: 2fr 1fr; gap: 16px; }
.card { background: white; border-radius: 12px; padding: 20px; box-shadow: 0 1px 3px rgba(0,0,0,0.06); }
.card h3 { font-size: 16px; font-weight: 600; margin-bottom: 16px; }
.chart-placeholder { display: flex; align-items: flex-end; gap: 12px; height: 200px; padding-top: 16px; }
.chart-bar { flex: 1; background: linear-gradient(to top, #3b82f6, #60a5fa); border-radius: 6px 6px 0 0; }
.order-item { display: flex; justify-content: space-between; align-items: center; padding: 12px 0; border-bottom: 1px solid #f1f5f9; }
.order-item:last-child { border-bottom: none; }
.order-name { font-size: 14px; font-weight: 500; }
.order-status { font-size: 12px; font-weight: 600; padding: 4px 10px; border-radius: 99px; }
.order-status.shipped { background: #dbeafe; color: #2563eb; }
.order-status.pending { background: #fef3c7; color: #d97706; }
.order-status.delivered { background: #dcfce7; color: #16a34a; }`;

export default function App() {
  const [html, setHtml] = useState(DEFAULT_HTML);
  const [css, setCss] = useState(DEFAULT_CSS);
  const [editorTab, setEditorTab] = useState<'html' | 'css'>('html');
  const [width, setWidth] = useState(1440);
  const [height, setHeight] = useState(900);
  const [scale, setScale] = useState(2);
  const [exporting, setExporting] = useState<string | null>(null);

  const debouncedHtml = useDebounce(html, 300);
  const debouncedCss = useDebounce(css, 300);

  const fullHtml = `<style>${css}</style>${html}`;

  const handleExport = useCallback(async (format: string, pdfOptions?: Record<string, unknown>) => {
    setExporting(format);
    const toastId = toast.loading(`Converting to ${format.toUpperCase()}...`);
    try {
      const blob = await convertToFormat(format, fullHtml, { width, height, scale }, pdfOptions as any);

      if (!blob || blob.size === 0) {
        throw new Error('Server returned empty response');
      }

      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const ext = format === 'figma' ? 'fig' : format;
      a.href = url;
      a.download = `export.${ext}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      const sizeKB = (blob.size / 1024).toFixed(1);
      toast.success(`${format.toUpperCase()} exported (${sizeKB}KB)`, { id: toastId });
    } catch (err: any) {
      let msg = 'Export failed';
      if (err?.response?.data?.error) {
        msg = err.response.data.error;
      } else if (err?.code === 'ECONNABORTED' || err?.message?.includes('timeout')) {
        msg = 'Request timed out - the page may be too complex. Try reducing viewport size.';
      } else if (err?.code === 'ERR_NETWORK') {
        msg = 'Network error - is the backend server running?';
      } else if (err?.message) {
        msg = err.message;
      }
      toast.error(msg, { id: toastId, duration: 6000 });
    } finally {
      setExporting(null);
    }
  }, [fullHtml, width, height, scale]);

  const handleUrlImport = useCallback((importedHtml: string, importedCss: string) => {
    setHtml(importedHtml);
    setCss(importedCss);
    toast.success('URL imported successfully');
  }, []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault();
        handleExport('png');
      }
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'F') {
        e.preventDefault();
        handleExport('figma');
      }
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'P') {
        e.preventDefault();
        handleExport('pdf');
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleExport]);

  return (
    <div className="flex flex-col h-screen">
      <Toaster
        position="bottom-right"
        toastOptions={{
          className: 'bg-brand-medium border border-brand-light text-white',
          style: { background: '#1E293B', color: '#fff', border: '1px solid #334155' },
        }}
      />

      <header className="flex items-center justify-between px-6 py-3 border-b border-brand-light bg-brand-dark">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-brand-accent to-amber-600 flex items-center justify-center">
            <Zap className="w-4 h-4 text-white" />
          </div>
          <div>
            <h1 className="text-lg font-semibold">HTML to Design</h1>
            <span className="text-[10px] text-slate-500">v2.0</span>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <span className="text-xs text-slate-500 hidden md:block" title="PNG: Ctrl+Enter | Figma: Ctrl+Shift+F | PDF: Ctrl+Shift+P">
            <kbd className="px-1.5 py-0.5 bg-brand-light rounded text-[10px]">Ctrl+Enter</kbd> PNG
            <span className="mx-1">|</span>
            <kbd className="px-1.5 py-0.5 bg-brand-light rounded text-[10px]">Ctrl+Shift+F</kbd> Figma
          </span>
          <div className="text-xs text-slate-500 bg-brand-light px-3 py-1 rounded-full">
            PNG PDF SVG Figma PSD
          </div>
        </div>
      </header>

      <div className="flex flex-1 min-h-0">
        <aside className="w-72 border-r border-brand-light bg-brand-medium p-4 flex flex-col gap-4 overflow-y-auto">
          <UrlImport onImport={handleUrlImport} />
          <hr className="border-brand-light" />
          <Settings
            width={width}
            height={height}
            scale={scale}
            onWidthChange={setWidth}
            onHeightChange={setHeight}
            onScaleChange={setScale}
          />
          <hr className="border-brand-light" />
          <ExportPanel onExport={handleExport} exporting={exporting} />
        </aside>

        <main className="flex-1 min-w-0">
          <PanelGroup direction="horizontal">
            <Panel defaultSize={50} minSize={30}>
              <ErrorBoundary fallback={<div className="flex items-center justify-center h-full bg-brand-dark text-slate-400 text-sm">Editor failed to load. Try refreshing.</div>}>
                <CodeEditor
                  html={html}
                  css={css}
                  onHtmlChange={setHtml}
                  onCssChange={setCss}
                  activeTab={editorTab}
                  onTabChange={setEditorTab}
                />
              </ErrorBoundary>
            </Panel>
            <PanelResizeHandle className="w-1.5 bg-brand-light hover:bg-brand-accent transition-colors cursor-col-resize" />
            <Panel defaultSize={50} minSize={20}>
              <Preview html={debouncedHtml} css={debouncedCss} width={width} />
            </Panel>
          </PanelGroup>
        </main>
      </div>
    </div>
  );
}
