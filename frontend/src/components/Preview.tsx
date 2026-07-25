import { useRef, useEffect, useState } from 'react';
import { Maximize2, Minimize2, RefreshCw } from 'lucide-react';

interface Props {
  html: string;
  css: string;
  width: number;
}

export default function Preview({ html, css, width }: Props) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [fullscreen, setFullscreen] = useState(false);

  useEffect(() => {
    if (!iframeRef.current) return;
    const doc = iframeRef.current.contentDocument;
    if (!doc) return;

    doc.open();
    doc.write(`<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:;" />
  <style>${css}</style>
</head>
<body>${html}</body>
</html>`);
    doc.close();
  }, [html, css]);

  const handleRefresh = () => {
    if (!iframeRef.current) return;
    const doc = iframeRef.current.contentDocument;
    if (!doc) return;
    doc.open();
    doc.write(`<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:;" />
  <style>${css}</style>
</head>
<body>${html}</body>
</html>`);
    doc.close();
  };

  return (
    <div className={`flex flex-col h-full ${fullscreen ? 'fixed inset-0 z-50 bg-brand-dark' : ''}`}>
      <div className="flex items-center justify-between px-4 py-2 border-b border-brand-light">
        <span className="text-sm font-medium text-slate-300">Live Preview</span>
        <div className="flex items-center gap-2">
          <span className="text-xs text-slate-500">{width}px</span>
          <button
            onClick={handleRefresh}
            className="p-1 text-slate-500 hover:text-white transition-colors"
            title="Refresh preview"
          >
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => setFullscreen(!fullscreen)}
            className="p-1 text-slate-500 hover:text-white transition-colors"
            title={fullscreen ? 'Exit fullscreen' : 'Fullscreen'}
          >
            {fullscreen ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
          </button>
        </div>
      </div>
      <div className="flex-1 min-h-0 bg-white overflow-auto">
        <iframe
          ref={iframeRef}
          title="Preview"
          className="w-full h-full border-0"
          style={{ minWidth: width }}
          sandbox="allow-same-origin"
        />
      </div>
    </div>
  );
}
