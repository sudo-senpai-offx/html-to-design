import { useState, useCallback, useEffect } from "react";
import {
  Zap, Code2, Palette, MousePointer2, BarChart3, Eye,
  Monitor, Laptop, Tablet, Smartphone, Image, FileText,
  PenTool, Figma, Layers, Upload, Loader2, CheckCircle2,
  AlertCircle, ArrowRight, SplitSquareHorizontal, Undo2,
} from "lucide-react";
import { Toaster, toast } from "sonner";
import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";
import Editor from "./components/Editor";
import Preview from "./components/Preview";
import ExportPanel from "./components/ExportPanel";
import UrlImport from "./components/UrlImport";
import Settings from "./components/Settings";
import ErrorBoundary from "./components/ErrorBoundary";
import OutputViewer from "./components/OutputViewer";
import OutputInterpreter from "./components/OutputInterpreter";
import { convertToFormat, healthCheck } from "./api/client";
import type { PdfOptions } from "./api/client";
import { useDebounce } from "./hooks/useDebounce";

const DEFAULT_HTML = `<div class="dashboard">
  <aside class="sidebar">
    <div class="logo">
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <polygon points="12 2 22 8.5 22 15.5 12 22 2 15.5 2 8.5 12 2"/>
        <line x1="12" y1="22" x2="12" y2="15.5"/>
        <polyline points="22 8.5 12 15.5 2 8.5"/>
      </svg>
      <span>Acme Inc</span>
    </div>
    <nav>
      <a href="#" class="nav-item active">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <rect x="3" y="3" width="7" height="7"/>
          <rect x="14" y="3" width="7" height="7"/>
          <rect x="3" y="14" width="7" height="7"/>
          <rect x="14" y="14" width="7" height="7"/>
        </svg>
        Dashboard
      </a>
      <a href="#" class="nav-item">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
          <circle cx="9" cy="7" r="4"/>
          <path d="M23 21v-2a4 4 0 0 0-3-3.87"/>
          <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
        </svg>
        Customers
      </a>
      <a href="#" class="nav-item">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <line x1="12" y1="1" x2="12" y2="23"/>
          <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>
        </svg>
        Revenue
      </a>
      <a href="#" class="nav-item">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
          <polyline points="14 2 14 8 20 8"/>
          <line x1="16" y1="13" x2="8" y2="13"/>
          <line x1="16" y1="17" x2="8" y2="17"/>
        </svg>
        Reports
      </a>
    </nav>
  </aside>
  <main class="main-content">
    <header class="top-bar">
      <h1>Dashboard</h1>
      <div class="user-info">
        <div class="avatar">JD</div>
        <span>John Doe</span>
      </div>
    </header>
    <section class="stats-grid">
      <div class="stat-card">
        <div class="stat-label">Total Revenue</div>
        <div class="stat-value">$45,231.89</div>
        <div class="stat-change positive">+20.1% from last month</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Subscriptions</div>
        <div class="stat-value">+2,350</div>
        <div class="stat-change positive">+180.1% from last month</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Sales</div>
        <div class="stat-value">+12,234</div>
        <div class="stat-change negative">-19% from last month</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Active Now</div>
        <div class="stat-value">+573</div>
        <div class="stat-change positive">+201 since last hour</div>
      </div>
    </section>
    <section class="chart-area">
      <h2>Overview</h2>
      <div class="chart-placeholder">
        <svg viewBox="0 0 600 200" class="chart-svg">
          <defs>
            <linearGradient id="gradient" x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" style="stop-color:#D4A574;stop-opacity:0.3"/>
              <stop offset="100%" style="stop-color:#D4A574;stop-opacity:0"/>
            </linearGradient>
          </defs>
          <path d="M0,180 L50,160 L100,140 L150,100 L200,120 L250,80 L300,60 L350,90 L400,40 L450,70 L500,30 L550,50 L600,20 L600,200 L0,200Z" fill="url(#gradient)"/>
          <polyline points="0,180 50,160 100,140 150,100 200,120 250,80 300,60 350,90 400,40 450,70 500,30 550,50 600,20" fill="none" stroke="#D4A574" stroke-width="2.5"/>
        </svg>
      </div>
    </section>
    <section class="recent-orders">
      <h2>Recent Orders</h2>
      <table>
        <thead>
          <tr>
            <th>Order</th>
            <th>Customer</th>
            <th>Status</th>
            <th>Date</th>
            <th>Amount</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>#3210</td>
            <td>Olivia Martin</td>
            <td><span class="badge completed">Completed</span></td>
            <td>Feb 20, 2024</td>
            <td>$316.00</td>
          </tr>
          <tr>
            <td>#3209</td>
            <td>Jackson Lee</td>
            <td><span class="badge processing">Processing</span></td>
            <td>Feb 19, 2024</td>
            <td>$242.00</td>
          </tr>
          <tr>
            <td>#3208</td>
            <td>Isabella Nguyen</td>
            <td><span class="badge pending">Pending</span></td>
            <td>Feb 18, 2024</td>
            <td>$837.00</td>
          </tr>
        </tbody>
      </table>
    </section>
  </main>
</div>`;

const DEFAULT_CSS = `* { margin: 0; padding: 0; box-sizing: border-box; }
body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #f8fafc; color: #1e293b; }
.dashboard { display: flex; min-height: 100vh; }
.sidebar { width: 260px; background: #0f172a; color: white; padding: 24px; display: flex; flex-direction: column; }
.sidebar .logo { display: flex; align-items: center; gap: 12px; font-size: 18px; font-weight: 700; margin-bottom: 32px; }
.sidebar nav { display: flex; flex-direction: column; gap: 4px; }
.nav-item { display: flex; align-items: center; gap: 12px; padding: 10px 12px; color: #94a3b8; text-decoration: none; border-radius: 8px; font-size: 14px; transition: all 0.2s; }
.nav-item:hover, .nav-item.active { background: rgba(255,255,255,0.1); color: white; }
.main-content { flex: 1; padding: 24px 32px; }
.top-bar { display: flex; justify-content: space-between; align-items: center; margin-bottom: 32px; }
.top-bar h1 { font-size: 28px; font-weight: 700; }
.user-info { display: flex; align-items: center; gap: 12px; }
.avatar { width: 36px; height: 36px; border-radius: 50%; background: #D4A574; color: white; display: flex; align-items: center; justify-content: center; font-weight: 600; font-size: 14px; }
.stats-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 20px; margin-bottom: 32px; }
.stat-card { background: white; border-radius: 12px; padding: 20px; border: 1px solid #e2e8f0; }
.stat-label { font-size: 13px; color: #64748b; margin-bottom: 8px; }
.stat-value { font-size: 24px; font-weight: 700; margin-bottom: 4px; }
.stat-change { font-size: 12px; }
.stat-change.positive { color: #16a34a; }
.stat-change.negative { color: #dc2626; }
.chart-area { background: white; border-radius: 12px; padding: 24px; border: 1px solid #e2e8f0; margin-bottom: 32px; }
.chart-area h2 { font-size: 16px; font-weight: 600; margin-bottom: 16px; }
.chart-placeholder { height: 200px; }
.chart-svg { width: 100%; height: 100%; }
.recent-orders { background: white; border-radius: 12px; padding: 24px; border: 1px solid #e2e8f0; }
.recent-orders h2 { font-size: 16px; font-weight: 600; margin-bottom: 16px; }
table { width: 100%; border-collapse: collapse; }
th { text-align: left; font-size: 12px; color: #64748b; font-weight: 500; padding: 12px 16px; border-bottom: 1px solid #e2e8f0; }
td { padding: 12px 16px; font-size: 14px; border-bottom: 1px solid #f1f5f9; }
.badge { padding: 4px 10px; border-radius: 9999px; font-size: 12px; font-weight: 500; }
.badge.completed { background: #dcfce7; color: #16a34a; }
.badge.processing { background: #dbeafe; color: #2563eb; }
.badge.pending { background: #fef3c7; color: #d97706; }`;

type ViewMode = "edit" | "output" | "compare";

export default function App() {
  const [html, setHtml] = useState(DEFAULT_HTML);
  const [css, setCss] = useState(DEFAULT_CSS);
  const [editorTab, setEditorTab] = useState<"html" | "css">("html");
  const [width, setWidth] = useState(1440);
  const [height, setHeight] = useState(900);
  const [scale, setScale] = useState(2);
  const [exporting, setExporting] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>("edit");
  const [outputFile, setOutputFile] = useState<{
    format: string; blob: Blob; url: string; filename: string; size: number; timestamp: number;
  } | null>(null);
  const [selectedElement, setSelectedElement] = useState<any>(null);
  const [selectionMode, setSelectionMode] = useState(false);
  const [compareFormat, setCompareFormat] = useState<string>("png");
  const [convertedBlob, setConvertedBlob] = useState<Blob | null>(null);

  const debouncedHtml = useDebounce(html, 300);
  const debouncedCss = useDebounce(css, 300);
  const fullHtml = `<style>${css}</style>${html}`;

  const handleExport = useCallback(async (format: string, pdfOptions?: PdfOptions) => {
    setExporting(format);
    const toastId = toast.loading(`Exporting ${format.toUpperCase()}...`, { description: "Rendering in browser" });
    try {
      const blob = await convertToFormat(format, fullHtml, { width, height, scale }, pdfOptions);
      if (!blob || blob.size === 0) throw new Error("Empty response from server");
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `export.${format === "figma" ? "fig" : format === "psd" ? "zip" : format}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 5000);

      const sizeKB = (blob.size / 1024).toFixed(1);
      setOutputFile({
        format, blob, url, filename: `export.${format === "figma" ? "fig" : format === "psd" ? "zip" : format}`,
        size: blob.size, timestamp: Date.now(),
      });
      setConvertedBlob(blob);
      setCompareFormat(format);
      setViewMode("output");
      toast.success(`${format.toUpperCase()} exported`, { id: toastId, description: `${sizeKB} KB` });
    } catch (err: any) {
      const msg = err?.response?.data?.error || err?.message || "Export failed";
      if (msg.includes("timeout")) toast.error("Timed out — try reducing viewport size", { id: toastId });
      else if (msg.includes("Network") || msg.includes("ECONNREFUSED")) toast.error("Server unreachable — is the backend running?", { id: toastId });
      else toast.error(msg, { id: toastId });
    } finally {
      setExporting(null);
    }
  }, [fullHtml, width, height, scale]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "Enter") { e.preventDefault(); handleExport("png"); }
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === "F") { e.preventDefault(); handleExport("figma"); }
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === "P") { e.preventDefault(); handleExport("pdf"); }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [handleExport]);

  const handleUrlImport = useCallback((importedHtml: string, importedCss: string) => {
    setHtml(importedHtml);
    setCss(importedCss);
    setViewMode("edit");
    toast.success("URL imported successfully");
  }, []);

  const handleCloseOutput = useCallback(() => {
    setViewMode("edit");
  }, []);

  const handleOpenCompare = useCallback(() => {
    setViewMode("compare");
  }, []);

  const handleReExport = useCallback((format: string) => {
    setViewMode("edit");
    handleExport(format);
  }, [handleExport]);

  const viewModeButtons = [
    { mode: "edit" as ViewMode, icon: Code2, label: "Edit" },
    { mode: "output" as ViewMode, icon: Eye, label: "Output" },
    { mode: "compare" as ViewMode, icon: BarChart3, label: "Compare" },
  ];

  return (
    <div className="h-screen flex flex-col bg-brand-dark text-white overflow-hidden">
      <Toaster position="top-right" toastOptions={{
        className: "bg-brand-medium border border-brand-light text-white",
        style: { background: "#1E293B", color: "#fff", border: "1px solid #334155" },
      }} />

      <header className="flex items-center justify-between px-5 py-3 border-b border-brand-light/50 bg-brand-dark shrink-0">
        <div className="flex items-center gap-3">
          <div className="p-1.5 rounded-lg bg-brand-accent/20"><Zap size={18} className="text-brand-accent" /></div>
          <div>
            <h1 className="text-sm font-bold tracking-tight">HTML to Design</h1>
            <p className="text-[10px] text-slate-500">v2.0 — Convert HTML+CSS to PNG, PDF, SVG, Figma & PSD</p>
          </div>
        </div>
        <div className="flex items-center gap-1 bg-brand-medium rounded-lg p-0.5">
          {viewModeButtons.map(({ mode, icon: Icon, label }) => (
            <button key={mode} onClick={() => setViewMode(mode)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
                viewMode === mode ? "bg-brand-accent text-white shadow-sm" : "text-slate-400 hover:text-white hover:bg-brand-light/30"
              }`}>
              <Icon size={13} />
              {label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          {(["png", "pdf", "svg", "figma", "psd"] as const).map(f => (
            <span key={f} className="text-[9px] px-1.5 py-0.5 rounded bg-brand-medium border border-brand-light/30 text-slate-400 font-mono uppercase">
              {f}
            </span>
          ))}
        </div>
      </header>

      <div className="flex-1 flex overflow-hidden">
        {viewMode === "edit" && (
          <>
            <aside className="w-72 border-r border-brand-light/50 flex flex-col overflow-y-auto shrink-0 bg-brand-dark">
              <div className="p-3 border-b border-brand-light/30">
                <UrlImport onImport={handleUrlImport} />
              </div>
              <div className="p-3 border-b border-brand-light/30">
                <Settings width={width} height={height} scale={scale}
                  onWidthChange={setWidth} onHeightChange={setHeight} onScaleChange={setScale} />
              </div>
              <div className="p-3 flex-1">
                <ExportPanel onExport={handleExport} exporting={exporting} />
              </div>
              <div className="p-3 border-t border-brand-light/30">
                <button onClick={() => setSelectionMode(!selectionMode)}
                  className={`w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-xs font-medium transition-all ${
                    selectionMode
                      ? "bg-blue-500/20 text-blue-400 border border-blue-500/30"
                      : "bg-brand-medium text-slate-400 hover:text-white hover:bg-brand-light/30 border border-brand-light/30"
                  }`}>
                  <MousePointer2 size={13} />
                  {selectionMode ? "Selection Mode ON" : "Select Elements"}
                </button>
              </div>
            </aside>
            <PanelGroup direction="horizontal" className="flex-1">
              <Panel defaultSize={50} minSize={30}>
                <ErrorBoundary fallback={<div className="p-4 text-red-400 text-sm">Editor crashed</div>}>
                  <Editor html={html} css={css}
                    onHtmlChange={setHtml} onCssChange={setCss} activeTab={editorTab}
                    onTabChange={setEditorTab} />
                </ErrorBoundary>
              </Panel>
              <PanelResizeHandle className="w-1.5 bg-brand-light/30 hover:bg-brand-accent transition-colors" />
              <Panel defaultSize={50} minSize={20}>
                <Preview html={debouncedHtml} css={debouncedCss} width={width} height={height}
                  selectionMode={selectionMode} onElementSelect={setSelectedElement} />
              </Panel>
            </PanelGroup>
          </>
        )}

        {viewMode === "output" && outputFile && (
          <OutputViewer output={outputFile} onClose={handleCloseOutput}
            onReExport={handleReExport} onCompare={handleOpenCompare} />
        )}

        {viewMode === "output" && !outputFile && (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center max-w-md">
              <Eye size={48} className="text-brand-light mx-auto mb-4" />
              <h3 className="text-lg font-semibold text-white mb-2">No Output Yet</h3>
              <p className="text-sm text-slate-400 mb-4">
                Export your HTML to see the output here. Switch to Edit mode to create something first.
              </p>
              <button onClick={() => setViewMode("edit")}
                className="px-4 py-2 text-sm rounded-lg bg-brand-accent text-white hover:bg-brand-accent-hover transition-colors font-medium">
                Go to Editor
              </button>
            </div>
          </div>
        )}

        {viewMode === "compare" && (
          <OutputInterpreter html={html} css={css} format={compareFormat}
            convertedBlob={convertedBlob || undefined} onClose={handleCloseOutput} />
        )}
      </div>
    </div>
  );
}
