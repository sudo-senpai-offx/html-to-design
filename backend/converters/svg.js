const { getPool } = require("../lib/browser-pool");

function escapeXml(str) {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

function cssToSvgStyle(props) {
  const parts = [];
  if (props["background-color"] && props["background-color"] !== "transparent") {
    parts.push(`fill:${props["background-color"]}`);
  }
  if (props["color"]) parts.push(`fill:${props["color"]}`);
  if (props["font-family"]) parts.push(`font-family:${props["font-family"]}`);
  if (props["font-size"]) parts.push(`font-size:${props["font-size"]}`);
  if (props["font-weight"]) parts.push(`font-weight:${props["font-weight"]}`);
  if (props["text-align"]) parts.push(`text-anchor:${props["text-align"] === "center" ? "middle" : props["text-align"] === "right" ? "end" : "start"}`);
  if (props["letter-spacing"]) parts.push(`letter-spacing:${props["letter-spacing"]}`);
  if (props["text-decoration"]) parts.push(`text-decoration:${props["text-decoration"]}`);
  if (props["opacity"] && props["opacity"] !== "1") parts.push(`opacity:${props["opacity"]}`);
  return parts.join(";");
}

function extractTextNodes(el, offsetX, offsetY, svgParts) {
  if (!el) return;
  const props = el.props || {};
  const x = (el.x || 0) + offsetX;
  const y = (el.y || 0) + offsetY;
  const w = el.w || 0;
  const h = el.h || 0;

  if (w < 1 || h < 1) return;

  const display = props["display"] || "block";
  const visibility = props["visibility"] || "visible";
  if (display === "none" || visibility === "hidden") return;

  const hasText = el.text && el.text.length > 0;
  const bgColor = props["background-color"];
  const borderRadius = parseFloat(props["border-radius"]) || 0;
  const borderWidth = parseFloat(props["border-top-width"]) || 0;
  const borderColor = props["border-top-color"] || "#000000";

  if (bgColor && bgColor !== "transparent") {
    if (borderRadius > 0) {
      svgParts.push(`<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${borderRadius}" fill="${escapeXml(bgColor)}"/>`);
    } else {
      svgParts.push(`<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${escapeXml(bgColor)}"/>`);
    }
  }

  if (borderWidth > 0 && (!bgColor || bgColor === "transparent")) {
    svgParts.push(`<rect x="${x + borderWidth/2}" y="${y + borderWidth/2}" width="${w - borderWidth}" height="${h - borderWidth}" rx="${borderRadius}" fill="none" stroke="${escapeXml(borderColor)}" stroke-width="${borderWidth}"/>`);
  }

  if (hasText) {
    const fontSize = parseFloat(props["font-size"]) || 16;
    const fontFamily = props["font-family"] || "Inter, sans-serif";
    const fontWeight = props["font-weight"] || "400";
    const color = props["color"] || "#1e293b";
    const textAlign = props["text-align"] || "left";
    const lineHeight = parseFloat(props["line-height"]) || fontSize * 1.6;

    let textX = x;
    let anchor = "start";
    if (textAlign === "center") { textX = x + w / 2; anchor = "middle"; }
    else if (textAlign === "right") { textX = x + w; anchor = "end"; }

    const textY = y + fontSize;

    const style = cssToSvgStyle(props);
    svgParts.push(`<text x="${textX}" y="${textY}" font-family="${escapeXml(fontFamily)}" font-size="${fontSize}" font-weight="${fontWeight}" fill="${escapeXml(color)}" text-anchor="${anchor}"${style ? ` style="${escapeXml(style)}"` : ""}>${escapeXml(el.text)}</text>`);
  }

  if (el.tag === "img" && el.src) {
    svgParts.push(`<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="#e5e7eb" rx="4"/>`);
    svgParts.push(`<text x="${x + w/2}" y="${y + h/2}" font-family="Inter, sans-serif" font-size="12" fill="#9ca3af" text-anchor="middle" dominant-baseline="middle">[Image]</text>`);
  }

  if (el.children) {
    for (const child of el.children) {
      extractTextNodes(child, offsetX, offsetY, svgParts);
    }
  }
}

async function convertToSvg(html, options) {
  var { width = 1440, height = 900, scale = 2 } = options;
  var pool = getPool();

  return pool.execute(async (page) => {
    await page.setViewport({ width, height, deviceScaleFactor: scale });
    await page.setContent(html, { waitUntil: "networkidle2", timeout: 30000 });
    await page.evaluate(() => document.fonts && document.fonts.ready);
    await new Promise((r) => setTimeout(r, 500));

    await page.evaluate(() => {
      return new Promise((resolve) => {
        const images = document.querySelectorAll("img");
        let loaded = 0;
        const total = images.length;
        if (total === 0) return resolve();
        images.forEach((img) => {
          if (img.complete) { loaded++; if (loaded === total) resolve(); }
          else {
            img.onload = () => { loaded++; if (loaded === total) resolve(); };
            img.onerror = () => { loaded++; if (loaded === total) resolve(); };
          }
        });
        setTimeout(resolve, 3000);
      });
    });

    const pngBuffer = await page.screenshot({ type: "png", fullPage: true });

    const dimensions = await page.evaluate(() => ({
      width: document.documentElement.scrollWidth,
      height: document.documentElement.scrollHeight,
    }));

    const domData = await page.evaluate(() => {
      function getProps(el) {
        const cs = window.getComputedStyle(el);
        const props = {};
        const important = [
          "display","visibility","opacity","position",
          "background-color","border-radius","border-top-width","border-top-color",
          "color","font-family","font-size","font-weight","font-style",
          "line-height","letter-spacing","text-align","text-decoration",
          "text-transform","white-space","text-overflow",
          "padding-top","padding-right","padding-bottom","padding-left",
          "width","height",
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
        if (["script","style","noscript","link","meta","br"].includes(tag)) return null;

        const display = window.getComputedStyle(el).display;
        if (display === "none") return null;

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
          props: getProps(el), children,
          src: tag === "img" ? (el.currentSrc || el.src || "") : "",
          alt: el.alt || "",
        };
      }

      return walk(document.body, 0);
    });

    const vectorParts = [];
    vectorParts.push(`<rect width="100%" height="100%" fill="#ffffff"/>`);

    if (domData) {
      extractTextNodes(domData, 0, 0, vectorParts);
    }

    const svgContent = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"
     width="${dimensions.width}" height="${dimensions.height}"
     viewBox="0 0 ${dimensions.width} ${dimensions.height}">
  <title>HTML Export</title>
  <desc>Generated by HTML to Design converter</desc>
  <defs>
    <clipPath id="rasterClip">
      <rect width="${dimensions.width}" height="${dimensions.height}"/>
    </clipPath>
  </defs>
  <g clip-path="url(#rasterClip)" opacity="1">
    <image width="${dimensions.width}" height="${dimensions.height}"
           xlink:href="data:image/png;base64,${pngBuffer.toString("base64")}" />
  </g>
  <g class="vector-elements">
    ${vectorParts.join("\n    ")}
  </g>
</svg>`;

    return Buffer.from(svgContent, "utf-8");
  }, { timeout: 60000, retries: 3 });
}

module.exports = { convertToSvg };
