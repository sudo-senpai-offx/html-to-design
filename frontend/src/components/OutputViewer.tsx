import { useState, useRef, useCallback, useEffect } from "react";
import {
  X, Download, ZoomIn, ZoomOut, RotateCcw, Image, FileText,
  PenTool, Figma, Layers, Monitor, Copy, Check, Maximize2, Minimize2,
  Clipboard, Terminal, Sparkles, FileCode, Wifi, WifiOff, Loader2, Grid3x3, List, Trash2,
} from "lucide-react";
import { getFigmaStatus, connectFigma, stopFigma, restartFigma, runInFigma, type FigmaConnectorStatus, type FigmaConnectorProgress, type FigmaChunkMeta, type FigmaLogEntry } from "../api/client";

interface OutputFile {
  format: string;
  blob: Blob;
  url: string;
  filename: string;
  size: number;
  timestamp: number;
}

interface OutputViewerProps {
  output: OutputFile;
  onClose: () => void;
  onReExport?: (format: string) => void;
  onCompare?: () => void;
}

const FORMAT_INFO: Record<string, { icon: typeof Image; label: string; color: string; description: string }> = {
  png: { icon: Image, label: "PNG", color: "text-emerald-400", description: "Raster image" },
  pdf: { icon: FileText, label: "PDF", color: "text-red-400", description: "Print-ready document" },
  svg: { icon: PenTool, label: "SVG", color: "text-purple-400", description: "Vector graphic" },
  figma: { icon: Figma, label: "Figma", color: "text-blue-400", description: ".fig design file" },
  psd: { icon: Layers, label: "PSD", color: "text-cyan-400", description: "Photoshop layers" },
  xd: { icon: Monitor, label: "XD / Sketch", color: "text-orange-400", description: "Multi-editor design file" },
  clipboard: { icon: Clipboard, label: "Figma Paste", color: "text-pink-400", description: "Paste directly into Figma" },
  "figma-mcp": { icon: Terminal, label: "Figma MCP", color: "text-yellow-400", description: "Figma Plugin API code" },
  "figma-all": { icon: Sparkles, label: "Figma All-in-One", color: "text-violet-400", description: ".fig + clipboard + connector HTML" },
  "inline": { icon: FileCode, label: "Inline HTML", color: "text-teal-400", description: "Single HTML with inlined CSS" },
};

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
  return (bytes / (1024 * 1024)).toFixed(1) + " MB";
}

function ImageViewer({ url, format }: { url: string; format: string }) {
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const containerRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);

  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? -0.1 : 0.1;
    setZoom(z => Math.max(0.1, Math.min(5, z + delta)));
  }, []);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0) return;
    setDragging(true);
    setDragStart({ x: e.clientX - pan.x, y: e.clientY - pan.y });
  }, [pan]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!dragging) return;
    setPan({ x: e.clientX - dragStart.x, y: e.clientY - dragStart.y });
  }, [dragging, dragStart]);

  const handleMouseUp = useCallback(() => setDragging(false), []);

  const resetView = useCallback(() => { setZoom(1); setPan({ x: 0, y: 0 }); }, []);

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-1 px-3 py-1.5 bg-brand-medium border-b border-brand-light/50">
        <button onClick={() => setZoom(z => Math.min(5, z + 0.25))} className="p-1 rounded hover:bg-brand-light/50 text-slate-400 hover:text-white" title="Zoom in">
          <ZoomIn size={14} />
        </button>
        <button onClick={() => setZoom(z => Math.max(0.1, z - 0.25))} className="p-1 rounded hover:bg-brand-light/50 text-slate-400 hover:text-white" title="Zoom out">
          <ZoomOut size={14} />
        </button>
        <span className="text-[11px] text-slate-400 font-mono w-12 text-center">{Math.round(zoom * 100)}%</span>
        <button onClick={resetView} className="p-1 rounded hover:bg-brand-light/50 text-slate-400 hover:text-white" title="Reset view">
          <RotateCcw size={14} />
        </button>
      </div>
      <div
        ref={containerRef}
        className="flex-1 overflow-hidden bg-[#1a1a2e] cursor-grab active:cursor-grabbing"
        style={{
          backgroundImage: "linear-gradient(45deg, #1e1e30 25%, transparent 25%), linear-gradient(-45deg, #1e1e30 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #1e1e30 75%), linear-gradient(-45deg, transparent 75%, #1e1e30 75%)",
          backgroundSize: "20px 20px",
          backgroundPosition: "0 0, 0 10px, 10px -10px, -10px 0px",
        }}
        onWheel={handleWheel}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
      >
        <div
          style={{
            transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
            transformOrigin: "center center",
            transition: dragging ? "none" : "transform 0.1s ease-out",
          }}
          className="flex items-center justify-center min-h-full p-4"
        >
          <img
            ref={imgRef}
            src={url}
            alt={`Exported ${format.toUpperCase()}`}
            className="max-w-none shadow-2xl rounded"
            style={{ maxHeight: "80vh" }}
            draggable={false}
          />
        </div>
      </div>
    </div>
  );
}

function PdfViewer({ url }: { url: string }) {
  return (
    <div className="h-full">
      <iframe
        src={url}
        className="w-full h-full border-0"
        title="PDF Preview"
      />
    </div>
  );
}

function SvgViewer({ url, blob }: { url: string; blob: Blob }) {
  const [svgContent, setSvgContent] = useState<string>("");
  const [zoom, setZoom] = useState(1);

  useEffect(() => {
    blob.text().then(setSvgContent);
  }, [blob]);

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-1 px-3 py-1.5 bg-brand-medium border-b border-brand-light/50">
        <button onClick={() => setZoom(z => Math.min(5, z + 0.25))} className="p-1 rounded hover:bg-brand-light/50 text-slate-400 hover:text-white">
          <ZoomIn size={14} />
        </button>
        <button onClick={() => setZoom(z => Math.max(0.1, z - 0.25))} className="p-1 rounded hover:bg-brand-light/50 text-slate-400 hover:text-white">
          <ZoomOut size={14} />
        </button>
        <span className="text-[11px] text-slate-400 font-mono">{Math.round(zoom * 100)}%</span>
      </div>
      <div
        className="flex-1 overflow-auto bg-[#1a1a2e] flex items-center justify-center p-4"
        style={{
          backgroundImage: "linear-gradient(45deg, #1e1e30 25%, transparent 25%), linear-gradient(-45deg, #1e1e30 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #1e1e30 75%), linear-gradient(-45deg, transparent 75%, #1e1e30 75%)",
          backgroundSize: "20px 20px",
          backgroundPosition: "0 0, 0 10px, 10px -10px, -10px 0px",
        }}
      >
        <div style={{ transform: `scale(${zoom})`, transformOrigin: "center center" }}>
          <div
            className="shadow-2xl rounded overflow-hidden bg-white"
            dangerouslySetInnerHTML={{ __html: svgContent }}
          />
        </div>
      </div>
    </div>
  );
}

function ClipboardViewer({ blob }: { blob: Blob }) {
  const [htmlContent, setHtmlContent] = useState("");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    blob.text().then(setHtmlContent);
  }, [blob]);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(htmlContent);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = htmlContent;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }, [htmlContent]);

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-2 px-3 py-2 bg-brand-medium border-b border-brand-light/50">
        <Clipboard size={14} className="text-pink-400" />
        <span className="text-xs font-medium text-slate-300">Figma Clipboard Paste</span>
        <span className="text-[10px] text-slate-500 font-mono">{(htmlContent.length / 1024).toFixed(0)} KB</span>
        <div className="flex-1" />
        <button
          onClick={handleCopy}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium bg-pink-500/20 text-pink-400 hover:bg-pink-500/30 transition-colors"
        >
          {copied ? <Check size={12} /> : <Copy size={12} />}
          {copied ? "Copied!" : "Copy HTML"}
        </button>
      </div>
      <div className="flex-1 overflow-auto p-6 bg-[#1a1a2e]">
          <div className="max-w-3xl mx-auto">
            <div className="bg-brand-medium border border-brand-light rounded-xl p-5 mb-4">
              <h3 className="text-sm font-semibold text-white mb-2">How to use this in Figma</h3>
              <div className="space-y-3">
                <div className="p-2.5 bg-emerald-500/10 border border-emerald-500/30 rounded-lg">
                  <p className="text-[11px] text-emerald-400">
                    <strong>★ Best accuracy:</strong> Use <strong>html.to.design</strong> plugin instead of direct paste.
                    Copy the inlined HTML from the <strong>Inline HTML</strong> export (left sidebar), open html.to.design in Figma,
                    go to the HTML tab, paste. This preserves ALL styles perfectly.
                  </p>
                </div>
                <div>
                  <h4 className="text-xs font-medium text-white mb-1">Direct paste (fig-kiwi clipboard)</h4>
                  <ol className="text-xs text-slate-400 space-y-1.5 list-decimal list-inside">
                    <li>Click <strong className="text-pink-400">Copy HTML</strong> above</li>
                    <li>Open Figma <strong className="text-amber-400">Desktop app</strong> (browser version may not accept external HTML)</li>
                    <li>Create a new frame: press <kbd className="px-1.5 py-0.5 bg-brand-dark rounded text-[10px] font-mono text-slate-300">F</kbd> and click on canvas</li>
                    <li>Select the frame so it's highlighted</li>
                    <li>Press <kbd className="px-1.5 py-0.5 bg-brand-dark rounded text-[10px] font-mono text-slate-300">Ctrl+V</kbd> / <kbd className="px-1.5 py-0.5 bg-brand-dark rounded text-[10px] font-mono text-slate-300">Cmd+V</kbd></li>
                    <li>The design will be pasted with native Figma layers inside the frame</li>
                  </ol>
                </div>
              </div>
            </div>
          <div className="bg-brand-dark rounded-lg border border-brand-light/30 overflow-hidden">
            <div className="flex items-center gap-2 px-3 py-1.5 bg-brand-medium border-b border-brand-light/30">
              <span className="text-[10px] text-slate-500 font-mono">HTML Source</span>
            </div>
            <pre className="p-4 text-[11px] text-slate-300 font-mono overflow-auto max-h-[60vh] whitespace-pre-wrap break-all leading-relaxed">
              {htmlContent}
            </pre>
          </div>
        </div>
      </div>
    </div>
  );
}

function FigmaMcpViewer({ blob }: { blob: Blob }) {
  const [scriptContent, setScriptContent] = useState("");
  const [meta, setMeta] = useState<{ description?: string; usage?: string; metadata?: any }>({});
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    blob.text().then((raw) => {
      try {
        const parsed = JSON.parse(raw);
        setScriptContent(parsed.script || "");
        setMeta({ description: parsed.description, usage: parsed.usage, metadata: parsed.metadata });
      } catch {
        setScriptContent(raw);
      }
    });
  }, [blob]);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(scriptContent);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = scriptContent;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }, [scriptContent]);

  const lineCount = scriptContent.split("\n").length;

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-2 px-3 py-2 bg-brand-medium border-b border-brand-light/50">
        <Terminal size={14} className="text-yellow-400" />
        <span className="text-xs font-medium text-slate-300">Figma Plugin API Script</span>
        <span className="text-[10px] text-slate-500 font-mono">{lineCount} lines</span>
        <div className="flex-1" />
        <button
          onClick={handleCopy}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium bg-yellow-500/20 text-yellow-400 hover:bg-yellow-500/30 transition-colors"
        >
          {copied ? <Check size={12} /> : <Copy size={12} />}
          {copied ? "Copied!" : "Copy Script"}
        </button>
      </div>
      <div className="flex-1 overflow-auto p-6 bg-[#1a1a2e]">
        <div className="max-w-3xl mx-auto">
          <div className="bg-brand-medium border border-brand-light rounded-xl p-5 mb-4">
            <h3 className="text-sm font-semibold text-white mb-2">How to use this script</h3>
            <ol className="text-xs text-slate-400 space-y-1.5 list-decimal list-inside">
              <li>Click <strong className="text-yellow-400">Copy Script</strong> above</li>
              <li>Open Figma and go to <strong>Plugins &gt; Development &gt; Console</strong> (or press <kbd className="px-1.5 py-0.5 bg-brand-dark rounded text-[10px] font-mono text-slate-300">Ctrl+Alt+I</kbd>)</li>
              <li>Paste the script and press Enter</li>
              <li>Alternatively, use the <code className="px-1 py-0.5 bg-brand-dark rounded text-[10px] font-mono text-pink-400">render_html</code> MCP tool with <code className="px-1 py-0.5 bg-brand-dark rounded text-[10px] font-mono text-pink-400">{"{html: ..., name: ...}"}</code></li>
            </ol>
            {meta.metadata && (
              <div className="flex gap-4 mt-3 pt-3 border-t border-brand-light/30 text-[10px] text-slate-500 font-mono">
                {meta.metadata.elementCount && <span>{meta.metadata.elementCount} nodes</span>}
                {meta.metadata.sourceWidth && <span>{meta.metadata.sourceWidth}x{meta.metadata.sourceHeight}px</span>}
                {meta.metadata.pageName && <span>{meta.metadata.pageName}</span>}
              </div>
            )}
          </div>
          <div className="bg-brand-dark rounded-lg border border-brand-light/30 overflow-hidden">
            <div className="flex items-center gap-2 px-3 py-1.5 bg-brand-medium border-b border-brand-light/30">
              <span className="text-[10px] text-slate-500 font-mono">figma-plugin-api.js</span>
            </div>
            <pre className="p-4 text-[11px] text-slate-300 font-mono overflow-auto max-h-[60vh] leading-relaxed">
              {scriptContent.split("\n").map((line, i) => (
                <div key={i} className="flex">
                  <span className="text-slate-600 w-8 text-right pr-3 shrink-0 select-none">{i + 1}</span>
                  <span className="flex-1 whitespace-pre">{line}</span>
                </div>
              ))}
            </pre>
          </div>
        </div>
      </div>
    </div>
  );
}

function ProgressBar({ progress, className }: { progress: FigmaConnectorProgress; className?: string }) {
  const pct = progress.total > 0 ? Math.round((progress.current / progress.total) * 100) : 0;
  return (
    <div className={"w-full" + (className ? " " + className : "")}>
      <div className="flex items-center justify-between mb-1">
        <span className="text-[10px] text-slate-400">
          {progress.phase === "sending" ? `Sending chunk ${progress.current} of ${progress.total}` : progress.phase}
        </span>
        <span className="text-[10px] text-slate-500">{pct}%</span>
      </div>
      <div className="w-full h-1.5 bg-brand-dark rounded-full overflow-hidden">
        <div
          className="h-full bg-violet-500 rounded-full transition-all duration-300 ease-out"
          style={{ width: pct + "%" }}
        />
      </div>
      {progress.errors ? (
        <span className="text-[9px] text-red-400 mt-0.5 block">{progress.errors} chunk(s) failed</span>
      ) : null}
    </div>
  );
}

var CHUNK_COLORS = ["#6366f1","#8b5cf6","#a855f7","#d946ef","#ec4899","#f43f5e","#f97316","#eab308","#22c55e","#14b8a6","#06b6d4","#3b82f6"];
var CHUNK_COLOR_NAMES = ["indigo","purple","fuchsia","pink","rose","red","orange","yellow","green","teal","cyan","blue"];

function ChunkGrid({ chunks, pageW, pageH, className }: { chunks: FigmaChunkMeta[]; pageW: number; pageH: number; className?: string }) {
  if (!chunks || chunks.length === 0) return null;
  var collapsed = window.sessionStorage ? sessionStorage.getItem("chunkGridCollapsed") === "true" : false;
  var [isCollapsed, setIsCollapsed] = useState(collapsed);

  var scaleX = 380 / Math.max(pageW, 1);
  var scaleY = 220 / Math.max(pageH, 1);
  var scale = Math.min(scaleX, scaleY, 1);
  var totalSize = chunks.reduce<number>(function(s, c) { return s + (c.size || 0); }, 0);

  function toggleCollapse() {
    var next = !isCollapsed;
    setIsCollapsed(next);
    if (window.sessionStorage) sessionStorage.setItem("chunkGridCollapsed", next ? "true" : "false");
  }

  return (
    <div className={"bg-brand-medium border border-brand-light/30 rounded-xl overflow-hidden " + (className || "")}>
      <button onClick={toggleCollapse} className="w-full flex items-center gap-2 px-4 py-2.5 hover:bg-brand-light/20 transition-colors text-left">
        <Grid3x3 size={14} className="text-violet-400 shrink-0" />
        <span className="text-xs font-semibold text-white">Chunk Layout</span>
        <span className="text-[10px] text-slate-500 font-mono">{chunks.length} parts · {(totalSize / 1024).toFixed(1)} KB</span>
        <div className="flex-1" />
        <span className="text-[10px] text-slate-600">{isCollapsed ? "Show" : "Hide"}</span>
      </button>

      {!isCollapsed && (
        <div className="p-4 pt-2 border-t border-brand-light/20">
          <div className="flex gap-4">
            <div className="shrink-0" style={{ width: Math.round(pageW * scale), height: Math.round(pageH * scale), position: "relative", background: "#1a1a2e", borderRadius: 4, overflow: "hidden" }}>
              {chunks.map(function(c, i) {
                var color = CHUNK_COLORS[i % CHUNK_COLORS.length];
                return (
                  <div key={i} title={"#" + (i + 1) + ": " + c.label} style={{
                    position: "absolute",
                    left: Math.round(c.bounds.x * scale),
                    top: Math.round(c.bounds.y * scale),
                    width: Math.max(Math.round(c.bounds.w * scale), 4),
                    height: Math.max(Math.round(c.bounds.h * scale), 4),
                    background: color + "25",
                    border: "1px solid " + color,
                    borderRadius: 2,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: 8,
                    color: "#fff",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                    padding: "0 2px",
                    cursor: "default",
                  }}>
                    <span style={{ background: color + "60", padding: "0 3px", borderRadius: 2, lineHeight: "12px" }}>{i + 1}</span>
                  </div>
                );
              })}
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-[10px] text-slate-400 mb-1.5 font-medium">Chunks</div>
              <div className="space-y-0.5 max-h-[180px] overflow-y-auto pr-1">
                {chunks.map(function(c, i) {
                  var color = CHUNK_COLORS[i % CHUNK_COLORS.length];
                  var name = CHUNK_COLOR_NAMES[i % CHUNK_COLOR_NAMES.length];
                  return (
                    <div key={i} className="flex items-center gap-2 text-[10px] py-0.5">
                      <span style={{ background: color, width: 8, height: 8, borderRadius: 2, display: "inline-block" }} />
                      <span className="text-slate-300 font-mono w-4 shrink-0">#{i + 1}</span>
                      <span className="text-slate-500 truncate flex-1">{c.label}</span>
                      <span className="text-slate-500 font-mono shrink-0">{c.elementCount} el</span>
                      <span className="text-slate-600 font-mono shrink-0">{((c.size || 0) / 1024).toFixed(1)}K</span>
                    </div>
                  );
                })}
              </div>
              <div className="flex items-center gap-2 mt-2 pt-1.5 border-t border-brand-light/20 text-[10px] text-slate-600">
                <span>Page: {pageW}×{pageH}px</span>
                <span>·</span>
                <span>Scale: {scale.toFixed(2)}</span>
                <span>·</span>
                <span>{(totalSize / 1024).toFixed(1)} KB total</span>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ConnectorConsole({ logs, maxHeight }: { logs?: FigmaLogEntry[] | null; maxHeight?: number }) {
  var ref = useRef<HTMLDivElement>(null);
  useEffect(function() {
    if (ref.current) ref.current.scrollTop = ref.current.scrollHeight;
  }, [logs]);

  if (!logs || logs.length === 0) return null;

  return (
    <div className="bg-brand-dark border border-brand-light/30 rounded-lg mt-2">
      <div className="flex items-center gap-1.5 px-3 py-1.5 border-b border-brand-light/30">
        <Terminal size={12} className="text-slate-500" />
        <span className="text-[10px] font-medium text-slate-500">Connector Log</span>
        <span className="text-[9px] text-slate-600">{logs.length} entries</span>
      </div>
      <div ref={ref} style={{ maxHeight: maxHeight || 150, overflowY: "auto" }} className="p-2 font-mono text-[10px] leading-relaxed">
        {logs.map(function(e, i) {
          var time = e.t ? e.t.substring(11, 23) : "";
          var isError = e.msg.toLowerCase().indexOf("fail") >= 0 || e.msg.toLowerCase().indexOf("error") >= 0;
          var isSend = e.msg.indexOf("Sending") === 0;
          return (
            <div key={i} className={"flex gap-2 " + (isError ? "text-red-400" : isSend ? "text-emerald-400" : "text-slate-400")}>
              <span className="text-slate-600 shrink-0 w-14">{time}</span>
              <span className="break-all">{e.msg}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function FigmaPluginViewer({ blob }: { blob: Blob }) {
  const [data, setData] = useState<any>(null);
  const [copied, setCopied] = useState(false);
  const [figmaStatus, setFigmaStatus] = useState<FigmaConnectorStatus | null>(null);
  const [sending, setSending] = useState(false);
  const [sendResult, setSendResult] = useState<{ success: boolean; message: string } | null>(null);
  const [progress, setProgress] = useState<FigmaConnectorProgress | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [stopping, setStopping] = useState(false);

  useEffect(() => {
    blob.text().then((raw) => {
      try { setData(JSON.parse(raw)); } catch { setData({ error: "Failed to parse response" }); }
    });
  }, [blob]);

  const stopPolling = useCallback(() => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
  }, []);

  const startPolling = useCallback(() => {
    stopPolling();
    pollRef.current = setInterval(async () => {
      try {
        const s = await getFigmaStatus();
        setFigmaStatus(s);
        setProgress(s.progress);
        if (!s.progress) { stopPolling(); }
      } catch { stopPolling(); }
    }, 1500);
  }, [stopPolling]);

  useEffect(() => {
    getFigmaStatus().then(setFigmaStatus).catch(() => {
      setFigmaStatus({ running: false, initialized: false, figmaConnected: false, mode: null, pid: null, progress: null, connection: null, logs: null });
    });
    return stopPolling;
  }, [stopPolling]);

  const handleRefreshStatus = useCallback(async () => {
    try {
      const s = await getFigmaStatus();
      setFigmaStatus(s);
      setProgress(s.progress);
      if (s.progress) startPolling();
    } catch {
      setFigmaStatus({ running: false, initialized: false, figmaConnected: false, mode: null, pid: null, progress: null, connection: null, logs: null });
    }
  }, [startPolling]);

  const handleCopy = useCallback(async () => {
    if (!data?.inlinedHtml) return;
    try {
      await navigator.clipboard.writeText(data.inlinedHtml);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = data.inlinedHtml;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }, [data]);

  const handleConnect = useCallback(async () => {
    try {
      setFigmaStatus(null);
      const result = await connectFigma();
      setFigmaStatus(result.connector);
    } catch {
      setFigmaStatus({ running: false, initialized: false, figmaConnected: false, mode: null, pid: null, progress: null, connection: null, logs: null });
    }
  }, []);

  const handleStop = useCallback(async () => {
    setStopping(true);
    try {
      await stopFigma();
      setFigmaStatus({ running: false, initialized: false, figmaConnected: false, mode: null, pid: null, progress: null, connection: null, logs: null });
    } catch {}
    setStopping(false);
  }, []);

  const handleRestart = useCallback(async () => {
    setStopping(true);
    try {
      const result = await restartFigma();
      setFigmaStatus(result.connector);
    } catch {}
    setStopping(false);
  }, []);

  const handleSendToFigma = useCallback(async () => {
    if (!data?.inlinedHtml) return;
    setSending(true);
    setSendResult(null);
    setProgress(null);
    startPolling();
    try {
      const result = await runInFigma(data.inlinedHtml, data?.metadata?.pageName || "HTML Export");
      setSendResult({ success: true, message: "Design sent to Figma successfully!" });
      stopPolling();
      await handleRefreshStatus();
    } catch (err: any) {
      const msg = err?.response?.data?.error || err?.message || "Failed to send to Figma";
      setSendResult({ success: false, message: msg });
      stopPolling();
    } finally {
      setSending(false);
    }
  }, [data, startPolling, stopPolling, handleRefreshStatus]);

  if (!data) return (
    <div className="flex-1 flex items-center justify-center">
      <span className="text-sm text-slate-500">Loading...</span>
    </div>
  );

  if (data.error) return (
    <div className="flex-1 flex items-center justify-center">
      <span className="text-sm text-red-400">{data.error}</span>
    </div>
  );

  const meta = data.metadata || {};
  const figmaResult = data.figmaResult;

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-2 px-3 py-2 bg-brand-medium border-b border-brand-light/50">
        <Figma size={14} className="text-violet-400" />
        <span className="text-xs font-medium text-slate-300">Figma Plugin Connector</span>
        <span className="text-[10px] text-slate-500 font-mono">{meta.elementCount || '?'} elements</span>
        <div className="flex-1" />
        <button
          onClick={handleCopy}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium bg-teal-500/20 text-teal-400 hover:bg-teal-500/30 transition-colors"
        >
          {copied ? <Check size={12} /> : <Copy size={12} />}
          {copied ? "Copied!" : "Copy HTML"}
        </button>
      </div>
      <div className="flex-1 overflow-auto p-6 bg-[#1a1a2e]">
        <div className="max-w-3xl mx-auto">
          <div className="bg-brand-medium border border-brand-light rounded-xl p-5 mb-4">
            <h3 className="text-sm font-semibold text-white mb-2">Send to Figma via Connector</h3>
            <p className="text-xs text-slate-400 mb-2">
              This converter extracts the DOM and builds inlined HTML for the render_html MCP tool.
            </p>
            <div className="p-2.5 bg-amber-500/10 border border-amber-500/30 rounded-lg mb-3">
              <p className="text-[10px] text-amber-400">
                <strong>⚠ Limited styling accuracy.</strong> The @ai.to.design/figma-connector's CSS parser
                extracts fewer style tokens than html.to.design. Elements appear but colors/fonts may be off.
                For perfect accuracy use the <strong>html.to.design plugin</strong> with the generated
                <strong> Inline HTML</strong> (export from left sidebar, paste into plugin's HTML tab).
              </p>
            </div>
            <div className="bg-brand-dark border border-brand-light/30 rounded-lg p-4">
              <div className="flex items-center gap-2 mb-3">
                <Figma size={14} className="text-blue-400" />
                <span className="text-xs font-medium text-white">Figma Connection</span>
                {figmaStatus ? (
                  <span className={`flex items-center gap-1 text-[10px] ${figmaStatus.figmaConnected ? (figmaStatus.connection?.stability === 'connecting' ? 'text-yellow-400' : 'text-emerald-400') : 'text-slate-500'}`}>
                    {figmaStatus.figmaConnected ? <Wifi size={10} /> : <WifiOff size={10} />}
                    {(() => {
                      if (!figmaStatus.running) return 'Not connected';
                      if (!figmaStatus.figmaConnected) return 'Connector running, waiting for Figma';
                      if (figmaStatus.connection?.stability === 'connecting') return 'Connecting...';
                      var label = 'Connected';
                      if ((figmaStatus.connection?.reconnectCount || 0) > 3) label += ' (unstable)';
                      return label;
                    })()}
                  </span>
                ) : (
                  <span className="text-[10px] text-slate-500">Checking...</span>
                )}
                <div className="flex-1" />
                <button
                  onClick={handleRefreshStatus}
                  className="text-[10px] text-slate-500 hover:text-slate-300 transition-colors"
                  title="Refresh status"
                >
                  <RotateCcw size={10} />
                </button>
              </div>

              {progress && (
                <ProgressBar progress={progress} className="mb-3" />
              )}

              {!figmaStatus?.running ? (
                <button
                  onClick={handleConnect}
                  className="w-full px-3 py-2 text-xs rounded-lg bg-blue-500/20 text-blue-400 hover:bg-blue-500/30 transition-colors font-medium"
                >
                  Start Figma Connector
                </button>
              ) : (
                <div className="space-y-2">
                  <button
                    onClick={handleSendToFigma}
                    disabled={sending}
                    className="w-full px-3 py-2 text-xs rounded-lg bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/30 transition-colors font-medium disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                  >
                    {sending ? <Loader2 size={12} className="animate-spin" /> : null}
                    {sending ? 'Sending...' : 'Send to Figma'}
                  </button>
                  <div className="flex gap-2">
                    <button
                      onClick={handleStop}
                      disabled={stopping}
                      className="flex-1 px-2 py-1.5 text-[10px] rounded bg-red-500/20 text-red-400 hover:bg-red-500/30 transition-colors disabled:opacity-50"
                    >
                      {stopping ? 'Stopping...' : 'Stop Connector'}
                    </button>
                    <button
                      onClick={handleRestart}
                      disabled={stopping}
                      className="flex-1 px-2 py-1.5 text-[10px] rounded bg-yellow-500/20 text-yellow-400 hover:bg-yellow-500/30 transition-colors disabled:opacity-50"
                    >
                      {stopping ? 'Restarting...' : 'Restart'}
                    </button>
                  </div>
                </div>
              )}
              {sendResult && (
                <div className={`mt-2 text-[10px] ${sendResult.success ? 'text-emerald-400' : 'text-red-400'}`}>
                  {sendResult.message}
                </div>
              )}
              {figmaResult && (
                <div className={`mt-2 text-[10px] ${figmaResult.success ? 'text-emerald-400' : 'text-red-400'}`}>
                  {figmaResult.message}
                </div>
              )}
              <ConnectorConsole logs={figmaStatus?.logs} />
            </div>
          </div>
          {figmaStatus?.progress?.chunks && figmaStatus.progress.chunks.length > 0 ? (
            <ChunkGrid chunks={figmaStatus.progress.chunks} pageW={meta.sourceWidth || 1440} pageH={meta.sourceHeight || 900} className="mb-4" />
          ) : null}
          <div className="bg-brand-dark rounded-lg border border-brand-light/30 overflow-hidden">
            <div className="flex items-center gap-2 px-3 py-1.5 bg-brand-medium border-b border-brand-light/30">
              <span className="text-[10px] text-slate-500 font-mono">connector.html</span>
              <span className="text-[10px] text-slate-600 font-mono">{(data.inlinedHtml?.length / 1024 || 0).toFixed(0)} KB</span>
            </div>
            <pre className="p-4 text-[11px] text-slate-300 font-mono overflow-auto max-h-[60vh] whitespace-pre-wrap break-all leading-relaxed">
              {data.inlinedHtml?.substring(0, 5000)}
              {(data.inlinedHtml?.length || 0) > 5000 && (
                <span className="text-slate-500">{"\n\n... (" + (((data.inlinedHtml?.length || 0) - 5000) / 1024).toFixed(0) + " KB truncated)"}</span>
              )}
            </pre>
          </div>
        </div>
      </div>
    </div>
  );
}

var TIER_ORDER = ["figma-plugin", "fig-file"];
var TIER_META: Record<string, { badge: string; badgeClass: string; icon: string }> = {
  "figma-plugin": { badge: "Plugin", badgeClass: "bg-violet-500/20 text-violet-400", icon: "figma" },
  "fig-file": { badge: "Download", badgeClass: "bg-emerald-500/20 text-emerald-400", icon: "figma" },
};

function FigmaAllViewer({ blob }: { blob: Blob }) {
  const [data, setData] = useState<any>(null);
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [figmaStatus, setFigmaStatus] = useState<FigmaConnectorStatus | null>(null);
  const [sending, setSending] = useState(false);
  const [sendResult, setSendResult] = useState<{ success: boolean; message: string } | null>(null);
  const [progress, setProgress] = useState<FigmaConnectorProgress | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [stopping, setStopping] = useState(false);
  const [selectedTier, setSelectedTier] = useState<string | null>(null);

  useEffect(() => {
    blob.text().then((raw) => {
      try { var d = JSON.parse(raw); setData(d); var bestId = d?.bestTier?.id || d?.bestMethod?.id; if (bestId) setSelectedTier(bestId); } catch { setData({ error: "Failed to parse response" }); }
    });
  }, [blob]);

  const stopPolling = useCallback(() => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
  }, []);

  const startPolling = useCallback(() => {
    stopPolling();
    pollRef.current = setInterval(async () => {
      try {
        const s = await getFigmaStatus();
        setFigmaStatus(s);
        setProgress(s.progress);
        if (!s.progress) { stopPolling(); }
      } catch { stopPolling(); }
    }, 1500);
  }, [stopPolling]);

  useEffect(() => {
    getFigmaStatus().then(setFigmaStatus).catch(() => {
      setFigmaStatus({ running: false, initialized: false, figmaConnected: false, mode: null, pid: null, progress: null, connection: null, logs: null });
    });
    return stopPolling;
  }, [stopPolling]);

  const handleRefreshStatus = useCallback(async () => {
    try {
      const s = await getFigmaStatus();
      setFigmaStatus(s);
      setProgress(s.progress);
      if (s.progress) startPolling();
    } catch {
      setFigmaStatus({ running: false, initialized: false, figmaConnected: false, mode: null, pid: null, progress: null, connection: null, logs: null });
    }
  }, [startPolling]);

  const handleCopy = useCallback(async (text: string, field: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedField(field);
      setTimeout(() => setCopiedField(null), 2000);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
      setCopiedField(field);
      setTimeout(() => setCopiedField(null), 2000);
    }
  }, []);

  const handleDownload = useCallback((base64: string, filename: string) => {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    const blob = new Blob([bytes]);
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }, []);

  const handleConnect = useCallback(async () => {
    try {
      setFigmaStatus(null);
      const result = await connectFigma();
      setFigmaStatus(result.connector);
    } catch {
      setFigmaStatus({ running: false, initialized: false, figmaConnected: false, mode: null, pid: null, progress: null, connection: null, logs: null });
    }
  }, []);

  const handleStop = useCallback(async () => {
    setStopping(true);
    try {
      await stopFigma();
      setFigmaStatus({ running: false, initialized: false, figmaConnected: false, mode: null, pid: null, progress: null, connection: null, logs: null });
    } catch {}
    setStopping(false);
  }, []);

  const handleRestart = useCallback(async () => {
    setStopping(true);
    try {
      const result = await restartFigma();
      setFigmaStatus(result.connector);
    } catch {}
    setStopping(false);
  }, []);

  const handleSendToFigma = useCallback(async () => {
    var htmlToSend = "";
    if (data?.pluginHtmlRaw) {
      htmlToSend = data.pluginHtmlRaw;
    } else if (data?.enhancedHtmlRaw) {
      htmlToSend = data.enhancedHtmlRaw;
    } else if (data?.connectorHtml) {
      htmlToSend = atob(data.connectorHtml);
    } else if (data?.tiers?.["html-to-design"]?.status === "ready") {
      htmlToSend = atob(data.tiers["html-to-design"].data);
    } else if (data?.methods?.["figma-plugin"]?.data) {
      htmlToSend = atob(data.methods["figma-plugin"].data);
    } else if (data?.outputs?.html) {
      htmlToSend = atob(data.outputs.html);
    }
    if (!htmlToSend) return;
    setSending(true);
    setSendResult(null);
    setProgress(null);
    startPolling();
    try {
      const result = await runInFigma(htmlToSend, data?.metadata?.pageName || "HTML Export");
      setSendResult({ success: true, message: "Design sent to Figma successfully!" });
      setFigmaStatus(s => s ? { ...s, figmaConnected: true } : s);
      stopPolling();
      await handleRefreshStatus();
    } catch (err: any) {
      const msg = err?.response?.data?.error || err?.message || "Failed to send to Figma";
      setSendResult({ success: false, message: msg });
      stopPolling();
    } finally {
      setSending(false);
    }
  }, [data, startPolling, stopPolling, handleRefreshStatus]);

  if (!data) return (
    <div className="flex-1 flex items-center justify-center">
      <span className="text-sm text-slate-500">Loading outputs...</span>
    </div>
  );

  if (data.error) return (
    <div className="flex-1 flex items-center justify-center">
      <span className="text-sm text-red-400">{data.error}</span>
    </div>
  );

  const meta = data.metadata || {};
  const tiers = data.tiers || data.methods || {};
  const bestTier = data.bestTier || (data.bestMethod ? { id: data.bestMethod.id, label: data.bestMethod.id, quality: data.bestMethod.quality } : null);
  const errors = data.errors || [];
  const figmaResult = data.figmaResult;
  const batches = data.batches || [];
  const batchManifest = data.batchManifest || "";
  const enhancedHtmlRaw = data.enhancedHtmlRaw || "";

  return (
    <div className="flex-1 overflow-auto p-6 bg-[#1a1a2e]">
      <div className="max-w-3xl mx-auto">
        <div className="flex items-center gap-3 mb-4">
          <Sparkles size={18} className="text-violet-400" />
          <div>
            <h3 className="text-sm font-semibold text-white">Figma Unified Output</h3>
            <p className="text-[10px] text-slate-500">{meta.elementCount || '?'} elements · {meta.sourceWidth || '?'}x{meta.sourceHeight || '?'}px · {Object.keys(tiers).filter(k => tiers[k]?.status === 'ready').length} methods ready</p>
          </div>
        </div>

        {bestTier && (
          <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-xl p-4 mb-4">
            <div className="flex items-center gap-2 text-[10px] text-emerald-400 mb-1">
              <Sparkles size={12} />
              <span>Recommended method</span>
            </div>
            <div className="text-sm font-semibold text-white">{bestTier.label}</div>
            <div className="text-[10px] text-slate-400 mt-0.5">{bestTier.quality}% estimated accuracy</div>
          </div>
        )}

        <div className="space-y-2 mb-4">
          {TIER_ORDER.map(function(tierId) {
            var t = tiers[tierId];
            if (!t) return null;
            var meta = TIER_META[tierId] || { badge: tierId, badgeClass: "bg-slate-500/20 text-slate-400", icon: "file" };
            var IconIcon = meta.icon === "sparkles" ? Sparkles : meta.icon === "cloud" ? Monitor : meta.icon === "clipboard" ? Clipboard : meta.icon === "figma" ? Figma : Terminal;
            var isActive = selectedTier === tierId;
            var isReady = t.status === "ready";
            var dataStr = t.data ? (tierId === "fig-file" ? null : atob(t.data)) : null;

            return (
              <div key={tierId} className={"rounded-xl border transition-all " + (isActive ? "border-violet-500/50 bg-violet-500/5" : "border-brand-light/30 bg-brand-dark hover:border-brand-light/60")}>
                <button onClick={() => setSelectedTier(isActive ? null : tierId)} className="w-full flex items-center gap-3 px-4 py-3 text-left">
                  <div className={"flex items-center gap-2 px-2 py-0.5 rounded text-[10px] font-medium " + meta.badgeClass}>
                    <IconIcon size={10} />
                    <span>{meta.badge}</span>
                  </div>
                  <span className="text-xs font-medium text-white flex-1">{t.label}</span>
                  {!isReady ? (
                    <span className="text-[10px] text-slate-500">
                      {t.status === "unavailable" ? (t.requiresKey ? "API key required" : "Not available") : t.status === "skipped" ? "Skipped" : t.status === "failed" ? "Failed" : t.status}
                    </span>
                  ) : (
                    <span className="text-[10px] text-emerald-400/60">{t.quality}%</span>
                  )}
                </button>

                {isActive && isReady && (
                  <div className="px-4 pb-4 pt-0 border-t border-violet-500/20">
                    <p className="text-[10px] text-slate-400 mb-2 mt-2">{t.description}</p>
                    {t.warning && (
                      <div className="p-2 bg-amber-500/10 border border-amber-500/30 rounded-lg mb-2">
                        <span className="text-[10px] text-amber-400">{t.warning}</span>
                      </div>
                    )}
                    {t.pasteInstructions && t.pasteInstructions.length > 0 && (
                      <div className="mb-2">
                        <span className="text-[10px] text-slate-500 font-medium">Instructions:</span>
                        <ol className="text-[10px] text-slate-400 space-y-0.5 list-decimal list-inside mt-0.5">
                          {t.pasteInstructions.map(function(instr: string, i: number) { return <li key={i}>{instr}</li>; })}
                        </ol>
                      </div>
                    )}
                    {t.tips && t.tips.length > 0 && (
                      <div className="mb-2">
                        {t.tips.map(function(tip: string, i: number) { return <div key={i} className="text-[10px] text-slate-500">💡 {tip}</div>; })}
                      </div>
                    )}
                    <div className="flex gap-1.5 mt-2">
                      {dataStr && (
                        <button
                          onClick={() => { if (dataStr) handleCopy(dataStr, tierId + "-copy"); }}
                          className="px-2.5 py-1 text-[10px] rounded bg-violet-500/20 text-violet-400 hover:bg-violet-500/30 transition-colors font-medium"
                        >
                          {copiedField === tierId + "-copy" ? "Copied!" : "Copy"}
                        </button>
                      )}
                      {t.data && (
                        <button
                          onClick={() => handleDownload(t.data, (meta.badge || "export") + (t.downloadSuffix || ".txt"))}
                          className="px-2.5 py-1 text-[10px] rounded bg-brand-light/50 text-slate-300 hover:bg-brand-light transition-colors"
                        >
                          Download
                        </button>
                      )}
                    </div>
                  </div>
                )}

                {isActive && !isReady && (
                  <div className="px-4 pb-4 pt-0 border-t border-violet-500/20">
                    <div className="text-[10px] text-slate-500 mt-2">
                      {t.reason || "This method is not available."}
                      {t.requiresKey && (
                        <span className="block mt-1 text-amber-400">
                          Set <code className="px-1 bg-brand-dark rounded">CODE_TO_DESIGN_API_KEY</code> environment variable to enable.
                          Get a key at <span className="text-violet-400">docs-code.to.design</span> (10 free credits).
                        </span>
                      )}
                      {t.rateLimited && (
                        <span className="block mt-1 text-amber-400">Rate limited by API. Wait and try again.</span>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {batches.length > 0 && (
          <div className="bg-brand-medium border border-brand-light/30 rounded-xl p-4 mb-4">
            <div className="flex items-center gap-2 mb-3">
              <Figma size={14} className="text-violet-400" />
              <span className="text-xs font-medium text-white">Batches for Plugin Import ({batches.length} chunks, max 100KB each)</span>
            </div>
            <p className="text-[10px] text-slate-400 mb-3">
              Paste each batch into the HTM-to-Design Figma plugin in order. Each batch creates a frame with all its elements as native Figma layers.
            </p>
            <div className="space-y-2 mb-3">
              {batches.map(function(b: any, i: number) {
                var isOversized = b.oversized;
                return (
                  <div key={i} className="bg-brand-dark rounded-lg p-3 border border-brand-light/30">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs font-medium text-white">{b.label}</span>
                      <div className="flex items-center gap-2">
                        <span className={"text-[10px] " + (isOversized ? "text-red-400" : "text-slate-400")}>
                          {(b.size / 1024).toFixed(1)}KB {isOversized ? "(oversized!)" : ""}
                        </span>
                        <span className="text-[10px] text-slate-500">{b.elementCount} elements</span>
                      </div>
                    </div>
                    <div className="flex gap-1.5 mt-2">
                      {b.html && (
                        <button
                          onClick={() => handleCopy(atob(b.html), "batch-" + i + "-copy")}
                          className="px-2.5 py-1 text-[10px] rounded bg-violet-500/20 text-violet-400 hover:bg-violet-500/30 transition-colors font-medium"
                        >
                          {copiedField === "batch-" + i + "-copy" ? "Copied!" : "Copy HTML"}
                        </button>
                      )}
                      {b.html && (
                        <button
                          onClick={() => handleDownload(b.html, "chunk-" + (i + 1) + "-of-" + b.totalBatches + ".html")}
                          className="px-2.5 py-1 text-[10px] rounded bg-brand-light/50 text-slate-300 hover:bg-brand-light transition-colors"
                        >
                          Download
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
            {enhancedHtmlRaw && (
              <div className="flex gap-1.5">
                <button
                  onClick={() => handleCopy(enhancedHtmlRaw, "enhanced-html-copy")}
                  className="px-2.5 py-1 text-[10px] rounded bg-violet-500/20 text-violet-400 hover:bg-violet-500/30 transition-colors font-medium"
                >
                  {copiedField === "enhanced-html-copy" ? "Copied!" : "Copy Full HTML"}
                </button>
                <button
                  onClick={() => {
                    var blob = new Blob([enhancedHtmlRaw], { type: "text/html" });
                    var url = URL.createObjectURL(blob);
                    var a = document.createElement("a");
                    a.href = url; a.download = "full-inlined.html"; a.click();
                    setTimeout(function() { URL.revokeObjectURL(url); }, 5000);
                  }}
                  className="px-2.5 py-1 text-[10px] rounded bg-brand-light/50 text-slate-300 hover:bg-brand-light transition-colors"
                >
                  Download Full
                </button>
              </div>
            )}
            {batchManifest && (
              <div className="mt-3">
                <button
                  onClick={() => handleCopy(batchManifest, "manifest-copy")}
                  className="px-2.5 py-1 text-[10px] rounded bg-blue-500/20 text-blue-400 hover:bg-blue-500/30 transition-colors font-medium"
                >
                  {copiedField === "manifest-copy" ? "Copied!" : "Copy Manifest"}
                </button>
              </div>
            )}
          </div>
        )}

        <div className="bg-brand-medium border border-brand-light/30 rounded-xl p-4 mb-4">
          <h3 className="text-xs font-semibold text-white mb-2">Cumulative Method Guide</h3>
          <div className="space-y-2">
            <div className="flex gap-2 items-start">
              <span className="text-emerald-400 font-bold text-[10px] mt-0.5 shrink-0">★ Tier 1</span>
              <div className="text-[10px] text-slate-400">
                <strong className="text-emerald-400">html.to.design plugin</strong> — 99% accuracy. Uses full Figma Plugin API (c2d-sdk). Paste inlined HTML into plugin's HTML tab. Perfect colors, fonts, layout, shadows.
              </div>
            </div>
            <div className="flex gap-2 items-start">
              <span className="text-indigo-400 font-bold text-[10px] mt-0.5 shrink-0">★ Tier 1</span>
              <div className="text-[10px] text-slate-400">
                <strong className="text-indigo-400">code.to.design API</strong> — 98% accuracy. Powered by DivRiots. Requires API key (10 free credits). Paste clipboard data directly in Figma.
              </div>
            </div>
            <div className="flex gap-2 items-start">
              <span className="text-pink-400 font-bold text-[10px] mt-0.5 shrink-0">◆ Tier 2</span>
              <div className="text-[10px] text-slate-400">
                <strong className="text-white">Clipboard fig-kiwi</strong> — 90% accuracy. Uses @magicpatterns/html-to-figma. Requires Figma Desktop + frame selection before paste.
              </div>
            </div>
            <div className="flex gap-2 items-start">
              <span className="text-blue-400 font-bold text-[10px] mt-0.5 shrink-0">■ Tier 3</span>
              <div className="text-[10px] text-slate-400">
                <strong className="text-white">.fig File</strong> — 75% accuracy. Works offline, no plugins needed. Compatible with Figma and Penpot.
              </div>
            </div>
            <div className="flex gap-2 items-start">
              <span className="text-yellow-400 font-bold text-[10px] mt-0.5 shrink-0">▲ Tier 4</span>
              <div className="text-[10px] text-slate-400">
                <strong className="text-white">MCP Connector</strong> — 50% accuracy. Quick structural preview. Limited CSS parser, use for layout reference only.
              </div>
            </div>
          </div>
        </div>

        {errors.length > 0 && (
          <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-4 mb-3">
            <span className="text-xs text-red-400 font-medium">Errors:</span>
            {errors.map((e: any, i: number) => (
              <div key={i} className="text-[10px] text-red-400/70 mt-1">{(e.method || e.tier || e.format || "engine")}: {typeof e.error === "string" ? e.error : JSON.stringify(e.error)}</div>
            ))}
          </div>
        )}

        {figmaResult && (
          <div className={`border rounded-lg p-4 mb-3 ${figmaResult.success ? 'bg-emerald-500/10 border-emerald-500/30' : 'bg-red-500/10 border-red-500/30'}`}>
            <span className={`text-xs font-medium ${figmaResult.success ? 'text-emerald-400' : 'text-red-400'}`}>Figma Auto-Run: </span>
            <div className={`text-[10px] mt-1 ${figmaResult.success ? 'text-emerald-400/70' : 'text-red-400/70'}`}>{figmaResult.message}</div>
          </div>
        )}
      </div>
    </div>
  );
}

function InlineHtmlViewer({ blob }: { blob: Blob }) {
  const [data, setData] = useState<any>(null);
  const [rawHtml, setRawHtml] = useState("");
  const [copied, setCopied] = useState(false);
  const [activeChunk, setActiveChunk] = useState(0);

  useEffect(() => {
    blob.text().then((raw) => {
      try {
        var d = JSON.parse(raw);
        setData(d);
        if (d.html) {
          try { setRawHtml(atob(d.html)); } catch { setRawHtml(d.html); }
        }
      } catch {
        setData(null);
        setRawHtml(raw);
      }
    });
  }, [blob]);

  const displayHtml = rawHtml;
  const isChunked = data && data.batches && data.batches.length > 0;
  const chunkCount = isChunked ? data.batches.length : 0;

  const handleCopy = useCallback(async () => {
    var text = displayHtml;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }, [displayHtml]);

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-2 px-3 py-2 bg-brand-medium border-b border-brand-light/50">
        <FileCode size={14} className="text-teal-400" />
        <span className="text-xs font-medium text-slate-300">Inline HTML</span>
        <span className="text-[10px] text-slate-500 font-mono">{(displayHtml.length / 1024).toFixed(0)} KB</span>
        {isChunked && (
          <span className="text-[10px] text-amber-400 font-mono">{chunkCount} chunks</span>
        )}
        <div className="flex-1" />
        <button
          onClick={handleCopy}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium bg-teal-500/20 text-teal-400 hover:bg-teal-500/30 transition-colors"
        >
          {copied ? <Check size={12} /> : <Copy size={12} />}
          {copied ? "Copied!" : "Copy HTML"}
        </button>
      </div>
      <div className="flex-1 overflow-auto p-6 bg-[#1a1a2e]">
        <div className="max-w-3xl mx-auto">
          <div className="bg-brand-medium border border-brand-light rounded-xl p-5 mb-4">
            <h3 className="text-sm font-semibold text-white mb-2">
              {isChunked ? "Chunked HTML with inlined CSS (" + chunkCount + " x 100KB chunks)" : "Single-file HTML with inlined CSS"}
            </h3>
            <p className="text-xs text-slate-400 mb-3">
              CSS has been inlined into element style attributes using juice.
              {isChunked ? " The source HTML was split into " + chunkCount + " chunks of ≤100KB each for easier handling." : ""}
              No external stylesheets needed.
            </p>

            {isChunked && data.batchesExportPath && (
              <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-lg p-3 mb-3">
                <h4 className="text-xs font-medium text-emerald-400 mb-1">Chunks exported to disk</h4>
                <p className="text-[10px] text-slate-400 font-mono break-all">{data.batchesExportPath}</p>
              </div>
            )}

            {isChunked && (
              <div className="bg-brand-dark border border-brand-light/30 rounded-lg p-3 mb-3">
                <h4 className="text-xs font-medium text-white mb-1.5">Chunks</h4>
                <div className="space-y-1 max-h-40 overflow-y-auto">
                  {data.batches.map(function(b: any, idx: number) {
                    return (
                      <div key={idx} className="flex items-center gap-2 text-[10px] text-slate-400 py-0.5">
                        <span className="text-teal-400 font-medium">#{idx + 1}</span>
                        <span className="text-slate-500">{(b.size / 1024).toFixed(1)}KB</span>
                        <span className="text-slate-600">{b.elementCount || '?'} els</span>
                        <span className="text-slate-600 font-mono text-[9px] truncate flex-1">{b.filename}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {data && data.batchManifest && (
              <div className="bg-brand-dark border border-brand-light/30 rounded-lg p-3 mb-3">
                <div className="flex items-center justify-between mb-1">
                  <h4 className="text-xs font-medium text-white">Manifest</h4>
                  <button
                    onClick={function() { navigator.clipboard.writeText(data.batchManifest); }}
                    className="text-[9px] text-blue-400 hover:text-blue-300"
                  >
                    Copy
                  </button>
                </div>
                <pre className="text-[9px] text-slate-500 font-mono whitespace-pre-wrap max-h-24 overflow-y-auto">{data.batchManifest}</pre>
              </div>
            )}

            <div className="bg-brand-dark border border-brand-light/30 rounded-lg p-3">
              <h4 className="text-xs font-medium text-white mb-1.5">Use with html.to.design</h4>
              <ol className="text-[10px] text-slate-400 space-y-1 list-decimal list-inside">
                <li>Click <strong className="text-teal-400">Copy HTML</strong> above</li>
                <li>Open <a href="https://www.figma.com/community/plugin/1159123024924461424/html-to-design-by-divriots-import-websites-to-figma-designs-web-html-css" target="_blank" rel="noopener" className="text-violet-400 hover:underline">html.to.design</a> plugin in Figma</li>
                <li>Switch to the <strong className="text-white">HTML tab</strong></li>
                <li>Paste the HTML code — it will be converted to editable Figma layers</li>
              </ol>
            </div>
          </div>
          <div className="bg-brand-dark rounded-lg border border-brand-light/30 overflow-hidden">
            <div className="flex items-center gap-2 px-3 py-1.5 bg-brand-medium border-b border-brand-light/30">
              <span className="text-[10px] text-slate-500 font-mono">inline.html</span>
            </div>
            <pre className="p-4 text-[11px] text-slate-300 font-mono overflow-auto max-h-[60vh] whitespace-pre-wrap break-all leading-relaxed">
              {displayHtml.substring(0, 5000)}
              {displayHtml.length > 5000 && (
                <span className="text-slate-500">{"\n\n... (" + ((displayHtml.length - 5000) / 1024).toFixed(0) + " KB truncated)"}</span>
              )}
            </pre>
          </div>
        </div>
      </div>
    </div>
  );
}

function DesignFileViewer({ output, format }: { output: OutputFile; format: string }) {
  const info = FORMAT_INFO[format] || FORMAT_INFO.png;
  const Icon = info.icon;
  const [thumbnail, setThumbnail] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function extractThumbnail() {
      try {
        const JSZip = (await import("jszip")).default;
        const zip = await JSZip.loadAsync(output.blob);

        let pngFile = null;
        if (format === "figma") {
          pngFile = zip.file("thumbnail.png");
        } else if (format === "psd") {
          pngFile = zip.file("_full-page.png") || zip.file("thumbnail.png");
        } else if (format === "xd") {
          const thumbDir = zip.folder("thumbnails");
          if (thumbDir) {
            const files = Object.keys(thumbDir.files);
            pngFile = files.length > 0 ? thumbDir.file(files[0]) : null;
          }
        }

        if (pngFile && !cancelled) {
          const blob = await pngFile.async("blob");
          setThumbnail(URL.createObjectURL(blob));
        }
      } catch {}
      if (!cancelled) setLoading(false);
    }
    extractThumbnail();
    return () => { cancelled = true; };
  }, [output.blob, format]);

  return (
    <div className="flex-1 flex flex-col items-center justify-center p-8 overflow-auto">
      <div className="bg-brand-medium border border-brand-light rounded-xl p-6 max-w-lg w-full">
        {thumbnail ? (
          <div className="mb-4 rounded-lg overflow-hidden bg-[#1a1a2e] border border-brand-light/30">
            <img src={thumbnail} alt={`${info.label} preview`} className="w-full h-auto" />
          </div>
        ) : (
          <div className="mb-4 rounded-lg bg-[#1a1a2e] border border-brand-light/30 flex items-center justify-center h-48">
            {loading ? (
              <span className="text-xs text-slate-500">Extracting preview...</span>
            ) : (
              <div className={`p-4 rounded-full bg-brand-dark ${info.color}`}>
                <Icon size={32} />
              </div>
            )}
          </div>
        )}
        <div className="flex items-center gap-2 mb-2">
          <Icon size={16} className={info.color} />
          <h3 className="text-sm font-semibold text-white">{info.label} File</h3>
        </div>
        <div className="space-y-1.5 text-left bg-brand-dark rounded-lg p-3 mb-3">
          <div className="flex justify-between text-xs">
            <span className="text-slate-500">Filename</span>
            <span className="text-slate-300 font-mono truncate ml-2">{output.filename}</span>
          </div>
          <div className="flex justify-between text-xs">
            <span className="text-slate-500">Size</span>
            <span className="text-slate-300 font-mono">{formatFileSize(output.size)}</span>
          </div>
          <div className="flex justify-between text-xs">
            <span className="text-slate-500">Format</span>
            <span className="text-slate-300 font-mono">{format.toUpperCase()}</span>
          </div>
        </div>
        <p className="text-xs text-slate-500 text-center">
          {format === "figma" && "Open in Figma, Penpot, or compatible design tools."}
          {format === "psd" && "Open in Photoshop, GIMP, Photopea, or Affinity Photo."}
          {format === "xd" && "Open in Sketch, Figma, Penpot, Adobe XD, or compatible editors."}
        </p>
      </div>
    </div>
  );
}

export default function OutputViewer({ output, onClose, onReExport, onCompare }: OutputViewerProps) {
  const [copied, setCopied] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const format = output.format;
  const info = FORMAT_INFO[format] || FORMAT_INFO.png;

  const handleDownload = useCallback(() => {
    const a = document.createElement("a");
    a.href = output.url;
    a.download = output.filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }, [output]);

  const handleCopyToClipboard = useCallback(async () => {
    if (format === "png" || format === "svg") {
      try {
        const item = new ClipboardItem({ [output.blob.type]: output.blob });
        await navigator.clipboard.write([item]);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      } catch {}
    }
  }, [output, format]);

  const renderViewer = () => {
    switch (format) {
      case "png":
        return <ImageViewer url={output.url} format={format} />;
      case "pdf":
        return <PdfViewer url={output.url} />;
      case "svg":
        return <SvgViewer url={output.url} blob={output.blob} />;
      case "clipboard":
        return <ClipboardViewer blob={output.blob} />;
      case "figma-mcp":
        return <FigmaMcpViewer blob={output.blob} />;
      case "figma-plugin":
        return <FigmaPluginViewer blob={output.blob} />;
      case "figma-all":
        return <FigmaAllViewer blob={output.blob} />;
      case "inline":
        return <InlineHtmlViewer blob={output.blob} />;
      case "figma":
      case "psd":
      case "xd":
        return <DesignFileViewer output={output} format={format} />;
      default:
        return <ImageViewer url={output.url} format={format} />;
    }
  };

  const containerClass = fullscreen
    ? "fixed inset-0 z-50 bg-brand-dark flex flex-col"
    : "flex flex-col h-full";

  return (
    <div className={containerClass}>
      <div className="flex items-center justify-between px-4 py-2 bg-brand-medium border-b border-brand-light/50">
        <div className="flex items-center gap-3">
          <div className={`flex items-center gap-2 ${info.color}`}>
            <info.icon size={16} />
            <span className="text-sm font-semibold text-white">{info.label} Output</span>
          </div>
          <span className="text-xs text-slate-500">{formatFileSize(output.size)}</span>
        </div>
        <div className="flex items-center gap-1">
          {onCompare && (
            <button
              onClick={onCompare}
              className="px-2.5 py-1 text-xs rounded bg-purple-500/20 text-purple-400 hover:bg-purple-500/30 transition-colors font-medium"
            >
              Compare Accuracy
            </button>
          )}
          {onReExport && (
            <button
              onClick={() => onReExport(format)}
              className="px-2.5 py-1 text-xs rounded bg-brand-light/50 text-slate-300 hover:bg-brand-light transition-colors"
            >
              Re-export
            </button>
          )}
          {(format === "png" || format === "svg") && (
            <button
              onClick={handleCopyToClipboard}
              className="p-1.5 rounded hover:bg-brand-light/50 text-slate-400 hover:text-white transition-colors"
              title="Copy to clipboard"
            >
              {copied ? <Check size={14} className="text-emerald-400" /> : <Copy size={14} />}
            </button>
          )}
          <button
            onClick={handleDownload}
            className="p-1.5 rounded hover:bg-brand-light/50 text-slate-400 hover:text-white transition-colors"
            title="Download"
          >
            <Download size={14} />
          </button>
          <button
            onClick={() => setFullscreen(!fullscreen)}
            className="p-1.5 rounded hover:bg-brand-light/50 text-slate-400 hover:text-white transition-colors"
            title={fullscreen ? "Exit fullscreen" : "Fullscreen"}
          >
            {fullscreen ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
          </button>
          <button
            onClick={onClose}
            className="p-1.5 rounded hover:bg-red-500/20 text-slate-400 hover:text-red-400 transition-colors"
            title="Close viewer"
          >
            <X size={14} />
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-auto">
        {renderViewer()}
      </div>
    </div>
  );
}
