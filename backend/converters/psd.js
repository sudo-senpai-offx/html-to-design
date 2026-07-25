require("ag-psd/initialize-canvas");
const { writePsdBuffer } = require("ag-psd");
const { createCanvas } = require("canvas");
const { getPool } = require("../lib/browser-pool");

function cssToAgPsdColor(cssColor) {
  if (!cssColor) return { r: 0, g: 0, b: 0 };
  const m = cssColor.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
  if (m) {
    return { r: parseInt(m[1]), g: parseInt(m[2]), b: parseInt(m[3]) };
  }
  if (cssColor.startsWith("#")) {
    let hex = cssColor.replace("#", "");
    if (hex.length === 3) hex = hex[0]+hex[0]+hex[1]+hex[1]+hex[2]+hex[2];
    if (hex.length >= 6) {
      return {
        r: parseInt(hex.substring(0, 2), 16),
        g: parseInt(hex.substring(2, 4), 16),
        b: parseInt(hex.substring(4, 6), 16),
      };
    }
  }
  return { r: 0, g: 0, b: 0 };
}

function fontWeightToStyle(weight) {
  const n = parseInt(weight) || 400;
  if (n >= 700) return true;
  return false;
}

function mapFontName(cssFont) {
  if (!cssFont) return { name: "ArialMT" };
  const f = cssFont.toLowerCase();
  if (f.includes("bold") && f.includes("italic")) return { name: "Arial-BoldItalicMT" };
  if (f.includes("bold")) return { name: "Arial-BoldMT" };
  if (f.includes("italic")) return { name: "Arial-ItalicMT" };
  if (f.includes("mono") || f.includes("courier")) return { name: "CourierNewPSMT" };
  if (f.includes("georgia") || f.includes("serif")) return { name: "Georgia" };
  return { name: "ArialMT" };
}

function extractLayersFromDom(el, offsetX, offsetY, layers) {
  if (!el) return;
  const props = el.props || {};
  const x = (el.x || 0) + offsetX;
  const y = (el.y || 0) + offsetY;
  const w = el.w || 0;
  const h = el.h || 0;

  if (w < 1 || h < 1) return;

  const display = props["display"] || "block";
  const visibility = props["visibility"] || "visible";
  const opacity = parseFloat(props["opacity"]);
  if (display === "none" || visibility === "hidden") return;
  if (!isNaN(opacity) && opacity < 0.01) return;

  const bgColor = props["background-color"];
  const hasText = el.text && el.text.length > 0;
  const tag = el.tag || "";
  const isImage = tag === "img";

  if (bgColor && bgColor !== "transparent") {
    const layer = {
      name: el.cls ? el.cls.split(" ")[0] : tag,
      canvas: (() => {
        const c = createCanvas(Math.max(w, 1), Math.max(h, 1));
        const ctx = c.getContext("2d");
        const parsed = cssToAgPsdColor(bgColor);
        ctx.fillStyle = `rgb(${parsed.r},${parsed.g},${parsed.b})`;
        const alphaMatch = bgColor.match(/rgba\([^,]+,\s*([\d.]+)\)/);
        if (alphaMatch) ctx.globalAlpha = parseFloat(alphaMatch[1]);
        ctx.fillRect(0, 0, w, h);

        const radius = parseFloat(props["border-radius"]) || 0;
        if (radius > 0) {
          ctx.globalCompositeOperation = "destination-in";
          ctx.beginPath();
          ctx.roundRect(0, 0, w, h, radius);
          ctx.fill();
        }
        return c;
      })(),
      left: Math.round(x),
      top: Math.round(y),
    };

    const boxShadow = props["box-shadow"];
    if (boxShadow && boxShadow !== "none") {
      const sm = boxShadow.match(/(-?[\d.]+)px\s+(-?[\d.]+)px\s+(-?[\d.]+)px\s*(rgba?\([^)]+\))?/);
      if (sm) {
        layer.effects = [{
          type: "dropShadow",
          enabled: true,
          color: cssToAgPsdColor(sm[4] || "rgba(0,0,0,0.25)"),
          opacity: 128,
          angle: Math.atan2(parseFloat(sm[2]), parseFloat(sm[1])) * 180 / Math.PI,
          distance: Math.sqrt(parseFloat(sm[1])**2 + parseFloat(sm[2])**2),
          size: parseFloat(sm[3]),
          spread: 0,
        }];
      }
    }

    layers.push(layer);
  }

  if (hasText && !isImage && !bgColor) {
    const fontSize = parseFloat(props["font-size"]) || 16;
    const lineHeight = parseFloat(props["line-height"]) || fontSize * 1.6;
    const fontFamily = props["font-family"] || "Arial, sans-serif";
    const fontWeight = props["font-weight"] || "400";
    const color = props["color"] || "#000000";
    const textAlign = props["text-align"] || "left";

    let justification = "left";
    if (textAlign === "center") justification = "center";
    else if (textAlign === "right") justification = "right";

    layers.push({
      name: el.text.substring(0, 40),
      text: {
        text: el.text,
        transform: [1, 0, 0, 1, Math.round(x), Math.round(y)],
        style: {
          font: mapFontName(fontFamily),
          fontSize: fontSize,
          fillColor: cssToAgPsdColor(color),
          bold: fontWeightToStyle(fontWeight),
        },
        paragraphStyle: {
          justification: justification,
        },
      },
      left: Math.round(x),
      top: Math.round(y),
    });
  }

  if (isImage && el.src) {
    layers.push({
      name: el.alt || "Image",
      canvas: (() => {
        const c = createCanvas(Math.max(w, 1), Math.max(h, 1));
        const ctx = c.getContext("2d");
        ctx.fillStyle = "#e5e7eb";
        ctx.fillRect(0, 0, w, h);
        ctx.fillStyle = "#9ca3af";
        ctx.font = `${Math.min(14, w/8)}px Arial`;
        ctx.textAlign = "center";
        ctx.fillText("[Image]", w/2, h/2);
        return c;
      })(),
      left: Math.round(x),
      top: Math.round(y),
    });
  }

  const borderRadius = parseFloat(props["border-radius"]) || 0;
  const borderWidth = parseFloat(props["border-top-width"]) || 0;
  if (borderWidth > 0 && !bgColor) {
    const borderColor = props["border-top-color"] || "#000000";
    layers.push({
      name: `Border ${tag}`,
      canvas: (() => {
        const c = createCanvas(Math.max(w, 1), Math.max(h, 1));
        const ctx = c.getContext("2d");
        ctx.strokeStyle = borderColor;
        ctx.lineWidth = borderWidth;
        if (borderRadius > 0) {
          ctx.beginPath();
          ctx.roundRect(borderWidth/2, borderWidth/2, w - borderWidth, h - borderWidth, borderRadius);
          ctx.stroke();
        } else {
          ctx.strokeRect(borderWidth/2, borderWidth/2, w - borderWidth, h - borderWidth);
        }
        return c;
      })(),
      left: Math.round(x),
      top: Math.round(y),
    });
  }

  if (el.children) {
    for (const child of el.children) {
      extractLayersFromDom(child, offsetX, offsetY, layers);
    }
  }
}

async function convertToPsd(html, options) {
  const { width = 1440, height = 900, scale = 2 } = options;
  const pool = getPool();

  const pngBuffer = await pool.execute(async (page) => {
    await page.setViewport({ width, height, deviceScaleFactor: scale });
    await page.setContent(html, { waitUntil: "networkidle2", timeout: 30000 });
    await page.evaluate(() => document.fonts && document.fonts.ready);
    await new Promise((r) => setTimeout(r, 500));
    return page.screenshot({ type: "png", fullPage: false, clip: { x: 0, y: 0, width, height } });
  }, { timeout: 60000, retries: 3 });

  const screenshotCanvas = createCanvas(width * scale, height * scale);
  const screenshotCtx = screenshotCanvas.getContext("2d");
  const img = new (require("canvas").Image)();
  img.src = pngBuffer;
  screenshotCtx.drawImage(img, 0, 0, width * scale, height * scale);

  const layers = [{
    name: "Screenshot (Raster)",
    canvas: screenshotCanvas,
    left: 0,
    top: 0,
  }];

  try {
    const domResult = await pool.execute(async (page) => {
      await page.setViewport({ width, height, deviceScaleFactor: 1 });
      await page.setContent(html, { waitUntil: "networkidle2", timeout: 30000 });
      await page.evaluate(() => document.fonts && document.fonts.ready);
      await new Promise((r) => setTimeout(r, 500));

      return await page.evaluate((s) => {
        function getCS(el, pseudo) {
          const cs = window.getComputedStyle(el, pseudo || null);
          const props = {};
          const important = [
            "display","visibility","opacity","position",
            "background-color","background","border-radius",
            "border-top-width","border-top-color","border-right-width","border-right-color",
            "border-bottom-width","border-bottom-color","border-left-width","border-left-color",
            "border-top-style","border-right-style","border-bottom-style","border-left-style",
            "color","font-family","font-size","font-weight","font-style",
            "line-height","letter-spacing","text-align","text-decoration",
            "text-transform","white-space","box-shadow","padding-top","padding-right",
            "padding-bottom","padding-left","width","height","top","left",
          ];
          for (const p of important) {
            const v = cs.getPropertyValue(p);
            if (v) props[p] = v;
          }
          return props;
        }

        function walk(el, depth) {
          if (!el || depth > 50 || el.nodeType !== 1) return null;
          const rect = el.getBoundingClientRect();
          if (rect.width < 1 || rect.height < 1) return null;
          const tag = el.tagName.toLowerCase();
          if (["script","style","noscript","link","meta"].includes(tag)) return null;

          const props = getCS(el);
          let text = "";
          for (const n of el.childNodes) {
            if (n.nodeType === 3 && n.textContent.trim()) {
              text += (text ? " " : "") + n.textContent.trim();
            }
          }

          const children = [];
          for (const c of el.children) {
            const child = walk(c, depth + 1);
            if (child) children.push(child);
          }

          return {
            tag, cls: el.className || "", text,
            x: Math.round(rect.x), y: Math.round(rect.y),
            w: Math.round(rect.width), h: Math.round(rect.height),
            props, children,
            src: tag === "img" ? (el.currentSrc || el.src || "") : "",
            alt: el.alt || "",
          };
        }

        return walk(document.body, 0);
      });
    }, { timeout: 30000, retries: 2 });

    if (domResult) {
      const domLayers = [];
      extractLayersFromDom(domResult, 0, 0, domLayers);
      if (domLayers.length > 0) {
        layers.unshift({
          name: "Elements",
          children: domLayers,
        });
      }
    }
  } catch (err) {
    console.log("  PSD: DOM extraction failed, using screenshot only:", err.message);
  }

  const psd = {
    width: width * scale,
    height: height * scale,
    children: layers,
  };

  const buffer = writePsdBuffer(psd, {
    invalidateTextLayers: true,
    generateThumbnail: true,
  });

  return buffer;
}

module.exports = { convertToPsd };
