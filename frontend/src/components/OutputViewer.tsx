import { useState, useRef, useCallback, useEffect } from "react";
import {
  X, Download, ZoomIn, ZoomOut, RotateCcw, Image, FileText,
  PenTool, Figma, Layers, Monitor, Copy, Check, Maximize2, Minimize2,
} from "lucide-react";

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

      <div className="flex-1 overflow-hidden">
        {renderViewer()}
      </div>
    </div>
  );
}
