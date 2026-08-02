const crypto = require("crypto");
const { parseCssGradient } = require("./gradient-parser");

function hexToRgb(hex) {
  hex = hex.replace("#", "");
  if (hex.length === 3) hex = hex[0]+hex[0]+hex[1]+hex[1]+hex[2]+hex[2];
  var alpha = 1;
  if (hex.length === 8) {
    alpha = parseInt(hex.substring(6,8), 16) / 255;
    hex = hex.substring(0, 6);
  }
  if (hex.length !== 6) return null;
  return {
    r: parseInt(hex.substring(0,2), 16) / 255,
    g: parseInt(hex.substring(2,4), 16) / 255,
    b: parseInt(hex.substring(4,6), 16) / 255,
    a: alpha,
  };
}

function rgbaToColor(str) {
  var m = str.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+))?\s*\)/);
  if (!m) return null;
  return {
    r: parseInt(m[1]) / 255,
    g: parseInt(m[2]) / 255,
    b: parseInt(m[3]) / 255,
    a: m[4] !== undefined ? parseFloat(m[4]) : 1,
  };
}

function parseColor(str) {
  if (!str || str === "transparent" || str === "rgba(0, 0, 0, 0)" || str === "rgba(0,0,0,0)") return null;
  if (str.startsWith("#")) return hexToRgb(str);
  if (str.startsWith("rgba") || str.startsWith("rgb")) return rgbaToColor(str);
  if (str.startsWith("hsl")) return hslToColor(str);
  return null;
}

function hslToColor(str) {
  var m = str.match(/hsla?\(\s*([\d.]+)\s*,\s*([\d.]+)%\s*,\s*([\d.]+)%\s*(?:,\s*([\d.]+))?\s*\)/);
  if (!m) return null;
  var h = parseFloat(m[1]) / 360;
  var s = parseFloat(m[2]) / 100;
  var l = parseFloat(m[3]) / 100;
  var a = m[4] !== undefined ? parseFloat(m[4]) : 1;
  var r, g, b;
  if (s === 0) { r = g = b = l; }
  else {
    function hue2rgb(p, q, t) {
      if (t < 0) t += 1;
      if (t > 1) t -= 1;
      if (t < 1/6) return p + (q - p) * 6 * t;
      if (t < 1/2) return q;
      if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
      return p;
    }
    var q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    var p = 2 * l - q;
    r = hue2rgb(p, q, h + 1/3);
    g = hue2rgb(p, q, h);
    b = hue2rgb(p, q, h - 1/3);
  }
  return { r: r, g: g, b: b, a: a };
}

function solidFill(str, opacity) {
  var c = parseColor(str);
  if (!c) return [];
  if (opacity !== undefined) c.a = opacity;
  return [{ type: "SOLID", color: c, opacity: 1, visible: true, blendMode: "NORMAL" }];
}

function parseGradient(str) {
  if (!str || str === "none") return [];
  return parseCssGradient(str);
}

function resolveFills(props) {
  var bg = props["background-color"];
  var bgImage = props["background-image"];
  var bgShorthand = props["background"];

  if (bgShorthand && (bgShorthand.includes("linear-gradient") || bgShorthand.includes("radial-gradient"))) return parseGradient(bgShorthand);
  if (bgImage && (bgImage.includes("linear-gradient") || bgImage.includes("radial-gradient"))) return parseGradient(bgImage);

  if (bg) {
    var c = parseColor(bg);
    if (c) return [{ type: "SOLID", color: c, opacity: 1, visible: true, blendMode: "NORMAL" }];
  }
  if (bgShorthand) {
    var c2 = parseColor(bgShorthand);
    if (c2) return [{ type: "SOLID", color: c2, opacity: 1, visible: true, blendMode: "NORMAL" }];
  }
  return [];
}

function resolveImageFill(props) {
  var bgImage = props["background-image"];
  if (!bgImage) return null;
  var m = bgImage.match(/url\(["']?([^"')]+)["']?\)/);
  if (!m) return null;
  return m[1];
}

function parseShadow(str) {
  if (!str || str === "none") return undefined;
  var shadows = parseBoxShadows(str);
  return shadows.length > 0 ? shadows[0] : undefined;
}

function parseBoxShadows(str) {
  if (!str || str === "none") return [];
  var shadows = [];
  var parts = str.split(/,(?![^(]*\))/);
  for (var i = 0; i < parts.length; i++) {
    var s = parts[i].trim();
    var m = s.match(/(-?[\d.]+)px\s+(-?[\d.]+)px\s+(-?[\d.]+)px\s*(-?[\d.]+)?px?\s*(rgba?\([^)]+\))?/);
    if (m) {
      var c = parseColor(m[5] || "rgba(0,0,0,0.1)") || { r:0, g:0, b:0, a:0.1 };
      shadows.push({
        type: "DROP_SHADOW", color: c,
        offset: { x: parseFloat(m[1]), y: parseFloat(m[2]) },
        radius: parseFloat(m[3]), spread: parseFloat(m[4]) || 0,
        visible: true, blendMode: "NORMAL",
      });
    }
  }
  return shadows;
}

function parseTextShadow(str) {
  if (!str || str === "none") return [];
  var shadows = [];
  var parts = str.split(/,(?![^(]*\))/);
  for (var i = 0; i < parts.length; i++) {
    var s = parts[i].trim();
    var m = s.match(/(-?[\d.]+)px\s+(-?[\d.]+)px\s+(-?[\d.]+)px\s*(rgba?\([^)]+\))?/);
    if (m) {
      var c = parseColor(m[4] || "rgba(0,0,0,0.1)") || { r:0, g:0, b:0, a:0.1 };
      shadows.push({
        type: "DROP_SHADOW", color: c,
        offset: { x: parseFloat(m[1]), y: parseFloat(m[2]) },
        radius: parseFloat(m[3]), spread: 0,
        visible: true, blendMode: "NORMAL",
      });
    }
  }
  return shadows.length > 0 ? shadows : [];
}

function getStroke(props) {
  var tw = parseFloat(props["border-top-width"]) || 0;
  var rw = parseFloat(props["border-right-width"]) || 0;
  var bw = parseFloat(props["border-bottom-width"]) || 0;
  var lw = parseFloat(props["border-left-width"]) || 0;
  var max = Math.max(tw, rw, bw, lw);
  if (max === 0) return { paints: [], weight: 0 };

  var topStyle = props["border-top-style"] || "none";
  var rightStyle = props["border-right-style"] || "none";
  var bottomStyle = props["border-bottom-style"] || "none";
  var leftStyle = props["border-left-style"] || "none";
  if (topStyle === "none" && rightStyle === "none" && bottomStyle === "none" && leftStyle === "none") {
    return { paints: [], weight: 0 };
  }

  var c = parseColor(props["border-top-color"] || props["border-right-color"] || props["border-bottom-color"] || props["border-left-color"]) || { r:0, g:0, b:0, a:1 };
  return { paints: [{ type: "SOLID", color: c, opacity: 1, visible: true, blendMode: "NORMAL" }], weight: max };
}

function getRadius(props, width, height) {
  var tl = parseFloat(props["border-top-left-radius"]) || 0;
  var tr = parseFloat(props["border-top-right-radius"]) || 0;
  var br = parseFloat(props["border-bottom-right-radius"]) || 0;
  var bl = parseFloat(props["border-bottom-left-radius"]) || 0;

  var tlStr = props["border-top-left-radius"] || "";
  var trStr = props["border-top-right-radius"] || "";
  var brStr = props["border-bottom-right-radius"] || "";
  var blStr = props["border-bottom-left-radius"] || "";

  var minDim = Math.min(width || 100, height || 100);

  if (tlStr.includes("%")) tl = minDim * (tl / 100 || 0.5);
  if (trStr.includes("%")) tr = minDim * (tr / 100 || 0.5);
  if (brStr.includes("%")) br = minDim * (br / 100 || 0.5);
  if (blStr.includes("%")) bl = minDim * (bl / 100 || 0.5);

  return Math.max(tl, tr, br, bl);
}

function fontFamily(f) {
  if (!f) return "Inter";
  if (f.includes("Playfair")) return "Playfair Display";
  if (f.includes("Inter")) return "Inter";
  if (f.includes("serif")) return "Playfair Display";
  return "Inter";
}

function fontWeight(w) {
  var n = parseInt(w) || 400;
  if (n <= 300) return "Light";
  if (n <= 400) return "Regular";
  if (n <= 500) return "Medium";
  if (n <= 600) return "Semi Bold";
  if (n <= 700) return "Bold";
  return "Extra Bold";
}

function makePos(x, y) {
  return { m00: 1, m01: 0, m02: Math.round(x), m10: 0, m11: 1, m12: Math.round(y) };
}

function zOrderChar(index) {
  var code = 0x21 + index;
  if (code > 0x7E) code = 0x7E;
  return String.fromCharCode(code);
}

function guid(sid, lid) {
  return { sessionID: sid || 1, localID: lid != null ? lid : 0 };
}

function pluginData(isText) {
  var pd = [{ pluginID: "open-pencil", key: "layoutDirection", value: "AUTO" }];
  if (isText) pd.push({ pluginID: "open-pencil", key: "textDirection", value: "AUTO" });
  return pd;
}

function computeSHA1(buffer) {
  return crypto.createHash("sha1").update(buffer).digest("hex");
}

function computeSHA1Bytes(buffer) {
  return new Uint8Array(crypto.createHash("sha1").update(buffer).digest());
}

function readableName(tag, cls, text) {
  if (text && text.length > 0 && text.length <= 30) return text.substring(0, 40);
  var clsParts = (cls || "").split(/\s+/).filter(Boolean);
  var first = clsParts[0] || tag;
  var map = {
    "header-top": "Header Top", "header-bottom": "Header Bottom",
    "header": "Header", "footer": "Footer", "nav": "Navigation",
    "container": "Container", "wrapper": "Wrapper",
    "btn": "Button", "btn-primary": "Primary Button", "btn-secondary": "Secondary Button",
    "card": "Card", "product-card": "Product Card",
    "section": "Section", "hero": "Hero", "banner": "Banner",
    "sidebar": "Sidebar", "main": "Main", "content": "Content",
    "row": "Row", "col": "Column", "grid": "Grid",
    "input": "Input", "select": "Select", "textarea": "Textarea",
    "icon": "Icon", "logo": "Logo", "image": "Image",
    "svg": "Icon", "path": "Icon Path", "circle": "Circle",
    "polyline": "Icon Path", "polygon": "Icon Path", "rect": "Icon Rect",
    "line": "Icon Line", "ellipse": "Icon Ellipse",
  };
  if (tag === "pseudo-before") return "Before: " + (text || "").substring(0, 20);
  if (tag === "pseudo-after") return "After: " + (text || "").substring(0, 20);
  if (map[first]) return map[first];
  return first.charAt(0).toUpperCase() + first.slice(1).replace(/-/g, " ");
}

module.exports = {
  parseColor, solidFill, parseGradient, resolveFills, resolveImageFill,
  parseShadow, parseBoxShadows, parseTextShadow, getStroke, getRadius, fontFamily, fontWeight,
  makePos, zOrderChar, guid, pluginData, computeSHA1, computeSHA1Bytes,
  readableName, hexToRgb, rgbaToColor,
};
