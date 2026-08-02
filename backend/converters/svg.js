const { getPool } = require("../lib/browser-pool");
const { resolveFormatOptions } = require("../lib/config");

function escapeXml(str) {
  if (typeof str !== "string") return "";
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

var SVG_EXTRACT_SCRIPT = `
(function() {
  var MAX_ELEMENTS = __MAX_ELEMENTS__;
  var MAX_DEPTH = __MAX_DEPTH__;
  var elementCount = 0;
  var flatResult = [];

  function getProps(el) {
    var cs = window.getComputedStyle(el);
    var props = {};
    var list = [
      "display","visibility","opacity","position","z-index","overflow",
      "background-color","background-image","background-size","background-position","background-repeat",
      "border-top-width","border-right-width","border-bottom-width","border-left-width",
      "border-top-color","border-right-color","border-bottom-color","border-left-color",
      "border-top-style","border-right-style","border-bottom-style","border-left-style",
      "border-top-left-radius","border-top-right-radius","border-bottom-right-radius","border-bottom-left-radius",
      "color","font-family","font-size","font-weight","font-style",
      "line-height","letter-spacing","text-align","text-decoration","text-transform",
      "white-space","text-overflow",
      "padding-top","padding-right","padding-bottom","padding-left",
      "box-shadow","text-shadow",
      "object-fit",
      "clip-path",
      "mix-blend-mode",
    ];
    for (var i = 0; i < list.length; i++) {
      var v = cs.getPropertyValue(list[i]);
      if (v && v !== "none") props[list[i]] = v;
    }
    return props;
  }

  function svgToDataUri(el) {
    try {
      var clone = el.cloneNode(true);
      clone.removeAttribute("class");
      clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
      clone.setAttribute("xmlns:xlink", "http://www.w3.org/1999/xlink");
      var rect = el.getBoundingClientRect();
      clone.setAttribute("width", Math.max(1, Math.round(rect.width)));
      clone.setAttribute("height", Math.max(1, Math.round(rect.height)));
      var xml = new XMLSerializer().serializeToString(clone);
      return "data:image/svg+xml;base64," + btoa(unescape(encodeURIComponent(xml)));
    } catch (e) {
      return "";
    }
  }

  function normalizeSrc(src) {
    if (!src || typeof src !== "string") return "";
    if (src.startsWith("data:") && !src.includes(";base64,")) {
      var header = src.slice(0, src.indexOf(","));
      var comma = src.indexOf(",");
      if (comma > 0) {
        try {
          var mime = (header.match(/^data:([^;]+)/) || [])[1] || "image/png";
          var raw = decodeURIComponent(src.slice(comma + 1));
          return "data:" + mime + ";base64," + btoa(raw);
        } catch (e) {
          return src;
        }
      }
    }
    return src;
  }

  function walk(el, depth) {
    try {
      if (!el || depth > MAX_DEPTH || el.nodeType !== 1) return;
      if (elementCount >= MAX_ELEMENTS) return;
      var tag = el.tagName.toLowerCase();
      if (tag === "script" || tag === "style" || tag === "noscript" || tag === "br") return;

      var rect = el.getBoundingClientRect();
      if (rect.width < 1 || rect.height < 1) return;
      var cs = window.getComputedStyle(el);
      if (cs.display === "none" || cs.visibility === "hidden") return;
      var op = parseFloat(cs.opacity);
      if (!isNaN(op) && op < 0.01) return;

      var text = "";
      for (var i = 0; i < el.childNodes.length; i++) {
        var n = el.childNodes[i];
        if (n.nodeType === 3 && n.textContent.trim()) {
          text += (text ? " " : "") + n.textContent.trim();
        }
      }

      var props = getProps(el);
      var src = "";

      if (tag === "img") {
        src = normalizeSrc(el.currentSrc || el.src || "");
      } else if (tag === "svg" || (el.namespaceURI && el.namespaceURI.indexOf("svg") >= 0 && el.children.length > 0)) {
        src = svgToDataUri(el);
      }

      var children = [];
      if (tag === "svg") {
        /* Inline SVG captured as a raster image — do not descend into primitives */
        children = [];
      } else {
        for (var j = 0; j < el.children.length; j++) {
          walk(el.children[j], depth + 1);
        }
      }

      elementCount++;
      flatResult.push({
        tag: tag,
        x: Math.round(rect.x), y: Math.round(rect.y),
        w: Math.round(rect.width), h: Math.round(rect.height),
        props: props, text: text, src: src,
        zIndex: parseInt(cs.zIndex) || 0,
        childCount: el.children.length,
        _zIndex: parseInt(cs.zIndex) || 0,
        _depth: depth,
      });
    } catch(e) {}
  }

  walk(document.body, 0);
  return {
    elements: flatResult,
    pageWidth: Math.max(document.documentElement.scrollWidth, window.innerWidth),
    pageHeight: Math.max(document.documentElement.scrollHeight, window.innerHeight),
  };
})()
`;

function parseColor(cssColor) {
  if (!cssColor || cssColor === "transparent" || cssColor === "none") return null;
  var r, g, b, a = 1;

  if (cssColor.startsWith("#")) {
    var hex = cssColor.replace("#", "");
    if (hex.length === 3) hex = hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2];
    r = parseInt(hex.substring(0, 2), 16);
    g = parseInt(hex.substring(2, 4), 16);
    b = parseInt(hex.substring(4, 6), 16);
  } else if (cssColor.startsWith("rgb(")) {
    var m = cssColor.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
    if (m) { r = parseInt(m[1]); g = parseInt(m[2]); b = parseInt(m[3]); }
  } else if (cssColor.startsWith("rgba(")) {
    var m = cssColor.match(/rgba\((\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\)/);
    if (m) { r = parseInt(m[1]); g = parseInt(m[2]); b = parseInt(m[3]); a = parseFloat(m[4]); }
  } else {
    try {
      var el = document.createElement("div");
      el.style.color = cssColor;
      document.body.appendChild(el);
      var cs = window.getComputedStyle(el);
      var rgb = cs.color.match(/(\d+)/g);
      document.body.removeChild(el);
      if (rgb) { r = parseInt(rgb[0]); g = parseInt(rgb[1]); b = parseInt(rgb[2]); }
    } catch (e) {
      return null;
    }
  }

  if (r === undefined || isNaN(r)) return null;
  return "rgba(" + r + "," + g + "," + b + "," + a + ")";
}

function parseShadow(cssVal) {
  if (!cssVal || cssVal === "none") return null;
  var shadows = [];
  var parts = cssVal.split(/,(?![^()]*\))/);
  for (var i = 0; i < parts.length; i++) {
    var s = parts[i].trim();
    if (!s) continue;
    var m = s.match(/([\d.]+)px\s+([\d.]+)px\s+([\d.]+)px\s+([\d.]+)px\s+(.+)/);
    if (!m) m = s.match(/([\d.]+)px\s+([\d.]+)px\s+([\d.]+)px\s+(.+)/);
    if (!m) m = s.match(/([\d.]+)px\s+([\d.]+)px\s+(.+)/);
    if (m) {
      var dx = parseFloat(m[1]) || 0;
      var dy = parseFloat(m[2]) || 0;
      var blur = m[3] ? parseFloat(m[3]) || 0 : 0;
      var spread = m[4] ? parseFloat(m[4]) || 0 : 0;
      var color = m[4] ? m[5] : m[3] ? m[4] : null;
      if (color && color !== "none") {
        shadows.push({ dx: dx, dy: dy, blur: blur, spread: spread, color: parseColor(color) || "rgba(0,0,0,0.3)" });
      }
    }
  }
  return shadows.length > 0 ? shadows : null;
}

function generateSvgRect(x, y, w, h, radius) {
  if (!radius) return "M" + x + "," + y + " L" + (x + w) + "," + y + " L" + (x + w) + "," + (y + h) + " L" + x + "," + (y + h) + " Z";
  var r = Math.min(radius, w / 2, h / 2);
  return "M" + (x + r) + "," + y + " L" + (x + w - r) + "," + y + " A" + r + "," + r + " 0 0 1 " + (x + w) + "," + (y + r) + " L" + (x + w) + "," + (y + h - r) + " A" + r + "," + r + " 0 0 1 " + (x + w - r) + "," + (y + h) + " L" + (x + r) + "," + (y + h) + " A" + r + "," + r + " 0 0 1 " + x + "," + (y + h - r) + " L" + x + "," + (y + r) + " A" + r + "," + r + " 0 0 1 " + (x + r) + "," + y + " Z";
}

function buildSvg(pw, ph, elements) {
  var defs = [];
  var body = [];
  var clipId = 0;

  body.push('<rect width="100%" height="100%" fill="#ffffff" />');

  elements.sort(function(a, b) {
    var za = a._zIndex || 0;
    var zb = b._zIndex || 0;
    if (za !== zb) return za - zb;
    if (a._depth !== undefined && b._depth !== undefined) return a._depth - b._depth;
    return 0;
  });

  for (var i = 0; i < elements.length; i++) {
    var el = elements[i];
    var p = el.props;
    var x = el.x, y = el.y, w = el.w, h = el.h;
    if (w <= 0 || h <= 0) continue;

    var bgColor = p["background-color"] || null;
    var bgImage = p["background-image"] || null;
    var borderTW = parseFloat(p["border-top-width"]) || 0;
    var borderRW = parseFloat(p["border-right-width"]) || 0;
    var borderBW = parseFloat(p["border-bottom-width"]) || 0;
    var borderLW = parseFloat(p["border-left-width"]) || 0;
    var borderTC = p["border-top-color"] || null;
    var borderRC = p["border-right-color"] || null;
    var borderBC = p["border-bottom-color"] || null;
    var borderLC = p["border-left-color"] || null;
    var borderTS = p["border-top-style"] || "solid";
    var radiusTL = parseFloat(p["border-top-left-radius"]) || 0;
    var radiusTR = parseFloat(p["border-top-right-radius"]) || 0;
    var radiusBR = parseFloat(p["border-bottom-right-radius"]) || 0;
    var radiusBL = parseFloat(p["border-bottom-left-radius"]) || 0;
    var opacity = parseFloat(p["opacity"]) || 1;
    var overflow = p["overflow"] || "visible";
    var clipPath = p["clip-path"] || null;
    var shadow = parseShadow(p["box-shadow"]);
    var textShadow = parseShadow(p["text-shadow"]);

    var hasBorder = (borderTW > 0 || borderRW > 0 || borderBW > 0 || borderLW > 0);
    var hasBg = (bgColor && bgColor !== "transparent" && bgColor !== "rgba(0,0,0,0)");
    var isGradient = bgImage && /(linear|radial|conic)-gradient/.test(bgImage);
    var hasImage = bgImage && !bgImage.startsWith("none") && !isGradient;
    var hasGradient = isGradient;
    var maxRadius = Math.max(radiusTL, radiusTR, radiusBR, radiusBL);
    var clipsContent = overflow === "hidden" || overflow === "scroll" || overflow === "auto";

    var clipPathAttr = null;
    if (maxRadius > 0 || clipsContent) {
      clipId++;
      var clipDef = '<clipPath id="c' + clipId + '"><path d="' + generateSvgRect(x, y, w, h, maxRadius) + '" /></clipPath>';
      defs.push(clipDef);
      clipPathAttr = "c" + clipId;
    }

    var gOpen = '<g' + (clipPathAttr ? ' clip-path="url(#' + clipPathAttr + ')"' : '') + (opacity < 1 ? ' opacity="' + opacity + '"' : '') + '>';

    var hasElement = hasBg || hasImage || hasGradient || hasBorder || (el.text && el.text.length > 0) || el.src;

    if (!hasElement) continue;

    body.push(gOpen);

    if (shadow) {
      for (var si = 0; si < shadow.length; si++) {
        var sh = shadow[si];
        body.push('<rect x="' + (x + sh.dx) + '" y="' + (y + sh.dy) + '" width="' + w + '" height="' + h + '" rx="' + maxRadius + '" fill="' + escapeXml(sh.color) + '" opacity="0.3" filter="url(#shadowBlur)" />');
      }
    }

    if (hasBg || hasImage || hasGradient) {
      if (hasGradient) {
        var gradId = "g" + i;
        var gradDef = _parseGradientDef(gradId, bgImage, x, y, w, h);
        if (gradDef) defs.push(gradDef);
        body.push('<rect x="' + x + '" y="' + y + '" width="' + w + '" height="' + h + '"' + (maxRadius > 0 ? ' rx="' + maxRadius + '"' : '') + ' fill="url(#' + gradId + ')" />');
      } else if (hasImage) {
        var urlMatch = bgImage.match(/url\(["']?([^"')]+)["']?\)/);
        if (urlMatch) {
          body.push('<image x="' + x + '" y="' + y + '" width="' + w + '" height="' + h + '" preserveAspectRatio="xMidYMid slice" xlink:href="' + escapeXml(urlMatch[1]) + '" />');
        }
      } else if (hasBg) {
        body.push('<rect x="' + x + '" y="' + y + '" width="' + w + '" height="' + h + '"' + (maxRadius > 0 ? ' rx="' + maxRadius + '"' : '') + ' fill="' + escapeXml(bgColor) + '" />');
      }
    } else if (hasBorder && !hasBg) {
      body.push('<rect x="' + x + '" y="' + y + '" width="' + w + '" height="' + h + '"' + (maxRadius > 0 ? ' rx="' + maxRadius + '"' : '') + ' fill="none" />');
    }

    if (hasBorder) {
      var minBorder = 0.5;
      if (borderTW > minBorder && borderTC) body.push('<line x1="' + x + '" y1="' + y + '" x2="' + (x + w) + '" y2="' + y + '" stroke="' + escapeXml(borderTC) + '" stroke-width="' + borderTW + '" />');
      if (borderBW > minBorder && borderBC) body.push('<line x1="' + x + '" y1="' + (y + h) + '" x2="' + (x + w) + '" y2="' + (y + h) + '" stroke="' + escapeXml(borderBC) + '" stroke-width="' + borderBW + '" />');
      if (borderLW > minBorder && borderLC) body.push('<line x1="' + x + '" y1="' + y + '" x2="' + x + '" y2="' + (y + h) + '" stroke="' + escapeXml(borderLC) + '" stroke-width="' + borderLW + '" />');
      if (borderRW > minBorder && borderRC) body.push('<line x1="' + (x + w) + '" y1="' + y + '" x2="' + (x + w) + '" y2="' + (y + h) + '" stroke="' + escapeXml(borderRC) + '" stroke-width="' + borderRW + '" />');
    }

    if (el.src) {
      body.push('<image x="' + x + '" y="' + y + '" width="' + w + '" height="' + h + '" preserveAspectRatio="xMidYMid slice" xlink:href="' + escapeXml(el.src) + '" />');
    }

    if (el.text && el.text.length > 0) {
      var fontSize = parseFloat(p["font-size"]) || 16;
      var fontFamily = p["font-family"] || "Inter, sans-serif";
      var fontWeight = p["font-weight"] || "400";
      var fontStyle = p["font-style"] || "normal";
      var color = p["color"] || "#1e293b";
      var textAlign = (p["text-align"] || "left").toLowerCase();
      var lineH = parseFloat(p["line-height"]) || fontSize * 1.4;
      var letterSpacing = parseFloat(p["letter-spacing"]) || 0;
      var textTransform = p["text-transform"] || "none";
      var paddingTop = parseFloat(p["padding-top"]) || 0;
      var paddingLeft = parseFloat(p["padding-left"]) || 0;

      var displayText = el.text;
      if (textTransform === "uppercase") displayText = displayText.toUpperCase();
      else if (textTransform === "lowercase") displayText = displayText.toLowerCase();
      else if (textTransform === "capitalize") displayText = displayText.replace(/\b\w/g, function(c) { return c.toUpperCase(); });

      var textX = x + paddingLeft + 2;
      var textY = y + paddingTop + fontSize;
      var textW = w - paddingLeft - (parseFloat(p["padding-right"]) || 0) - 4;
      var anchor = "start";

      if (textAlign === "center") { textX = x + w / 2; anchor = "middle"; }
      else if (textAlign === "right") { textX = x + w - (parseFloat(p["padding-right"]) || 0) - 2; anchor = "end"; }

      var textEl = '<text x="' + textX + '" y="' + textY + '" font-family="' + escapeXml(fontFamily) + '" font-size="' + fontSize + '" font-weight="' + fontWeight + '"' + (fontStyle === "italic" ? ' font-style="italic"' : '') + ' fill="' + escapeXml(color) + '" text-anchor="' + anchor + '"' + (letterSpacing !== 0 ? ' letter-spacing="' + letterSpacing + '"' : '') + '>' + escapeXml(displayText) + '</text>';
      body.push(textEl);
    }

    body.push('</g>');
  }

  var svgHeader = '<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="' + pw + '" height="' + ph + '" viewBox="0 0 ' + pw + ' ' + ph + '">\n';
  svgHeader += '  <defs>\n';
  svgHeader += '    <filter id="shadowBlur"><feGaussianBlur stdDeviation="3" /></filter>\n';

  for (var di = 0; di < defs.length; di++) {
    svgHeader += '    ' + defs[di] + '\n';
  }

  svgHeader += '  </defs>\n';

  return svgHeader + '  <g class="vector-export">\n    ' + body.join("\n    ") + '\n  </g>\n</svg>';
}

function _parseGradientDef(id, cssVal, x, y, w, h) {
  if (!cssVal || cssVal === "none") return null;

  var nested = "(?:[^()]|\\([^)]*\\))*";
  var linearMatch = cssVal.match(new RegExp("linear-gradient\\((" + nested + ")\\)"));
  if (linearMatch) {
    var parts = linearMatch[1].split(/,(?![^()]*\))/);
    var angle = 180;
    var firstPart = parts[0].trim();
    var degMatch = firstPart.match(/([\d.]+)deg/);
    if (degMatch) angle = parseFloat(degMatch[1]);
    else if (firstPart === "to top") angle = 0;
    else if (firstPart === "to right") angle = 90;
    else if (firstPart === "to bottom") angle = 180;
    else if (firstPart === "to left") angle = 270;
    else if (firstPart === "to top right" || firstPart === "to right top") angle = 45;
    else if (firstPart === "to top left" || firstPart === "to left top") angle = 315;
    else if (firstPart === "to bottom right" || firstPart === "to right bottom") angle = 135;
    else if (firstPart === "to bottom left" || firstPart === "to left bottom") angle = 225;
    else if (!firstPart.includes("deg") && !firstPart.includes("turn") && !firstPart.includes("rad") && !firstPart.includes("grad")) {
      parts.unshift("");
    }

    var stopParts = [];
    for (var si = 0; si < parts.length; si++) {
      var part = parts[si].trim();
      if (!part || part.match(/^\d/) || part.match(/^(to |at |ellipse|circle|closest|farthest)/)) continue;
      stopParts.push(part);
    }

    var stops = [];
    for (var si = 0; si < stopParts.length; si++) {
      var stopMatch = stopParts[si].match(/(rgba?\([^)]+\)|#[0-9a-fA-F]+|[a-z]+)\s*([\d.]+%)?/);
      if (stopMatch) {
        var off = stopMatch[2];
        if (!off) {
          off = si === 0 ? "0%" : si === stopParts.length - 1 ? "100%" : (si / (stopParts.length - 1) * 100) + "%";
        }
        stops.push({ color: stopMatch[1], offset: off });
      }
    }

    if (stops.length >= 2) {
      var angleRad = (90 - angle) * Math.PI / 180;
      var gradStr = '<linearGradient id="' + id + '" x1="0%" y1="0%" x2="' + (Math.cos(angleRad)).toFixed(4) + '" y2="' + (-Math.sin(angleRad)).toFixed(4) + '">\n';
      for (var si2 = 0; si2 < stops.length; si2++) {
        gradStr += '        <stop offset="' + stops[si2].offset + '" stop-color="' + stops[si2].color + '" />\n';
      }
      gradStr += '      </linearGradient>';
      return gradStr;
    }
  }

  var radialMatch = cssVal.match(new RegExp("radial-gradient\\((" + nested + ")\\)"));
  if (radialMatch) {
    var parts = radialMatch[1].split(/,(?![^()]*\))/);
    var stops = [];
    for (var si = 0; si < parts.length; si++) {
      var part = parts[si].trim();
      if (!part || part.match(/^(at |ellipse|circle|closest|farthest|[^\s]*deg|[^\s]*px)/)) continue;
      var stopMatch = part.match(/(rgba?\([^)]+\)|#[0-9a-fA-F]+|[a-z]+)\s*([\d.]+%)?/);
      if (stopMatch) {
        stops.push({ color: stopMatch[1], offset: stopMatch[2] || (si === 0 ? "0%" : si === parts.length - 1 ? "100%" : (si / (parts.length - 1) * 100) + "%") });
      }
    }
    if (stops.length >= 2) {
      var gradStr = '<radialGradient id="' + id + '" cx="50%" cy="50%" r="50%">\n';
      for (var si2 = 0; si2 < stops.length; si2++) {
        gradStr += '        <stop offset="' + stops[si2].offset + '" stop-color="' + stops[si2].color + '" />\n';
      }
      gradStr += '      </radialGradient>';
      return gradStr;
    }
  }

  return null;
}

async function convertToSvg(html, options) {
  var cfg = resolveFormatOptions("svg", options);
  var { width = cfg.width, height = cfg.height, scale = cfg.scale } = options || {};
  var pool = getPool();

  return pool.execute(async (page) => {
    await page.setViewport({ width, height, deviceScaleFactor: scale });
    await page.setContent(html, { waitUntil: "networkidle2", timeout: 30000 });
    await page.evaluate(() => document.fonts && document.fonts.ready);
    await new Promise((r) => setTimeout(r, 800));

    var script = SVG_EXTRACT_SCRIPT
      .split("__MAX_ELEMENTS__").join(String(cfg.maxElements))
      .split("__MAX_DEPTH__").join(String(cfg.maxDepth));
    var data = await page.evaluate(script);
    var elements = data.elements || [];
    var pw = data.pageWidth || width;
    var ph = data.pageHeight || height;

    var svgStr = buildSvg(pw, ph, elements);
    return Buffer.from(svgStr, "utf-8");
  }, { timeout: 90000, retries: 3 });
}

module.exports = { convertToSvg };
