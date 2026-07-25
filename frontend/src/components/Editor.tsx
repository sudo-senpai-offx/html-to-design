import Editor from '@monaco-editor/react';
import { Code2, Palette } from 'lucide-react';

interface Props {
  html: string;
  css: string;
  onHtmlChange: (val: string) => void;
  onCssChange: (val: string) => void;
  activeTab: 'html' | 'css';
  onTabChange: (tab: 'html' | 'css') => void;
}

export default function CodeEditor({ html, css, onHtmlChange, onCssChange, activeTab, onTabChange }: Props) {
  const value = activeTab === 'html' ? html : css;
  const language = activeTab === 'html' ? 'html' : 'css';

  const handleChange = (val: string | undefined) => {
    if (val === undefined) return;
    if (activeTab === 'html') onHtmlChange(val);
    else onCssChange(val);
  };

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center border-b border-brand-light">
        <button
          onClick={() => onTabChange('html')}
          className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium transition-all ${
            activeTab === 'html'
              ? 'text-brand-accent border-b-2 border-brand-accent bg-brand-medium/50'
              : 'text-slate-400 hover:text-white hover:bg-brand-medium/30'
          }`}
        >
          <Code2 className="w-3.5 h-3.5" />
          HTML
          {html && <span className="text-[10px] text-slate-600">{html.length}</span>}
        </button>
        <button
          onClick={() => onTabChange('css')}
          className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium transition-all ${
            activeTab === 'css'
              ? 'text-brand-accent border-b-2 border-brand-accent bg-brand-medium/50'
              : 'text-slate-400 hover:text-white hover:bg-brand-medium/30'
          }`}
        >
          <Palette className="w-3.5 h-3.5" />
          CSS
          {css && <span className="text-[10px] text-slate-600">{css.length}</span>}
        </button>
      </div>
      <div className="flex-1 min-h-0">
        <Editor
          height="100%"
          language={language}
          value={value}
          onChange={handleChange}
          theme="vs-dark"
          options={{
            minimap: { enabled: false },
            fontSize: 13,
            fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
            fontLigatures: true,
            lineNumbers: 'on',
            scrollBeyondLastLine: false,
            wordWrap: 'on',
            padding: { top: 12, bottom: 12 },
            bracketPairColorization: { enabled: true },
            automaticLayout: true,
            tabSize: 2,
            renderWhitespace: 'selection',
            smoothScrolling: true,
            cursorBlinking: 'smooth',
            cursorSmoothCaretAnimation: 'on',
            folding: true,
            glyphMargin: false,
            lineDecorationsWidth: 0,
            lineNumbersMinChars: 3,
          }}
        />
      </div>
    </div>
  );
}
