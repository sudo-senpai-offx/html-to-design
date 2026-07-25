import { useState } from 'react';
import { Globe, Loader2, AlertCircle } from 'lucide-react';
import { importFromUrl } from '../api/client';

interface Props {
  onImport: (html: string, css: string) => void;
}

export default function UrlImport({ onImport }: Props) {
  const [url, setUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleImport = async () => {
    if (!url.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const result = await importFromUrl(url.trim());
      onImport(result.html, result.css);
      setUrl('');
    } catch (err: any) {
      setError(err?.response?.data?.error || err.message || 'Failed to import URL');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-sm font-semibold text-slate-300 flex items-center gap-2">
        <Globe className="w-4 h-4" />
        Import from URL
      </h3>
      <div className="flex gap-2">
        <input
          type="url"
          value={url}
          onChange={(e) => { setUrl(e.target.value); setError(null); }}
          onKeyDown={(e) => e.key === 'Enter' && handleImport()}
          placeholder="https://example.com"
          className="flex-1 bg-brand-light border border-brand-light rounded px-3 py-1.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-brand-accent"
          disabled={loading}
        />
        <button
          onClick={handleImport}
          disabled={loading || !url.trim()}
          className="px-3 py-1.5 bg-brand-accent text-white rounded text-sm font-medium hover:bg-brand-accent-hover transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1"
        >
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Globe className="w-4 h-4" />}
          Import
        </button>
      </div>
      {error && (
        <p className="text-xs text-red-400 flex items-center gap-1">
          <AlertCircle className="w-3 h-3" />
          {error}
        </p>
      )}
    </div>
  );
}
