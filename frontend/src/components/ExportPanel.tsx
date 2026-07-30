import { useState } from 'react';
import { Image, FileText, PenTool, Layers, Monitor, FileCode, Sparkles, Loader2, ChevronDown, ChevronUp } from 'lucide-react';

interface Props {
  onExport: (format: string, options?: Record<string, unknown>) => void;
  exporting: string | null;
}

const formats = [
  { id: 'png', label: 'PNG', icon: Image, desc: 'Raster image', color: 'text-blue-400' },
  { id: 'pdf', label: 'PDF', icon: FileText, desc: 'Print-ready', color: 'text-red-400', hasOptions: true },
  { id: 'svg', label: 'SVG', icon: PenTool, desc: 'Vector graphic', color: 'text-green-400' },
  { id: 'figma-all', label: 'Figma All-in-One', icon: Sparkles, desc: '.fig + paste + connector HTML', color: 'text-violet-400' },
  { id: 'inline', label: 'Inline HTML', icon: FileCode, desc: 'Single HTML, styles inlined', color: 'text-teal-400' },
  { id: 'psd', label: 'PSD', icon: Layers, desc: 'Photoshop layers', color: 'text-cyan-400' },
  { id: 'xd', label: 'XD / Sketch', icon: Monitor, desc: 'Multi-editor compatible', color: 'text-orange-400' },
];

export default function ExportPanel({ onExport, exporting }: Props) {
  const [showPdfOptions, setShowPdfOptions] = useState(false);
  const [pdfFormat, setPdfFormat] = useState('A4');
  const [pdfLandscape, setPdfLandscape] = useState(false);
  const [pdfPrintBg, setPdfPrintBg] = useState(true);
  const [pdfHeaderFooter, setPdfHeaderFooter] = useState(true);
  const [pdfMargin, setPdfMargin] = useState('15mm');

  const handleExport = (format: string) => {
    if (format === 'pdf') {
      onExport('pdf', {
        format: pdfFormat,
        landscape: pdfLandscape,
        printBackground: pdfPrintBg,
        headerFooter: pdfHeaderFooter,
        margin: pdfMargin,
      });
    } else {
      onExport(format);
    }
  };

  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-sm font-semibold text-slate-300 mb-1">Export As</h3>
      {formats.map((fmt) => {
        const isLoading = exporting === fmt.id;
        const Icon = fmt.icon;
        return (
          <div key={fmt.id}>
            <button
              onClick={() => {
                if (fmt.hasOptions) {
                  setShowPdfOptions(!showPdfOptions);
                } else {
                  handleExport(fmt.id);
                }
              }}
              disabled={isLoading}
              className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg text-left transition-all group ${
                isLoading
                  ? 'bg-brand-accent/20 text-brand-accent ring-1 ring-brand-accent/50'
                  : 'bg-brand-light hover:bg-brand-medium hover:ring-1 hover:ring-brand-accent/50 text-white'
              }`}
            >
              <div className={`p-1.5 rounded-md ${isLoading ? 'bg-brand-accent/20' : 'bg-brand-medium group-hover:bg-brand-light'}`}>
                {isLoading ? (
                  <Loader2 className={`w-4 h-4 ${fmt.color} animate-spin`} />
                ) : (
                  <Icon className={`w-4 h-4 ${fmt.color}`} />
                )}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium">{fmt.label}</div>
                <div className="text-xs text-slate-400">{fmt.desc}</div>
              </div>
              {fmt.hasOptions && (
                showPdfOptions ? <ChevronUp className="w-3.5 h-3.5 text-slate-500" /> : <ChevronDown className="w-3.5 h-3.5 text-slate-500" />
              )}
              {isLoading && (
                <span className="text-xs text-brand-accent font-medium">Converting...</span>
              )}
            </button>

            {fmt.hasOptions && showPdfOptions && (
              <div className="mt-1 p-3 bg-brand-darker rounded-lg border border-brand-light space-y-2.5">
                <div className="grid grid-cols-2 gap-2">
                  <label className="text-xs text-slate-400">Page Size</label>
                  <select
                    value={pdfFormat}
                    onChange={(e) => setPdfFormat(e.target.value)}
                    className="bg-brand-light text-white text-xs rounded px-2 py-1 border border-brand-medium focus:border-brand-accent focus:outline-none"
                  >
                    <option value="A3">A3</option>
                    <option value="A4">A4</option>
                    <option value="A5">A5</option>
                    <option value="Legal">Legal</option>
                    <option value="Letter">Letter</option>
                    <option value="Tabloid">Tabloid</option>
                  </select>

                  <label className="text-xs text-slate-400">Margins</label>
                  <select
                    value={pdfMargin}
                    onChange={(e) => setPdfMargin(e.target.value)}
                    className="bg-brand-light text-white text-xs rounded px-2 py-1 border border-brand-medium focus:border-brand-accent focus:outline-none"
                  >
                    <option value="0">None</option>
                    <option value="10mm">Small</option>
                    <option value="15mm">Medium</option>
                    <option value="25mm">Large</option>
                  </select>
                </div>

                <div className="flex flex-col gap-1.5">
                  <label className="flex items-center gap-2 text-xs text-slate-400 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={pdfLandscape}
                      onChange={(e) => setPdfLandscape(e.target.checked)}
                      className="rounded border-brand-medium bg-brand-light text-brand-accent focus:ring-brand-accent"
                    />
                    Landscape orientation
                  </label>
                  <label className="flex items-center gap-2 text-xs text-slate-400 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={pdfPrintBg}
                      onChange={(e) => setPdfPrintBg(e.target.checked)}
                      className="rounded border-brand-medium bg-brand-light text-brand-accent focus:ring-brand-accent"
                    />
                    Print backgrounds
                  </label>
                  <label className="flex items-center gap-2 text-xs text-slate-400 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={pdfHeaderFooter}
                      onChange={(e) => setPdfHeaderFooter(e.target.checked)}
                      className="rounded border-brand-medium bg-brand-light text-brand-accent focus:ring-brand-accent"
                    />
                    Show header &amp; footer
                  </label>
                </div>

                <button
                  onClick={() => handleExport('pdf')}
                  disabled={isLoading}
                  className="w-full mt-1 px-3 py-1.5 bg-brand-accent text-white text-xs font-medium rounded hover:bg-brand-accent/80 transition-colors disabled:opacity-50"
                >
                  {isLoading ? 'Exporting...' : 'Export PDF'}
                </button>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
