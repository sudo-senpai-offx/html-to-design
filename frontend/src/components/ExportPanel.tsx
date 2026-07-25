import { Image, FileText, PenTool, Figma, Layers, Loader2 } from 'lucide-react';

interface Props {
  onExport: (format: string) => void;
  exporting: string | null;
}

const formats = [
  { id: 'png', label: 'PNG', icon: Image, desc: 'Raster image', color: 'text-blue-400' },
  { id: 'pdf', label: 'PDF', icon: FileText, desc: 'Print-ready', color: 'text-red-400' },
  { id: 'svg', label: 'SVG', icon: PenTool, desc: 'Vector graphic', color: 'text-green-400' },
  { id: 'figma', label: 'Figma', icon: Figma, desc: '.fig file', color: 'text-purple-400' },
  { id: 'psd', label: 'PSD', icon: Layers, desc: 'Photoshop', color: 'text-cyan-400' },
];

export default function ExportPanel({ onExport, exporting }: Props) {
  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-sm font-semibold text-slate-300 mb-1">Export As</h3>
      {formats.map((fmt) => {
        const isLoading = exporting === fmt.id;
        const Icon = fmt.icon;
        return (
          <button
            key={fmt.id}
            onClick={() => onExport(fmt.id)}
            disabled={isLoading}
            className={`flex items-center gap-3 px-4 py-3 rounded-lg text-left transition-all group ${
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
            {isLoading && (
              <span className="text-xs text-brand-accent font-medium">Converting...</span>
            )}
          </button>
        );
      })}
    </div>
  );
}
