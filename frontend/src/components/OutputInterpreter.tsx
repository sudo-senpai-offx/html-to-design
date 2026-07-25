import { useState, useCallback, useRef, useEffect } from "react";
import {
  X, BarChart3, Eye, Layers, Ruler, ArrowRight, Loader2,
  CheckCircle2, AlertTriangle, TrendingUp, ChevronDown, ChevronUp,
  RefreshCw, Download, SplitSquareHorizontal, SplitSquareVertical,
} from "lucide-react";
import { compareOutput } from "../api/client";

interface CompareResult {
  visualScore: number;
  structuralScore: number;
  layoutScore: number;
  overallScore: number;
  diffImageUrl?: string;
  originalImageUrl?: string;
  convertedImageUrl?: string;
  differences: DiffItem[];
  recommendations: string[];
  pixelAccuracy: number;
  elementCount: { original: number; converted: number };
}

interface DiffItem {
  type: string;
  severity: string;
  description: string;
  element?: string;
  original?: string;
  converted?: string;
}

interface OutputInterpreterProps {
  html: string;
  css: string;
  format: string;
  convertedBlob?: Blob;
  onClose: () => void;
  onApplyFix?: (fix: string) => void;
}

type ViewMode = "side-by-side" | "overlay" | "diff" | "onion";

function ScoreGauge({ score, label, icon: Icon }: { score: number; label: string; icon: typeof BarChart3 }) {
  const getColor = (s: number) => {
    if (s >= 90) return { ring: "stroke-emerald-500", text: "text-emerald-400", bg: "bg-emerald-500/10" };
    if (s >= 70) return { ring: "stroke-amber-500", text: "text-amber-400", bg: "bg-amber-500/10" };
    return { ring: "stroke-red-500", text: "text-red-400", bg: "bg-red-500/10" };
  };
  const colors = getColor(score);
  const circumference = 2 * Math.PI * 36;
  const offset = circumference - (score / 100) * circumference;

  return (
    <div className="flex flex-col items-center">
      <div className={`relative p-3 rounded-full ${colors.bg}`}>
        <svg width="88" height="88" viewBox="0 0 88 88" className="-rotate-90">
          <circle cx="44" cy="44" r="36" fill="none" stroke="currentColor" strokeWidth="6"
            className="text-brand-light/30" />
          <circle cx="44" cy="44" r="36" fill="none" strokeWidth="6"
            className={colors.ring}
            strokeDasharray={circumference}
            strokeDashoffset={offset}
            strokeLinecap="round"
            style={{ transition: "stroke-dashoffset 1s ease-out" }}
          />
        </svg>
        <div className="absolute inset-0 flex items-center justify-center">
          <span className={`text-lg font-bold ${colors.text}`}>{Math.round(score)}</span>
        </div>
      </div>
      <div className="flex items-center gap-1 mt-2">
        <Icon size={12} className="text-slate-400" />
        <span className="text-xs text-slate-400 font-medium">{label}</span>
      </div>
    </div>
  );
}

function DiffList({ differences }: { differences: DiffItem[] }) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const toggle = (key: string) => setExpanded(prev => ({ ...prev, [key]: !prev[key] }));

  const severityColor: Record<string, string> = { low: "text-slate-400 bg-slate-500/10", medium: "text-amber-400 bg-amber-500/10", high: "text-red-400 bg-red-500/10" };
  const typeIcon: Record<string, string> = { color: "🎨", layout: "📐", missing: "❌", extra: "➕", text: "📝", style: "✨" };

  if (differences.length === 0) {
    return (
      <div className="flex items-center justify-center p-6 text-sm text-slate-500">
        <CheckCircle2 size={16} className="mr-2 text-emerald-400" />
        No differences found — perfect match!
      </div>
    );
  }

  return (
    <div className="space-y-1 max-h-64 overflow-auto">
      {differences.map((diff, i) => {
        const key = String(i);
        const isOpen = expanded[key];
        return (
          <div key={i} className="bg-brand-dark rounded-lg border border-brand-light/30 overflow-hidden">
            <button
              onClick={() => toggle(key)}
              className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-brand-light/20 transition-colors"
            >
              <span className="text-sm">{typeIcon[diff.type] || "•"}</span>
              <span className="text-xs text-slate-300 flex-1 truncate">{diff.description}</span>
              <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${severityColor[diff.severity]}`}>
                {diff.severity}
              </span>
              {isOpen ? <ChevronUp size={12} className="text-slate-500" /> : <ChevronDown size={12} className="text-slate-500" />}
            </button>
            {isOpen && (
              <div className="px-3 pb-2 text-[11px] space-y-1 border-t border-brand-light/20 pt-2">
                {diff.element && <div className="text-slate-500">Element: <span className="text-slate-300 font-mono">{diff.element}</span></div>}
                {diff.original && <div className="text-slate-500">Original: <span className="text-red-400 font-mono">{diff.original}</span></div>}
                {diff.converted && <div className="text-slate-500">Converted: <span className="text-emerald-400 font-mono">{diff.converted}</span></div>}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function Recommendations({ items }: { items: string[] }) {
  if (items.length === 0) return null;
  return (
    <div className="space-y-1.5">
      <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Recommendations</h4>
      {items.map((rec, i) => (
        <div key={i} className="flex items-start gap-2 text-xs text-slate-300 bg-brand-dark rounded-lg px-3 py-2 border border-brand-light/20">
          <TrendingUp size={12} className="text-brand-accent mt-0.5 shrink-0" />
          <span>{rec}</span>
        </div>
      ))}
    </div>
  );
}

export default function OutputInterpreter({ html, css, format, convertedBlob, onClose, onApplyFix }: OutputInterpreterProps) {
  const [viewMode, setViewMode] = useState<ViewMode>("side-by-side");
  const [result, setResult] = useState<CompareResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [overlayOpacity, setOverlayOpacity] = useState(0.5);
  const [activeTab, setActiveTab] = useState<"scores" | "diffs" | "recommendations">("scores");

  const handleCompare = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const comparison = await compareOutput(html, css, format, convertedBlob);
      setResult(comparison);
    } catch (err: any) {
      setError(err?.message || "Comparison failed");
    } finally {
      setLoading(false);
    }
  }, [html, css, format, convertedBlob]);

  useEffect(() => {
    if (convertedBlob) handleCompare();
  }, [convertedBlob, handleCompare]);

  const handleDownloadDiff = useCallback(() => {
    if (!result?.diffImageUrl) return;
    const a = document.createElement("a");
    a.href = result.diffImageUrl;
    a.download = "accuracy-diff.png";
    a.click();
  }, [result]);

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-4 py-2 bg-brand-medium border-b border-brand-light/50">
        <div className="flex items-center gap-3">
          <BarChart3 size={16} className="text-brand-accent" />
          <span className="text-sm font-semibold text-white">Accuracy Interpreter</span>
          {result && (
            <span className={`text-xs px-2 py-0.5 rounded font-medium ${
              result.overallScore >= 90 ? "bg-emerald-500/20 text-emerald-400" :
              result.overallScore >= 70 ? "bg-amber-500/20 text-amber-400" :
              "bg-red-500/20 text-red-400"
            }`}>
              {Math.round(result.overallScore)}% match
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          {result && (
            <div className="flex items-center bg-brand-dark rounded-lg p-0.5 mr-2">
              {(["side-by-side", "overlay", "diff", "onion"] as ViewMode[]).map(mode => (
                <button
                  key={mode}
                  onClick={() => setViewMode(mode)}
                  className={`px-2 py-1 text-[10px] rounded font-medium transition-colors ${
                    viewMode === mode ? "bg-brand-light text-white" : "text-slate-400 hover:text-white"
                  }`}
                  title={mode.replace("-", " ")}
                >
                  {mode === "side-by-side" ? "Split" : mode === "overlay" ? "Overlay" : mode === "diff" ? "Diff" : "Onion"}
                </button>
              ))}
            </div>
          )}
          <button onClick={handleCompare} disabled={loading}
            className="p-1.5 rounded hover:bg-brand-light/50 text-slate-400 hover:text-white transition-colors disabled:opacity-50"
            title="Re-run comparison">
            <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
          </button>
          {result?.diffImageUrl && (
            <button onClick={handleDownloadDiff}
              className="p-1.5 rounded hover:bg-brand-light/50 text-slate-400 hover:text-white transition-colors"
              title="Download diff image">
              <Download size={14} />
            </button>
          )}
          <button onClick={onClose}
            className="p-1.5 rounded hover:bg-red-500/20 text-slate-400 hover:text-red-400 transition-colors"
            title="Close interpreter">
            <X size={14} />
          </button>
        </div>
      </div>

      {loading && !result && (
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center">
            <Loader2 size={32} className="text-brand-accent animate-spin mx-auto mb-3" />
            <p className="text-sm text-slate-400">Analyzing accuracy...</p>
            <p className="text-xs text-slate-500 mt-1">Rendering and comparing screenshots</p>
          </div>
        </div>
      )}

      {error && (
        <div className="flex-1 flex items-center justify-center p-8">
          <div className="text-center max-w-sm">
            <AlertTriangle size={32} className="text-amber-400 mx-auto mb-3" />
            <p className="text-sm text-slate-300 mb-2">{error}</p>
            <button onClick={handleCompare}
              className="px-4 py-2 text-xs rounded-lg bg-brand-light text-white hover:bg-brand-accent transition-colors">
              Try Again
            </button>
          </div>
        </div>
      )}

      {result && (
        <div className="flex-1 flex overflow-hidden">
          <div className="flex-1 flex flex-col">
            {viewMode === "side-by-side" && (
              <div className="flex-1 grid grid-cols-2 gap-px bg-brand-light/30">
                <div className="bg-brand-dark flex flex-col">
                  <div className="px-3 py-1.5 text-[10px] font-semibold text-slate-400 uppercase tracking-wider bg-brand-medium border-b border-brand-light/30">
                    Original HTML
                  </div>
                  <div className="flex-1 overflow-auto bg-white">
                    {result.originalImageUrl && (
                      <img src={result.originalImageUrl} alt="Original" className="w-full h-auto" />
                    )}
                  </div>
                </div>
                <div className="bg-brand-dark flex flex-col">
                  <div className="px-3 py-1.5 text-[10px] font-semibold text-slate-400 uppercase tracking-wider bg-brand-medium border-b border-brand-light/30">
                    Converted ({format.toUpperCase()})
                  </div>
                  <div className="flex-1 overflow-auto bg-white">
                    {result.convertedImageUrl && (
                      <img src={result.convertedImageUrl} alt="Converted" className="w-full h-auto" />
                    )}
                  </div>
                </div>
              </div>
            )}

            {viewMode === "overlay" && (
              <div className="flex-1 relative overflow-auto bg-white">
                {result.originalImageUrl && (
                  <img src={result.originalImageUrl} alt="Original" className="absolute inset-0 w-full h-auto" />
                )}
                {result.convertedImageUrl && (
                  <img
                    src={result.convertedImageUrl}
                    alt="Converted"
                    className="absolute inset-0 w-full h-auto"
                    style={{ opacity: overlayOpacity }}
                  />
                )}
                <div className="absolute bottom-4 left-1/2 -translate-x-1/2 bg-brand-dark/90 rounded-lg px-4 py-2 flex items-center gap-3 z-10 backdrop-blur-sm border border-brand-light/30">
                  <span className="text-[10px] text-slate-400">Original</span>
                  <input
                    type="range" min="0" max="1" step="0.01"
                    value={overlayOpacity}
                    onChange={e => setOverlayOpacity(parseFloat(e.target.value))}
                    className="w-32 accent-brand-accent"
                  />
                  <span className="text-[10px] text-slate-400">Converted</span>
                </div>
              </div>
            )}

            {viewMode === "diff" && (
              <div className="flex-1 overflow-auto bg-[#1a1a2e] flex items-center justify-center">
                {result.diffImageUrl && (
                  <img src={result.diffImageUrl} alt="Diff" className="max-w-full h-auto shadow-2xl" />
                )}
              </div>
            )}

            {viewMode === "onion" && (
              <div className="flex-1 relative overflow-auto bg-white">
                {result.originalImageUrl && (
                  <img src={result.originalImageUrl} alt="Original" className="w-full h-auto" />
                )}
                {result.diffImageUrl && (
                  <img
                    src={result.diffImageUrl}
                    alt="Diff overlay"
                    className="absolute inset-0 w-full h-auto mix-blend-multiply"
                    style={{ opacity: overlayOpacity }}
                  />
                )}
                <div className="absolute bottom-4 left-1/2 -translate-x-1/2 bg-brand-dark/90 rounded-lg px-4 py-2 flex items-center gap-3 z-10 backdrop-blur-sm border border-brand-light/30">
                  <span className="text-[10px] text-slate-400">Screenshot</span>
                  <input
                    type="range" min="0" max="1" step="0.01"
                    value={overlayOpacity}
                    onChange={e => setOverlayOpacity(parseFloat(e.target.value))}
                    className="w-32 accent-brand-accent"
                  />
                  <span className="text-[10px] text-slate-400">Diff</span>
                </div>
              </div>
            )}
          </div>

          <div className="w-80 bg-brand-dark border-l border-brand-light/30 flex flex-col">
            <div className="flex border-b border-brand-light/30">
              {(["scores", "diffs", "recommendations"] as const).map(tab => (
                <button
                  key={tab}
                  onClick={() => setActiveTab(tab)}
                  className={`flex-1 px-2 py-2 text-[10px] font-semibold uppercase tracking-wider transition-colors ${
                    activeTab === tab
                      ? "text-brand-accent border-b-2 border-brand-accent"
                      : "text-slate-500 hover:text-slate-300"
                  }`}
                >
                  {tab === "scores" ? "Scores" : tab === "diffs" ? `Diffs (${result.differences.length})` : "Advice"}
                </button>
              ))}
            </div>

            <div className="flex-1 overflow-auto p-3 space-y-4">
              {activeTab === "scores" && (
                <>
                  <div className="flex justify-around py-2">
                    <ScoreGauge score={result.visualScore} label="Visual" icon={Eye} />
                    <ScoreGauge score={result.structuralScore} label="Structure" icon={Layers} />
                    <ScoreGauge score={result.layoutScore} label="Layout" icon={Ruler} />
                  </div>
                  <div className="bg-brand-medium rounded-lg p-3 space-y-2">
                    <div className="flex justify-between text-xs">
                      <span className="text-slate-400">Overall Score</span>
                      <span className="text-white font-bold">{Math.round(result.overallScore)}%</span>
                    </div>
                    <div className="flex justify-between text-xs">
                      <span className="text-slate-400">Pixel Accuracy</span>
                      <span className="text-slate-300">{Math.round(result.pixelAccuracy)}%</span>
                    </div>
                    <div className="flex justify-between text-xs">
                      <span className="text-slate-400">Original Elements</span>
                      <span className="text-slate-300">{result.elementCount.original}</span>
                    </div>
                    <div className="flex justify-between text-xs">
                      <span className="text-slate-400">Converted Elements</span>
                      <span className="text-slate-300">{result.elementCount.converted}</span>
                    </div>
                  </div>
                  <div className="bg-brand-medium rounded-lg p-3">
                    <div className="text-xs text-slate-400 mb-2">Score Breakdown</div>
                    <div className="space-y-1.5">
                      {[
                        { label: "Visual Similarity", score: result.visualScore, weight: "40%" },
                        { label: "Structural Match", score: result.structuralScore, weight: "30%" },
                        { label: "Layout Accuracy", score: result.layoutScore, weight: "30%" },
                      ].map(item => (
                        <div key={item.label}>
                          <div className="flex justify-between text-[10px] mb-0.5">
                            <span className="text-slate-400">{item.label} ({item.weight})</span>
                            <span className="text-slate-300">{Math.round(item.score)}%</span>
                          </div>
                          <div className="h-1.5 bg-brand-dark rounded-full overflow-hidden">
                            <div
                              className={`h-full rounded-full transition-all duration-1000 ${
                                item.score >= 90 ? "bg-emerald-500" : item.score >= 70 ? "bg-amber-500" : "bg-red-500"
                              }`}
                              style={{ width: `${item.score}%` }}
                            />
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </>
              )}

              {activeTab === "diffs" && <DiffList differences={result.differences} />}
              {activeTab === "recommendations" && <Recommendations items={result.recommendations} />}
            </div>

            {result.recommendations.length > 0 && onApplyFix && (
              <div className="p-3 border-t border-brand-light/30">
                <button
                  onClick={() => onApplyFix(result.recommendations[0])}
                  className="w-full px-3 py-2 text-xs rounded-lg bg-brand-accent text-white hover:bg-brand-accent-hover transition-colors font-medium flex items-center justify-center gap-2"
                >
                  <ArrowRight size={12} />
                  Apply Top Recommendation
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {!result && !loading && !error && (
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center max-w-sm">
            <BarChart3 size={40} className="text-brand-light mx-auto mb-4" />
            <h3 className="text-sm font-semibold text-white mb-2">Output Accuracy Interpreter</h3>
            <p className="text-xs text-slate-400 mb-4">
              Compare your converted output against the original HTML to measure accuracy and get improvement suggestions.
            </p>
            <button onClick={handleCompare}
              className="px-4 py-2 text-xs rounded-lg bg-brand-accent text-white hover:bg-brand-accent-hover transition-colors font-medium">
              Start Comparison
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
