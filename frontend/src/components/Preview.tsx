import { useRef, useEffect, useState, useCallback } from "react";
import { RefreshCw, Maximize2, Minimize2, MousePointer2, Info, X, ExternalLink } from "lucide-react";

interface SelectedElement {
  tag: string;
  classes: string;
  id: string;
  rect: { x: number; y: number; w: number; h: number };
  styles: Record<string, string>;
  text?: string;
  xpath?: string;
}

interface PreviewProps {
  html: string;
  css: string;
  width: number;
  height?: number;
  onElementSelect?: (el: SelectedElement | null) => void;
  onElementUpdate?: (xpath: string, property: string, value: string) => void;
  selectionMode?: boolean;
}

const SELECTION_SCRIPT = `
(function() {
  var selected = null;
  var overlay = null;
  var infoBox = null;
  var enabled = false;

  function createOverlay() {
    if (overlay) return;
    overlay = document.createElement('div');
    overlay.id = '__preview-overlay__';
    overlay.style.cssText = 'position:fixed;pointer-events:none;z-index:2147483647;border:2px solid #3b82f6;background:rgba(59,130,246,0.08);display:none;transition:border-color 0.15s;';
    document.body.appendChild(overlay);
  }

  function getXPath(el) {
    if (!el || el === document.body || el === document.documentElement) return '';
    var parent = el.parentNode;
    if (!parent) return '';
    var siblings = Array.from(parent.children).filter(function(c) { return c.tagName === el.tagName; });
    var idx = siblings.indexOf(el) + 1;
    var tag = el.tagName.toLowerCase();
    var idAttr = el.id ? '[@id=\"' + el.id + '\"]' : '';
    return getXPath(parent) + '/' + tag + idAttr + (siblings.length > 1 ? '[' + idx + ']' : '');
  }

  function getComputedStyles(el) {
    var cs = window.getComputedStyle(el);
    var props = {};
    var important = [
      'display','position','width','height','top','left','right','bottom',
      'background-color','color','font-family','font-size','font-weight',
      'line-height','letter-spacing','text-align','text-decoration',
      'border-radius','border-width','border-color','border-style',
      'padding','margin','opacity','overflow','box-shadow','gap',
      'flex-direction','justify-content','align-items',
    ];
    for (var i = 0; i < important.length; i++) {
      props[important[i]] = cs.getPropertyValue(important[i]);
    }
    return props;
  }

  function highlightElement(el) {
    createOverlay();
    var rect = el.getBoundingClientRect();
    overlay.style.left = (rect.left + window.scrollX) + 'px';
    overlay.style.top = (rect.top + window.scrollY) + 'px';
    overlay.style.width = rect.width + 'px';
    overlay.style.height = rect.height + 'px';
    overlay.style.display = 'block';
    selected = el;
  }

  function clearHighlight() {
    if (overlay) overlay.style.display = 'none';
    selected = null;
  }

  function handleClick(e) {
    if (!enabled) return;
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();

    var target = e.target;
    if (!target || target === document.body || target === document.documentElement) {
      clearHighlight();
      parent.postMessage({ type: '__preview deselected__' }, '*');
      return;
    }

    highlightElement(target);
    var rect = target.getBoundingClientRect();
    parent.postMessage({
      type: '__preview elementSelected__',
      element: {
        tag: target.tagName.toLowerCase(),
        classes: target.className || '',
        id: target.id || '',
        rect: { x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.width), h: Math.round(rect.height) },
        styles: getComputedStyles(target),
        text: target.textContent ? target.textContent.trim().substring(0, 200) : '',
        xpath: getXPath(target),
      }
    }, '*');
  }

  function handleKeyDown(e) {
    if (!enabled) return;
    if (e.key === 'Escape') {
      clearHighlight();
      parent.postMessage({ type: '__preview deselected__' }, '*');
    }
  }

  function handleMouseOver(e) {
    if (!enabled || !e.target || e.target === document.body) return;
    var el = e.target;
    if (el.id === '__preview-overlay__') return;
    el.style.outline = '2px dashed rgba(59,130,246,0.5)';
    el.style.outlineOffset = '-1px';
  }

  function handleMouseOut(e) {
    if (!e.target || e.target === document.body) return;
    var el = e.target;
    el.style.outline = '';
    el.style.outlineOffset = '';
  }

  document.addEventListener('click', handleClick, true);
  document.addEventListener('keydown', handleKeyDown, true);
  document.addEventListener('mouseover', handleMouseOver, true);
  document.addEventListener('mouseout', handleMouseOut, true);

  parent.postMessage({ type: '__preview ready__' }, '*');

  window.addEventListener('message', function(e) {
    if (e.data && e.data.type === '__preview enableSelection__') {
      enabled = true;
      document.body.style.cursor = 'crosshair';
    }
    if (e.data && e.data.type === '__preview disableSelection__') {
      enabled = false;
      document.body.style.cursor = '';
      clearHighlight();
    }
    if (e.data && e.data.type === '__preview applyStyle__') {
      try {
        var xp = e.data.xpath;
        if (!xp) return;
        var result = document.evaluate(xp, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
        var node = result.singleNodeValue;
        if (node && node.nodeType === 1) {
          node.style[e.data.property] = e.data.value;
        }
      } catch(err) {}
    }
  });
})();
`;

export default function Preview({ html, css, width, height, onElementSelect, onElementUpdate, selectionMode }: PreviewProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [fullscreen, setFullscreen] = useState(false);
  const [selectedEl, setSelectedEl] = useState<SelectedElement | null>(null);
  const [loading, setLoading] = useState(true);

  const buildSrcdoc = useCallback(() => {
    return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=${width}, initial-scale=1.0" />
  <style>
    *, *::before, *::after { box-sizing: border-box; }
    html { overflow-x: hidden; }
    body { margin: 0; padding: 0; min-height: 100vh; }
    img { max-width: 100%; height: auto; }
    svg { max-width: 100%; }
    ${css}
  </style>
</head>
<body>
${html}
<script>${SELECTION_SCRIPT}</script>
</body>
</html>`;
  }, [html, css, width]);

  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe) return;
    setLoading(true);
    iframe.srcdoc = buildSrcdoc();
  }, [buildSrcdoc]);

  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe) return;

    const handleMessage = (e: MessageEvent) => {
      if (!e.data || !e.data.type) return;
      if (e.data.type === '__preview ready__') {
        setLoading(false);
        if (selectionMode) {
          iframe.contentWindow?.postMessage({ type: '__preview enableSelection__' }, '*');
        }
      }
      if (e.data.type === '__preview elementSelected__') {
        setSelectedEl(e.data.element);
        onElementSelect?.(e.data.element);
      }
      if (e.data.type === '__preview deselected__') {
        setSelectedEl(null);
        onElementSelect?.(null);
      }
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [selectionMode, onElementSelect]);

  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe || !iframe.contentWindow) return;
    iframe.contentWindow.postMessage(
      { type: selectionMode ? '__preview enableSelection__' : '__preview disableSelection__' },
      '*'
    );
  }, [selectionMode]);

  const handleRefresh = useCallback(() => {
    const iframe = iframeRef.current;
    if (!iframe) return;
    setLoading(true);
    iframe.srcdoc = buildSrcdoc();
  }, [buildSrcdoc]);

  const handleOpenExternal = useCallback(() => {
    const iframe = iframeRef.current;
    if (!iframe || !iframe.contentDocument) return;
    const blob = new Blob([iframe.contentDocument.documentElement.outerHTML], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    window.open(url, '_blank');
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }, []);

  const containerClass = fullscreen
    ? "fixed inset-0 z-50 bg-brand-dark flex flex-col"
    : "flex flex-col h-full";

  return (
    <div className={containerClass}>
      <div className="flex items-center justify-between px-3 py-1.5 bg-brand-medium border-b border-brand-light/50">
        <div className="flex items-center gap-2">
          <div className="text-xs text-slate-400 font-medium tracking-wide uppercase">Preview</div>
          {selectionMode && (
            <span className="text-[10px] bg-blue-500/20 text-blue-400 px-1.5 py-0.5 rounded font-medium">
              CLICK TO SELECT
            </span>
          )}
          {loading && (
            <span className="text-[10px] bg-amber-500/20 text-amber-400 px-1.5 py-0.5 rounded font-medium animate-pulse">
              LOADING
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={handleRefresh}
            className="p-1 rounded hover:bg-brand-light/50 text-slate-400 hover:text-white transition-colors"
            title="Refresh preview"
          >
            <RefreshCw size={13} />
          </button>
          <button
            onClick={handleOpenExternal}
            className="p-1 rounded hover:bg-brand-light/50 text-slate-400 hover:text-white transition-colors"
            title="Open in new tab"
          >
            <ExternalLink size={13} />
          </button>
          <button
            onClick={() => setFullscreen(!fullscreen)}
            className="p-1 rounded hover:bg-brand-light/50 text-slate-400 hover:text-white transition-colors"
            title={fullscreen ? "Exit fullscreen" : "Fullscreen"}
          >
            {fullscreen ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-auto bg-white relative">
        <iframe
          ref={iframeRef}
          title="Preview"
          className="border-0 w-full h-full"
          style={{ minWidth: width }}
          sandbox="allow-same-origin allow-scripts allow-popups"
        />

        {selectedEl && (
          <div className="absolute top-2 right-2 bg-brand-dark/95 border border-brand-light rounded-lg shadow-2xl p-3 max-w-xs z-50 backdrop-blur-sm">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-1.5">
                <Info size={12} className="text-blue-400" />
                <span className="text-xs font-semibold text-white">
                  &lt;{selectedEl.tag}&gt;
                  {selectedEl.id && <span className="text-amber-400">#{selectedEl.id}</span>}
                </span>
              </div>
              <button
                onClick={() => {
                  setSelectedEl(null);
                  onElementSelect?.(null);
                  iframeRef.current?.contentWindow?.postMessage({ type: '__preview deselected__' }, '*');
                }}
                className="p-0.5 rounded hover:bg-brand-light/50 text-slate-400 hover:text-white"
              >
                <X size={11} />
              </button>
            </div>
            {selectedEl.classes && (
              <div className="text-[10px] text-slate-400 mb-1 truncate">
                .{selectedEl.classes.split(' ').join('.')}
              </div>
            )}
            <div className="text-[10px] text-slate-500 mb-2">
              {selectedEl.rect.w} x {selectedEl.rect.h} at ({selectedEl.rect.x}, {selectedEl.rect.y})
            </div>
            {selectedEl.text && (
              <div className="text-[10px] text-slate-300 bg-brand-medium rounded px-2 py-1 mb-2 max-h-16 overflow-auto font-mono">
                "{selectedEl.text.substring(0, 100)}"
              </div>
            )}
            <div className="space-y-0.5">
              {['background-color', 'color', 'font-size', 'font-weight', 'padding', 'border-radius'].map(prop => (
                <div key={prop} className="flex justify-between text-[10px]">
                  <span className="text-slate-500">{prop}</span>
                  <span className="text-slate-300 font-mono truncate ml-2 max-w-[120px]">
                    {selectedEl.styles[prop] || '—'}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {fullscreen && (
        <button
          onClick={() => setFullscreen(false)}
          className="absolute top-2 left-2 bg-brand-dark/80 text-white px-3 py-1.5 rounded-lg text-xs hover:bg-brand-medium transition-colors z-50"
        >
          Exit Fullscreen
        </button>
      )}
    </div>
  );
}
