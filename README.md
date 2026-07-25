# HTML to Design

> Convert HTML+CSS to PNG, PDF, SVG, Figma (.fig), and PSD — with a live editor, auto-layout detection, and design token extraction.

![Node](https://img.shields.io/badge/Node.js-18+-green)
![React](https://img.shields.io/badge/React-18-blue)
![License](https://img.shields.io/badge/License-MIT-yellow)

## Features

- **Live Preview** — Edit HTML/CSS with Monaco Editor, see changes in real-time
- **Multi-Format Export** — PNG, PDF, SVG, Figma (.fig), PSD
- **Figma Native Layers** — Not screenshots — real Figma frames, text, and shapes
- **Auto-Layout Detection** — Flexbox/Grid mapped to Figma auto-layout
- **Design Token Extraction** — Colors, spacing, and border-radius extracted as Figma Variables
- **URL Import** — Paste a URL to import live HTML content
- **Responsive Viewport** — Desktop, Laptop, Tablet, Mobile presets
- **Keyboard Shortcuts** — `Ctrl+Enter` for PNG, `Ctrl+Shift+F` for Figma
- **Resizable Panels** — Drag to resize editor and preview
- **Docker Ready** — Production deployment with Nginx + Express

## Architecture

```
html-to-design/
├── backend/                  Node.js + Express API
│   ├── converters/           Format-specific converters
│   │   ├── figma.js          .fig generation with openfig-core
│   │   ├── png.js            Puppeteer screenshots
│   │   ├── pdf.js            Puppeteer print-to-PDF
│   │   ├── svg.js            SVG with embedded PNG
│   │   └── psd.js            Minimal PSD writer
│   ├── lib/
│   │   ├── browser-pool.js   Puppeteer browser pooling
│   │   ├── dom-extractor.js  DOM tree extraction
│   │   ├── figma-builder.js  Figma node construction
│   │   ├── fig-writer.js     .fig file serialization
│   │   ├── asset-manager.js  Image download & caching
│   │   ├── layout.js         Auto-layout detection
│   │   ├── style-extractor.js CSS property extraction
│   │   └── utils.js          Color parsing, hashing, helpers
│   └── index.js              Express server with rate limiting
├── frontend/                 React + Vite + Monaco Editor + Tailwind
│   └── src/
│       ├── components/
│       │   ├── Editor.tsx     Monaco code editor
│       │   ├── Preview.tsx    Sandboxed live preview
│       │   ├── ExportPanel.tsx Format selection
│       │   ├── Settings.tsx   Viewport controls
│       │   ├── UrlImport.tsx  URL import input
│       │   └── ErrorBoundary.tsx
│       ├── api/client.ts      API client with Axios
│       ├── hooks/useDebounce.ts
│       └── App.tsx            Main application
├── Dockerfile                Production container
├── docker-compose.yml        Full stack deployment
└── nginx.conf                Reverse proxy config
```

## Quick Start

### Prerequisites

- Node.js 18+
- Chrome/Chromium (for Puppeteer)

### Backend

```bash
cd backend
npm install
npx puppeteer browsers install chrome
npm start
# Runs on http://localhost:3000
```

### Frontend

```bash
cd frontend
npm install
npm run dev
# Runs on http://localhost:5173 (proxies /api to backend)
```

### Docker

```bash
docker-compose up --build
# Frontend: http://localhost:80
# Backend: http://localhost:3000
```

## API

### Health Check
```
GET /api/health
```

### Convert
```
POST /api/convert/:format
Content-Type: application/json

{
  "html": "<div>...</div>",
  "css": "body { ... }",
  "width": 1440,
  "height": 900,
  "scale": 2
}
```

### Import from URL
```
POST /api/import/url
Content-Type: application/json

{
  "url": "https://example.com"
}
```

### Supported Formats

| Format | Status | Notes |
|--------|--------|-------|
| PNG    | Working | Full-page Puppeteer screenshot |
| PDF    | Working | Print-to-PDF with background support |
| SVG    | Working | Vector wrapper with embedded PNG |
| Figma  | Working | .fig with auto-layout, design tokens, images |
| PSD    | Working | Photoshop document with raster content |

## Figma Conversion Features

- DOM tree extraction via Puppeteer
- CSS property extraction (fills, strokes, shadows, borders, gradients)
- Auto-layout detection (flexbox/grid -> Figma stack layout)
- SVG rasterization (inline SVGs rendered to bitmaps)
- Image downloading and embedding
- Design token extraction (colors, spacing, border-radius)
- Container flattening (removes empty wrapper frames)
- Text styling (font family, size, weight, alignment, transform)
- Pseudo-element support (::before, ::after)
- Gradient fills (linear, radial)
- Border-radius (per-corner support)

## Security

- HTML sanitization (strips `<script>` tags)
- Rate limiting (10 conversions/min, 5 URL imports/min)
- CSP headers on preview iframe
- Input validation and bounds checking
- CORS restricted to allowed origins
- Puppeteer browser pooling with automatic recycling

## Tech Stack

- **Backend**: Node.js, Express, Puppeteer, openfig-core, zstd-codec
- **Frontend**: React 18, Vite, Monaco Editor, Tailwind CSS, TypeScript, Sonner (toasts), Lucide (icons), react-resizable-panels

## License

MIT
