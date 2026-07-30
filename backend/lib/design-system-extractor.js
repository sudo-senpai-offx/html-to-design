function extractInlineValues(html) {
  var result = { colors: {}, fontFamilies: {}, spacingValues: {}, radiusValues: {}, shadowValues: {}, fontCombos: [] };
  var re = /style="([^"]*)"/g;
  var m;
  while ((m = re.exec(html)) !== null) {
    var decls = m[1].split(";");
    var cf = null, cs = null, cw = null;
    for (var di = 0; di < decls.length; di++) {
      var d = decls[di].trim();
      if (!d) continue;
      var ci = d.indexOf(":");
      if (ci === -1) continue;
      var p = d.substring(0, ci).trim();
      var v = d.substring(ci + 1).trim();
      if (!v || v === "initial" || v === "inherit" || v === "transparent") continue;
      if ((p === "color" || p === "background-color") && v !== "transparent") {
        var h = tryColorToHex(v);
        if (h) result.colors[h] = (result.colors[h] || 0) + 1;
      }
      if (p === "font-family") { var f = v.split(",")[0].trim().replace(/^['"]|['"]$/g, ""); if (!["sans-serif","serif","monospace","system-ui","inherit"].includes(f)) { result.fontFamilies[f] = (result.fontFamilies[f] || 0) + 1; cf = f; } }
      if (p === "font-size") { result.fontFamilies[cf || "Inter"] = (result.fontFamilies[cf || "Inter"] || 0); cs = v; }
      if (p === "font-weight") { cw = v; }
      if (p.indexOf("padding") === 0 || p.indexOf("margin") === 0 || p === "gap" || p === "column-gap" || p === "row-gap") { var nv = parseFloat(v); if (nv > 0 && nv <= 200) result.spacingValues[nv] = (result.spacingValues[nv] || 0) + 1; }
      if (p.indexOf("border-radius") === 0) { var rv = parseFloat(v); if (rv > 0) result.radiusValues[rv] = (result.radiusValues[rv] || 0) + 1; }
      if (p === "box-shadow" && v !== "none") result.shadowValues[v] = (result.shadowValues[v] || 0) + 1;
    }
    if (cf && cs && cw) result.fontCombos.push({ family: cf, size: cs, weight: cw });
  }
  return result;
}

function tryColorToHex(val) {
  if (!val) return null;
  var hm = val.match(/#([0-9a-fA-F]{3,8})/);
  if (hm) return normalizeHex("#" + hm[1]);
  var rm = val.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+))?\)/);
  if (rm) {
    var r = parseInt(rm[1]), g = parseInt(rm[2]), b = parseInt(rm[3]), a = rm[4] !== undefined ? parseFloat(rm[4]) : 1;
    if (a < 1) return "rgba(" + r + "," + g + "," + b + "," + a.toFixed(2) + ")";
    return rgbToHex(r, g, b);
  }
  return null;
}

function extractDesignSystem(html, inlinedHtml) {
  var cssVars = {};
  var rootMatch = html.match(/:root\s*\{([^}]+)\}/);
  if (rootMatch) {
    var varMatches = rootMatch[1].matchAll(/--([\w-]+)\s*:\s*([^;]+);/g);
    for (var m of varMatches) {
      cssVars["--" + m[1]] = m[2].trim();
    }
  }

  var valueToVar = {};
  for (var vn in cssVars) {
    var val = cssVars[vn];
    var resolved = resolveColorValue(val, cssVars);
    if (resolved) {
      if (!Array.isArray(valueToVar[resolved])) valueToVar[resolved] = [];
      valueToVar[resolved].push(vn);
    }
  }

  var allCss = "";
  var styleMatches = html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi);
  for (var sm of styleMatches) {
    allCss += sm[1] + "\n";
  }

  var fontFamilies = {};
  var fontMatches = allCss.matchAll(/font-family\s*:\s*([^;]+);/gi);
  for (var fm of fontMatches) {
    var raw = fm[1].trim();
    var families = raw.split(",").map(function(f) {
      return f.trim().replace(/^['"]|['"]$/g, "");
    }).filter(function(f) {
      return f && f !== "sans-serif" && f !== "serif" && f !== "monospace" &&
             f !== "-apple-system" && f !== "BlinkMacSystemFont" && f !== "Georgia" &&
             f !== "system-ui" && !f.startsWith("Apple");
    });
    for (var fam of families) {
      fontFamilies[fam] = (fontFamilies[fam] || 0) + 1;
    }
  }

  var fontSizes = {};
  var sizeMatches = allCss.matchAll(/font-size\s*:\s*([^;]+);/gi);
  for (var sm of sizeMatches) {
    var val = sm[1].trim();
    fontSizes[val] = (fontSizes[val] || 0) + 1;
  }

  var fontWeights = {};
  var weightMatches = allCss.matchAll(/font-weight\s*:\s*([^;]+);/gi);
  for (var wm of weightMatches) {
    var val = wm[1].trim();
    fontWeights[val] = (fontWeights[val] || 0) + 1;
  }

  var lineHeights = {};
  var lhMatches = allCss.matchAll(/line-height\s*:\s*([^;]+);/gi);
  for (var lm of lhMatches) {
    var val = lm[1].trim();
    lineHeights[val] = (lineHeights[val] || 0) + 1;
  }

  var colors = {};
  var colorRegex = /#([0-9a-fA-F]{3,8})\b/g;
  var colorMatches = allCss.matchAll(colorRegex);
  for (var cm of colorMatches) {
    var hex = normalizeHex("#" + cm[1]);
    if (hex) colors[hex] = (colors[hex] || 0) + 1;
  }

  var rgbaMatches = allCss.matchAll(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+))?\)/g);
  for (var rm of rgbaMatches) {
    var r = parseInt(rm[1]), g = parseInt(rm[2]), b = parseInt(rm[3]);
    var a = rm[4] !== undefined ? parseFloat(rm[4]) : 1;
    if (a < 1) {
      var hex = "rgba(" + r + "," + g + "," + b + "," + a.toFixed(2) + ")";
      colors[hex] = (colors[hex] || 0) + 1;
    } else {
      var hex = rgbToHex(r, g, b);
      if (hex) colors[hex] = (colors[hex] || 0) + 1;
    }
  }

  var htmlColors = html.matchAll(/(?:background|color|border-color|background-color)\s*[:=]\s*["']?(#[0-9a-fA-F]{3,8})/g);
  for (var hc of htmlColors) {
    var hex = normalizeHex(hc[1]);
    if (hex) colors[hex] = (colors[hex] || 0) + 1;
  }

  var varColorMatches = allCss.matchAll(/(?:background|color|border-color|background-color)\s*:\s*var\(--([\w-]+)\)/gi);
  for (var vcm of varColorMatches) {
    var varName = "--" + vcm[1];
    if (cssVars[varName] && cssVars[varName].match(/^#|rgba?\(/)) {
      var resolved = resolveColorValue(cssVars[varName], cssVars);
      if (resolved) colors[resolved] = (colors[resolved] || 0) + 2;
    }
  }

  var spacingValues = {};
  var spacingRegex = /--[\w-]*space[\w-]*\s*:\s*([\d.]+)px/g;
  var spacingVarMatches = allCss.matchAll(spacingRegex);
  for (var svm of spacingVarMatches) {
    var val = parseFloat(svm[1]);
    if (val > 0) spacingValues[val] = (spacingValues[val] || 0) + 1;
  }

  var paddingMatches = allCss.matchAll(/padding\s*:\s*([\d.]+)px/g);
  for (var pm of paddingMatches) {
    var val = parseFloat(pm[1]);
    if (val > 0 && val <= 200) spacingValues[val] = (spacingValues[val] || 0) + 1;
  }

  var gapMatches = allCss.matchAll(/gap\s*:\s*([\d.]+)px/g);
  for (var gm of gapMatches) {
    var val = parseFloat(gm[1]);
    if (val > 0 && val <= 200) spacingValues[val] = (spacingValues[val] || 0) + 1;
  }

  var marginMatches = allCss.matchAll(/margin(?:-(?:top|bottom|left|right))?\s*:\s*([\d.]+)px/g);
  for (var mm of marginMatches) {
    var val = parseFloat(mm[1]);
    if (val > 0 && val <= 200) spacingValues[val] = (spacingValues[val] || 0) + 1;
  }

  var radiusValues = {};
  var radiusMatches = allCss.matchAll(/border-radius\s*:\s*([\d.]+)px/g);
  for (var rm of radiusMatches) {
    var val = parseFloat(rm[1]);
    if (val > 0) radiusValues[val] = (radiusValues[val] || 0) + 1;
  }
  var radiusVarMatches = allCss.matchAll(/--[\w-]*radius[\w-]*\s*:\s*([\d.]+)px/g);
  for (var rvm of radiusVarMatches) {
    var val = parseFloat(rvm[1]);
    if (val > 0) radiusValues[val] = (radiusValues[val] || 0) + 1;
  }

  var shadowValues = {};
  var shadowMatches = allCss.matchAll(/box-shadow\s*:\s*([^;]+);/gi);
  for (var shm of shadowMatches) {
    var val = shm[1].trim();
    if (val !== "none") shadowValues[val] = (shadowValues[val] || 0) + 1;
  }
  var shadowVarMatches = allCss.matchAll(/--[\w-]*shadow[\w-]*\s*:\s*([^;]+);/g);
  for (var svm of shadowVarMatches) {
    var val = svm[1].trim();
    if (val !== "none") shadowValues[val] = (shadowValues[val] || 0) + 1;
  }

  if (inlinedHtml) {
    var inlineVals = extractInlineValues(inlinedHtml);
    for (var ic in inlineVals.colors) colors[ic] = (colors[ic] || 0) + inlineVals.colors[ic];
    for (var iff in inlineVals.fontFamilies) fontFamilies[iff] = (fontFamilies[iff] || 0) + inlineVals.fontFamilies[iff];
    for (var isv in inlineVals.spacingValues) spacingValues[isv] = (spacingValues[isv] || 0) + inlineVals.spacingValues[isv];
    for (var irv in inlineVals.radiusValues) radiusValues[irv] = (radiusValues[irv] || 0) + inlineVals.radiusValues[irv];
    for (var ishv in inlineVals.shadowValues) shadowValues[ishv] = (shadowValues[ishv] || 0) + inlineVals.shadowValues[ishv];
  }

  var typography = [];
  var sortedFonts = Object.entries(fontFamilies).sort(function(a, b) { return b[1] - a[1]; });

  var fontSizeContexts = {};
  var allFontRules = allCss.matchAll(/(?:font-family|font-size|font-weight|line-height)\s*:\s*([^;]+);/gi);
  var currentFamily = "Inter";
  var currentSize = "16px";
  var currentWeight = "400";
  var currentLH = "1.6";
  for (var fr of allFontRules) {
    var prop = fr[0].split(":")[0].trim();
    var val = fr[1].trim().replace(/!important/g, "").trim();
    if (prop === "font-family") currentFamily = val.split(",")[0].trim().replace(/^['"]|['"]$/g, "");
    else if (prop === "font-size") currentSize = val;
    else if (prop === "font-weight") currentWeight = val;
    else if (prop === "line-height") currentLH = val;
    var key = currentFamily + "|" + currentSize + "|" + currentWeight;
    if (!fontSizeContexts[key]) {
      fontSizeContexts[key] = { family: currentFamily, size: currentSize, weight: currentWeight, lh: currentLH, count: 0 };
    }
    fontSizeContexts[key].count++;
  }

  if (inlinedHtml && inlineVals && inlineVals.fontCombos.length > 0) {
    for (var fci = 0; fci < inlineVals.fontCombos.length; fci++) {
      var fc = inlineVals.fontCombos[fci];
      var fck = fc.family + "|" + fc.size + "|" + fc.weight;
      if (!fontSizeContexts[fck]) {
        fontSizeContexts[fck] = { family: fc.family, size: fc.size, weight: fc.weight, lh: "1.6", count: 0 };
      }
      fontSizeContexts[fck].count++;
    }
  }

  var entries = Object.values(fontSizeContexts).sort(function(a, b) { return b.count - a.count; });
  var seen = {};
  for (var e of entries) {
    var sizeVal = parsePx(e.size);
    if (!sizeVal || sizeVal < 8 || sizeVal > 100) continue;
    var key = e.family + "|" + sizeVal + "|" + e.weight;
    if (seen[key]) continue;
    seen[key] = true;

    var label = "Body";
    if (sizeVal >= 36) label = "Display";
    else if (sizeVal >= 28) label = "Heading 1";
    else if (sizeVal >= 22) label = "Heading 2";
    else if (sizeVal >= 18) label = "Heading 3";
    else if (sizeVal >= 16) label = "Heading 4";
    else if (sizeVal <= 11) label = "Caption";
    else if (sizeVal <= 13) label = "Small";

    typography.push({
      fontFamily: e.family,
      fontSize: sizeVal,
      fontWeight: String(e.weight),
      lineHeight: e.lh && e.lh.match(/[\d.]+/) ? e.lh.match(/[\d.]+/)[0] : null,
      label: label,
    });
  }

  typography.sort(function(a, b) { return b.fontSize - a.fontSize; });

  var finalTypo = [];
  var seenCombos = {};
  for (var t of typography) {
    var key = t.fontFamily + "|" + t.fontSize;
    if (seenCombos[key]) continue;
    seenCombos[key] = true;
    finalTypo.push(t);
  }
  typography = finalTypo.slice(0, 15);

  var colorsArr = Object.entries(colors)
    .sort(function(a, b) { return b[1] - a[1]; })
    .slice(0, 30)
    .map(function(entry) {
      var hex = entry[0];
      var count = entry[1];
      var cat = categorizeColor(hex);
      var obj = {
        value: hex,
        category: cat,
        usageCount: count,
      };
      var varNames = valueToVar[hex];
      if (varNames && varNames.length > 0) {
        obj.cssVariable = varNames[0];
      }
      return obj;
    });

  var spacingArr = Object.entries(spacingValues)
    .map(function(e) { return [parseFloat(e[0]), e[1]]; })
    .sort(function(a, b) { return a[0] - b[0]; })
    .filter(function(e) { return e[0] > 0 && e[0] <= 200; })
    .map(function(e) {
      return { value: e[0], sources: [] };
    });

  var radiusArr = Object.entries(radiusValues)
    .map(function(e) { return [parseFloat(e[0]), e[1]]; })
    .sort(function(a, b) { return a[0] - b[0]; })
    .map(function(e) {
      return { value: e[0] };
    });

  var shadowsArr = Object.entries(shadowValues)
    .sort(function(a, b) { return b[1] - a[1]; })
    .map(function(entry) {
      var parsed = parseShadow(entry[0]);
      return { value: entry[0], parsed: parsed };
    })
    .filter(function(s) { return s.parsed !== null; });

  return {
    name: "Extracted Design System",
    colors: colorsArr,
    typography: typography,
    spacing: spacingArr,
    borderRadius: radiusArr,
    shadows: shadowsArr,
  };
}

function normalizeHex(hex) {
  if (!hex) return null;
  hex = hex.toLowerCase();
  if (hex.length === 4) {
    hex = "#" + hex[1] + hex[1] + hex[2] + hex[2] + hex[3] + hex[3];
  }
  if (hex.length === 7 && /^#[0-9a-f]{6}$/.test(hex)) return hex;
  if (hex.length === 9 && /^#[0-9a-f]{8}$/.test(hex)) return hex;
  return null;
}

function rgbToHex(r, g, b) {
  if (r < 0 || r > 255 || g < 0 || g > 255 || b < 0 || b > 255) return null;
  return "#" + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
}

function resolveColorValue(val, vars) {
  if (!val) return null;
  var vMatch = val.match(/var\(--([\w-]+)\)/);
  if (vMatch && vars["--" + vMatch[1]]) {
    return resolveColorValue(vars["--" + vMatch[1]], vars);
  }
  var hexMatch = val.match(/#([0-9a-fA-F]{3,8})/);
  if (hexMatch) return normalizeHex("#" + hexMatch[1]);
  var rgbMatch = val.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
  if (rgbMatch) {
    return rgbToHex(parseInt(rgbMatch[1]), parseInt(rgbMatch[2]), parseInt(rgbMatch[3]));
  }
  return null;
}

function parsePx(val) {
  if (!val) return null;
  val = val.trim();
  if (val.endsWith("rem")) return parseFloat(val) * 16;
  if (val.endsWith("em")) return parseFloat(val) * 16;
  if (val.endsWith("px")) return parseFloat(val);
  var num = parseFloat(val);
  return isNaN(num) ? null : num;
}

function categorizeColor(hex) {
  if (!hex) return "other";
  var h = hex.toLowerCase();
  if (h === "#ffffff" || h === "#fff") return "background";
  if (h === "#000000" || h === "#000") return "text";
  var r = parseInt(h.substr(1, 2), 16);
  var g = parseInt(h.substr(3, 2), 16);
  var b = parseInt(h.substr(5, 2), 16);
  var lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  if (lum > 0.85) return "background";
  if (lum < 0.2) return "text";
  return "accent";
}

function parseShadow(val) {
  if (!val || val === "none") return null;
  var inset = val.includes("inset");
  var clean = val.replace("inset", "").trim();
  var nums = [];
  var colorPart = "";
  var parts = clean.split(/\s+/);
  for (var i = 0; i < parts.length; i++) {
    var p = parts[i];
    if (p.match(/^-?[\d.]+px?$/)) {
      nums.push(parseFloat(p));
    } else {
      colorPart = parts.slice(i).join(" ");
      break;
    }
  }
  if (nums.length < 3) return null;
  return {
    x: nums[0],
    y: nums[1],
    blur: nums[2],
    spread: nums.length >= 4 ? nums[3] : 0,
    color: colorPart || "rgba(0,0,0,0.1)",
    inset: inset,
  };
}

module.exports = { extractDesignSystem };
