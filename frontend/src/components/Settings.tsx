interface ViewportPreset {
  label: string;
  width: number;
  height: number;
  icon: string;
}

const presets: ViewportPreset[] = [
  { label: 'Desktop', width: 1440, height: 900, icon: 'M4 6a2 2 0 012-2h12a2 2 0 012 2v7a2 2 0 01-2 2H6a2 2 0 01-2-2V6z' },
  { label: 'Laptop', width: 1280, height: 800, icon: 'M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z' },
  { label: 'Tablet', width: 768, height: 1024, icon: 'M12 18h.01M7 21h10a2 2 0 002-2V5a2 2 0 00-2-2H7a2 2 0 00-2 2v14a2 2 0 002 2z' },
  { label: 'Mobile', width: 375, height: 812, icon: 'M12 18h.01M8 21h8a2 2 0 002-2V5a2 2 0 00-2-2H8a2 2 0 00-2 2v14a2 2 0 002 2z' },
];

interface Props {
  width: number;
  height: number;
  scale: number;
  onWidthChange: (v: number) => void;
  onHeightChange: (v: number) => void;
  onScaleChange: (v: number) => void;
}

export default function Settings({ width, height, scale, onWidthChange, onHeightChange, onScaleChange }: Props) {
  const isPreset = (p: ViewportPreset) => width === p.width && height === p.height;

  return (
    <div className="flex flex-col gap-3">
      <h3 className="text-sm font-semibold text-slate-300">Viewport</h3>
      <div className="grid grid-cols-2 gap-2">
        {presets.map((p) => (
          <button
            key={p.label}
            onClick={() => { onWidthChange(p.width); onHeightChange(p.height); }}
            className={`flex items-center gap-2 px-3 py-2 text-xs rounded-lg transition-all ${
              isPreset(p)
                ? 'bg-brand-accent text-white shadow-lg shadow-brand-accent/20'
                : 'bg-brand-light text-slate-300 hover:bg-brand-medium hover:text-white'
            }`}
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d={p.icon} />
            </svg>
            <div className="text-left">
              <div className="font-medium">{p.label}</div>
              <div className="text-[10px] opacity-60">{p.width}x{p.height}</div>
            </div>
          </button>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-2">
        <label className="flex flex-col gap-1">
          <span className="text-xs text-slate-400">Width</span>
          <input
            type="number"
            min="320"
            max="3840"
            value={width}
            onChange={(e) => onWidthChange(Math.min(Math.max(Number(e.target.value) || 320, 320), 3840))}
            className="bg-brand-light border border-brand-light rounded px-3 py-1.5 text-sm text-white focus:outline-none focus:ring-1 focus:ring-brand-accent"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-slate-400">Height</span>
          <input
            type="number"
            min="200"
            max="2160"
            value={height}
            onChange={(e) => onHeightChange(Math.min(Math.max(Number(e.target.value) || 200, 200), 2160))}
            className="bg-brand-light border border-brand-light rounded px-3 py-1.5 text-sm text-white focus:outline-none focus:ring-1 focus:ring-brand-accent"
          />
        </label>
      </div>
      <label className="flex flex-col gap-1">
        <span className="text-xs text-slate-400">Scale ({scale}x)</span>
        <div className="flex items-center gap-2">
          <input
            type="range"
            min="1"
            max="4"
            step="0.5"
            value={scale}
            onChange={(e) => onScaleChange(Number(e.target.value))}
            className="flex-1 accent-brand-accent"
          />
          <span className="text-xs text-slate-500 w-8 text-right">{scale}x</span>
        </div>
      </label>
    </div>
  );
}
