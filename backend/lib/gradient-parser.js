/**
 * CSS-to-Figma gradient parser.
 *
 * Browsers rasterize gradients on the GPU; Figma needs explicit gradient
 * handles (start/end points) plus color stops. This module converts CSS
 * `linear-gradient(...)` / `radial-gradient(...)` strings into Figma paint
 * objects, handling:
 *   - deg / turn / rad angles and `to <side|corner>` keywords
 *   - hex, rgb()/rgba(), hsl()/hsla(), and named colors
 *   - color stops with or without explicit positions (missing positions are
 *     distributed evenly, matching the CSS default)
 *   - multiple gradients in a single background declaration
 */

var NAMED_COLORS = {
  aliceblue: "#f0f8ff", antiquewhite: "#faebd7", aqua: "#00ffff", aquamarine: "#7fffd4",
  azure: "#f0ffff", beige: "#f5f5dc", bisque: "#ffe4c4", black: "#000000",
  blanchedalmond: "#ffebcd", blue: "#0000ff", blueviolet: "#8a2be2", brown: "#a52a2a",
  burlywood: "#deb887", cadetblue: "#5f9ea0", chartreuse: "#7fff00", chocolate: "#d2691e",
  coral: "#ff7f50", cornflowerblue: "#6495ed", cornsilk: "#fff8dc", crimson: "#dc143c",
  cyan: "#00ffff", darkblue: "#00008b", darkcyan: "#008b8b", darkgoldenrod: "#b8860b",
  darkgray: "#a9a9a9", darkgreen: "#006400", darkgrey: "#a9a9a9", darkkhaki: "#bdb76b",
  darkmagenta: "#8b008b", darkolivegreen: "#556b2f", darkorange: "#ff8c00", darkorchid: "#9932cc",
  darkred: "#8b0000", darksalmon: "#e9967a", darkseagreen: "#8fbc8f", darkslateblue: "#483d8b",
  darkslategray: "#2f4f4f", darkslategrey: "#2f4f4f", darkturquoise: "#00ced1", darkviolet: "#9400d3",
  deeppink: "#ff1493", deepskyblue: "#00bfff", dimgray: "#696969", dimgrey: "#696969",
  dodgerblue: "#1e90ff", firebrick: "#b22222", floralwhite: "#fffaf0", forestgreen: "#228b22",
  fuchsia: "#ff00ff", gainsboro: "#dcdcdc", ghostwhite: "#f8f8ff", gold: "#ffd700",
  goldenrod: "#daa520", gray: "#808080", green: "#008000", greenyellow: "#adff2f",
  grey: "#808080", honeydew: "#f0fff0", hotpink: "#ff69b4", indianred: "#cd5c5c",
  indigo: "#4b0082", ivory: "#fffff0", khaki: "#f0e68c", lavender: "#e6e6fa",
  lavenderblush: "#fff0f5", lawngreen: "#7cfc00", lemonchiffon: "#fffacd", lightblue: "#add8e6",
  lightcoral: "#f08080", lightcyan: "#e0ffff", lightgoldenrodyellow: "#fafad2", lightgray: "#d3d3d3",
  lightgreen: "#90ee90", lightgrey: "#d3d3d3", lightpink: "#ffb6c1", lightsalmon: "#ffa07a",
  lightseagreen: "#20b2aa", lightskyblue: "#87cefa", lightslategray: "#778899", lightslategrey: "#778899",
  lightsteelblue: "#b0c4de", lightyellow: "#ffffe0", lime: "#00ff00", limegreen: "#32cd32",
  linen: "#faf0e6", magenta: "#ff00ff", maroon: "#800000", mediumaquamarine: "#66cdaa",
  mediumblue: "#0000cd", mediumorchid: "#ba55d3", mediumpurple: "#9370db", mediumseagreen: "#3cb371",
  mediumslateblue: "#7b68ee", mediumspringgreen: "#00fa9a", mediumturquoise: "#48d1cc", mediumvioletred: "#c71585",
  midnightblue: "#191970", mintcream: "#f5fffa", mistyrose: "#ffe4e1", moccasin: "#ffe4b5",
  navajowhite: "#ffdead", navy: "#000080", oldlace: "#fdf5e6", olive: "#808000",
  olivedrab: "#6b8e23", orange: "#ffa500", orangered: "#ff4500", orchid: "#da70d6",
  palegoldenrod: "#eee8aa", palegreen: "#98fb98", paleturquoise: "#afeeee", palevioletred: "#db7093",
  papayawhip: "#ffefd5", peachpuff: "#ffdab9", peru: "#cd853f", pink: "#ffc0cb",
  plum: "#dda0dd", powderblue: "#b0e0e6", purple: "#800080", red: "#ff0000",
  rosybrown: "#bc8f8f", royalblue: "#4169e1", saddlebrown: "#8b4513", salmon: "#fa8072",
  sandybrown: "#f4a460", seagreen: "#2e8b57", seashell: "#fff5ee", sienna: "#a0522d",
  silver: "#c0c0c0", skyblue: "#87ceeb", slateblue: "#6a5acd", slategray: "#708090",
  slategrey: "#708090", snow: "#fffafa", springgreen: "#00ff7f", steelblue: "#4682b4",
  tan: "#d2b48c", teal: "#008080", thistle: "#d8bfd8", tomato: "#ff6347",
  turquoise: "#40e0d0", violet: "#ee82ee", wheat: "#f5deb3", white: "#ffffff",
  whitesmoke: "#f5f5f5", yellow: "#ffff00", yellowgreen: "#9acd32",
};

function hexToRgb(hex) {
  hex = hex.replace("#", "");
  if (hex.length === 3) hex = hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2];
  var alpha = 1;
  if (hex.length === 8) {
    alpha = parseInt(hex.substring(6, 8), 16) / 255;
    hex = hex.substring(0, 6);
  }
  if (hex.length !== 6) return null;
  return {
    r: parseInt(hex.substring(0, 2), 16) / 255,
    g: parseInt(hex.substring(2, 4), 16) / 255,
    b: parseInt(hex.substring(4, 6), 16) / 255,
    a: alpha,
  };
}

function rgbaToColor(str) {
  var m = str.match(/rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+%?))?\s*\)/i);
  if (!m) return null;
  var a = m[4] !== undefined ? parseFloat(m[4].replace("%", "")) / (m[4].indexOf("%") >= 0 ? 100 : 1) : 1;
  return {
    r: Math.min(parseFloat(m[1]) / 255, 1),
    g: Math.min(parseFloat(m[2]) / 255, 1),
    b: Math.min(parseFloat(m[3]) / 255, 1),
    a: a,
  };
}

function hslToColor(str) {
  var m = str.match(/hsla?\(\s*([\d.]+)\s*,\s*([\d.]+)%\s*,\s*([\d.]+)%\s*(?:,\s*([\d.]+%?))?\s*\)/i);
  if (!m) return null;
  var h = parseFloat(m[1]) / 360;
  var s = parseFloat(m[2]) / 100;
  var l = parseFloat(m[3]) / 100;
  var a = m[4] !== undefined ? parseFloat(m[4].replace("%", "")) / (m[4].indexOf("%") >= 0 ? 100 : 1) : 1;
  var r, g, b;
  if (s === 0) { r = g = b = l; }
  else {
    function hue2rgb(p, q, t) {
      if (t < 0) t += 1;
      if (t > 1) t -= 1;
      if (t < 1 / 6) return p + (q - p) * 6 * t;
      if (t < 1 / 2) return q;
      if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
      return p;
    }
    var q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    var p = 2 * l - q;
    r = hue2rgb(p, q, h + 1 / 3);
    g = hue2rgb(p, q, h);
    b = hue2rgb(p, q, h - 1 / 3);
  }
  return { r: r, g: g, b: b, a: a };
}

function parseColorValue(str) {
  str = String(str || "").trim();
  if (!str || str === "transparent" || /^rgba?\(\s*0\s*,\s*0\s*,\s*0\s*,\s*0(?:\.0+)?\)$/i.test(str)) {
    return { r: 0, g: 0, b: 0, a: 0 };
  }
  if (str.charAt(0) === "#") return hexToRgb(str);
  if (/^rgba?\(/i.test(str)) return rgbaToColor(str);
  if (/^hsla?\(/i.test(str)) return hslToColor(str);
  var named = NAMED_COLORS[str.toLowerCase()];
  if (named) return hexToRgb(named);
  return null;
}

function extractFunctionBody(str, openIdx) {
  var depth = 0;
  for (var i = openIdx; i < str.length; i++) {
    var ch = str[i];
    if (ch === "(") depth++;
    else if (ch === ")") {
      depth--;
      if (depth === 0) return { body: str.slice(openIdx + 1, i), closeIdx: i };
    }
  }
  return { body: "", closeIdx: -1 };
}

function splitTopLevel(str, sep) {
  var parts = [];
  var depth = 0;
  var cur = "";
  for (var i = 0; i < str.length; i++) {
    var ch = str[i];
    if (ch === "(") depth++;
    else if (ch === ")") depth--;
    if (ch === sep && depth === 0) {
      parts.push(cur.trim());
      cur = "";
    } else {
      cur += ch;
    }
  }
  parts.push(cur.trim());
  return parts;
}

function extractColorToken(s) {
  var depth = 0;
  for (var i = 0; i < s.length; i++) {
    var c = s[i];
    if (c === "(") depth++;
    else if (c === ")") depth--;
    else if ((c === " " || c === "\t") && depth === 0) return s.slice(0, i);
  }
  return s;
}

function assignDefaultPositions(stops) {
  var n = stops.length;
  if (n < 2) return stops;
  var anyKnown = false;
  for (var k = 0; k < n; k++) {
    if (stops[k].position !== null) { anyKnown = true; break; }
  }
  if (!anyKnown) {
    for (var q = 0; q < n; q++) stops[q].position = n > 1 ? q / (n - 1) : 0;
    return stops;
  }
  var lastKnown = -1;
  for (var i = 0; i < n; i++) {
    if (stops[i].position !== null) { lastKnown = i; continue; }
    var nextKnown = -1;
    for (var j = i + 1; j < n; j++) {
      if (stops[j].position !== null) { nextKnown = j; break; }
    }
    var p0 = lastKnown >= 0 ? stops[lastKnown].position : 0;
    var p1 = nextKnown >= 0 ? stops[nextKnown].position : 1;
    var steps = nextKnown >= 0 ? nextKnown - lastKnown : (n - 1 - lastKnown);
    var idx = i - lastKnown;
    stops[i].position = p0 + (p1 - p0) * (idx / steps);
  }
  return stops;
}

function parseGradientStops(str) {
  var parts = splitTopLevel(str, ",");
  var stops = [];
  for (var i = 0; i < parts.length; i++) {
    var part = parts[i].trim();
    if (!part) continue;
    var token = extractColorToken(part);
    var color = parseColorValue(token);
    if (!color) continue;
    var rest = part.slice(token.length).trim();
    var position = null;
    var pm = rest.match(/([\d.]+)%|([\d.]+)px/);
    if (pm) {
      if (pm[1] !== undefined) {
        position = Math.min(Math.max(parseFloat(pm[1]) / 100, 0), 1);
      } else {
        position = null;
      }
    }
    stops.push({ color: color, position: position });
  }
  return assignDefaultPositions(stops);
}

function resolveAngle(anglePart) {
  var am = anglePart.match(/(-?[\d.]+)deg$/i);
  if (am) return { angleDeg: parseFloat(am[1]), hasAngle: true };
  var tm = anglePart.match(/(-?[\d.]+)turn$/i);
  if (tm) return { angleDeg: parseFloat(tm[1]) * 360, hasAngle: true };
  var rm = anglePart.match(/(-?[\d.]+)rad$/i);
  if (rm) return { angleDeg: (parseFloat(rm[1]) * 180) / Math.PI, hasAngle: true };
  var to = /^to\s+(.+)$/i.exec(anglePart);
  if (to) {
    var dir = to[1].trim().toLowerCase().replace(/\s+/g, " ");
    var map = {
      "top": 0, "right": 90, "bottom": 180, "left": 270,
      "top right": 45, "right top": 45,
      "bottom right": 135, "right bottom": 135,
      "bottom left": 225, "left bottom": 225,
      "top left": 315, "left top": 315,
    };
    if (map[dir] !== undefined) return { angleDeg: map[dir], hasAngle: true };
  }
  return { angleDeg: 180, hasAngle: false };
}

function gradientTransformForAngle(angleDeg) {
  var rad = (angleDeg * Math.PI) / 180;
  return {
    m00: Math.sin(rad), m01: Math.cos(rad), m02: 0.5 - 0.5 * Math.sin(rad),
    m10: -Math.cos(rad), m11: Math.sin(rad), m12: 0.5 + 0.5 * Math.cos(rad),
  };
}

function gradientHandlesForAngle(angleDeg) {
  var rad = ((angleDeg - 180) * Math.PI) / 180;
  var cos = Math.cos(rad);
  var sin = Math.sin(rad);
  var startX = 0.5 + cos * 0.5;
  var startY = 0.5 + sin * 0.5;
  var endX = 0.5 - cos * 0.5;
  var endY = 0.5 - sin * 0.5;
  return [
    { x: startX, y: startY },
    { x: endX, y: endY },
    { x: startX, y: startY },
  ];
}

function parseLinearGradientBody(body) {
  var firstComma = topLevelIndex(body, ",");
  var anglePart = firstComma >= 0 ? body.slice(0, firstComma).trim() : "";
  var stopsPart = firstComma >= 0 ? body.slice(firstComma + 1) : body;

  var resolved = resolveAngle(anglePart);
  var angleDeg = resolved.angleDeg;
  if (!resolved.hasAngle) {
    stopsPart = body;
  }

  var stops = parseGradientStops(stopsPart);
  if (stops.length < 2) return null;

  var defaultColor = { r: 0, g: 0, b: 0, a: 1 };
  return {
    type: "GRADIENT_LINEAR",
    color: stops[0].color || defaultColor,
    gradientStops: stops,
    gradientTransform: gradientTransformForAngle(angleDeg),
    gradientHandlePositions: gradientHandlesForAngle(angleDeg),
    opacity: 1,
    visible: true,
    blendMode: "NORMAL",
  };
}

function parseRadialGradientBody(body) {
  var parts = splitTopLevel(body, ",");
  var stopsStr = body;
  if (parts.length > 2) {
    var first = parts[0].trim();
    var firstToken = extractColorToken(first);
    if (!parseColorValue(firstToken)) {
      stopsStr = parts.slice(1).join(",");
    }
  }
  var stops = parseGradientStops(stopsStr);
  if (stops.length < 2) return null;
  var defaultColor = { r: 0, g: 0, b: 0, a: 1 };
  return {
    type: "GRADIENT_RADIAL",
    color: stops[0].color || defaultColor,
    gradientStops: stops,
    gradientTransform: { m00: 0.5, m01: 0, m02: 0.5, m10: 0, m11: 0.5, m12: 0.5 },
    opacity: 1,
    visible: true,
    blendMode: "NORMAL",
  };
}

function topLevelIndex(str, sep) {
  var depth = 0;
  for (var i = 0; i < str.length; i++) {
    var ch = str[i];
    if (ch === "(") depth++;
    else if (ch === ")") depth--;
    if (ch === sep && depth === 0) return i;
  }
  return -1;
}

function parseLinearGradient(cssValue) {
  var s = String(cssValue || "");
  var idx = s.toLowerCase().indexOf("linear-gradient(");
  if (idx < 0) return null;
  var openIdx = idx + "linear-gradient(".length - 1;
  var res = extractFunctionBody(s, openIdx);
  if (res.closeIdx === -1) return null;
  return parseLinearGradientBody(res.body);
}

function parseRadialGradient(cssValue) {
  var s = String(cssValue || "");
  var idx = s.toLowerCase().indexOf("radial-gradient(");
  if (idx < 0) return null;
  var openIdx = idx + "radial-gradient(".length - 1;
  var res = extractFunctionBody(s, openIdx);
  if (res.closeIdx === -1) return null;
  return parseRadialGradientBody(res.body);
}

function parseCssGradient(str) {
  if (!str || str === "none") return [];
  var fills = [];
  var s = String(str);
  var pos = 0;
  while (pos < s.length) {
    var lower = s.toLowerCase();
    var lIdx = lower.indexOf("linear-gradient(", pos);
    var rIdx = lower.indexOf("radial-gradient(", pos);
    if (lIdx === -1 && rIdx === -1) break;
    var idx = -1;
    var kind = null;
    if (lIdx === -1) { idx = rIdx; kind = "radial"; }
    else if (rIdx === -1) { idx = lIdx; kind = "linear"; }
    else if (lIdx < rIdx) { idx = lIdx; kind = "linear"; }
    else { idx = rIdx; kind = "radial"; }
    var openIdx = idx + (kind === "linear" ? "linear-gradient(".length : "radial-gradient(".length) - 1;
    var res = extractFunctionBody(s, openIdx);
    if (res.closeIdx === -1) break;
    var fill = kind === "linear" ? parseLinearGradientBody(res.body) : parseRadialGradientBody(res.body);
    if (fill) fills.push(fill);
    pos = res.closeIdx + 1;
  }
  return fills;
}

module.exports = {
  parseLinearGradient,
  parseRadialGradient,
  parseCssGradient,
};
