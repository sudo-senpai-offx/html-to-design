import { useState, useCallback, useEffect } from 'react';
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels';
import { Toaster, toast } from 'sonner';
import { Download, Zap } from 'lucide-react';
import CodeEditor from './components/Editor';
import Preview from './components/Preview';
import ExportPanel from './components/ExportPanel';
import Settings from './components/Settings';
import UrlImport from './components/UrlImport';
import { convertToFormat } from './api/client';
import { useDebounce } from './hooks/useDebounce';

const DEFAULT_HTML = `<div class="card">
  <h2>Hello World</h2>
  <p>This is a sample HTML page for conversion.</p>
  <button class="btn">Get Started</button>
</div>`;

const DEFAULT_CSS = `* { margin: 0; padding: 0; box-sizing: border-box; }
body { font-family: Inter, sans-serif; padding: 2rem; background: #f9f7f4; }
.card { background: white; border-radius: 12px; padding: 2rem; box-shadow: 0 4px 24px rgba(0,0,0,0.08); max-width: 480px; }
h2 { color: #1B3A4B; margin-bottom: 0.5rem; }
p { color: #6B7280; margin-bottom: 1.5rem; line-height: 1.6; }
.btn { background: #D4A574; color: white; border: none; padding: 0.75rem 1.5rem; border-radius: 8px; font-weight: 600; cursor: pointer; }
.btn:hover { background: #C49464; }`;

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

  const handleExport = useCallback(async (format: string) => {
    setExporting(format);
    const toastId = toast.loading(`Converting to ${format.toUpperCase()}...`);
    try {
      const blob = await convertToFormat(format, fullHtml, { width, height, scale });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const ext = format === 'figma' ? 'fig' : format;
      a.href = url;
      a.download = `export.${ext}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast.success(`${format.toUpperCase()} exported successfully`, { id: toastId });
    } catch (err: any) {
      const msg = err?.response?.data?.error || err.message || 'Export failed';
      toast.error(`Export failed: ${msg}`, { id: toastId });
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
          <span className="text-xs text-slate-500 hidden md:block">
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
              <CodeEditor
                html={html}
                css={css}
                onHtmlChange={setHtml}
                onCssChange={setCss}
                activeTab={editorTab}
                onTabChange={setEditorTab}
              />
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
