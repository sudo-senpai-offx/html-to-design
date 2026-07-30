var { parseColor, toHexColor } = require("./utils");

/* Fixes common issues in a .fig-style node tree */
function fixTree(tree, options) {
  var defaultBg = (options && options.defaultBackground) || "#ffffff";
  var designTokens = (options && options.designTokens) || {};
  var fixes = { applied: 0, skipped: 0, details: [] };

  function walk(node, depth) {
    if (!node || !node.element) return;
    var el = node.element;
    var p = el.props || {};

    /* Fix 1: Fill empty backgrounds with detected theme color */
    var bg = p["background-color"] || "";
    var display = p["display"] || "block";
    var hasText = el.text && el.text.length > 0;
    var isContainer = node.children && node.children.length > 0;
    var isRoot = depth === 0;

    if (display !== "none" && !bg && isRoot && isContainer) {
      p["background-color"] = defaultBg;
      fixes.applied++;
      fixes.details.push({ fix: "fill-root-bg", node: el.id, value: defaultBg });
    }

    if (display !== "none" && el.w > 0 && el.h > 0) {
      var hasVisibleFill = bg && bg !== "transparent" && bg !== "rgba(0,0,0,0)" && bg !== "initial";
      var hasBorderColor = p["border-color"] || p["border-top-color"] || p["border-bottom-color"] || p["border-left-color"] || p["border-right-color"];
      var hasBorderWidth = parseFloat(p["border-top-width"] || 0) > 0 || parseFloat(p["border-width"] || 0) > 0;

      if (!hasVisibleFill && !hasBorderColor && !hasBorderWidth && !hasText && !el.src && !isContainer) {
        fixes.skipped++;
      }
    }

    /* Fix 2: Substitute missing fonts with fallbacks */
    var fontFamily = p["font-family"] || "";
    if (fontFamily && !_isSystemFont(fontFamily)) {
      var fallback = _findFontFallback(fontFamily);
      if (fallback && fallback !== fontFamily) {
        fixes.applied++;
        fixes.details.push({ fix: "font-sub", node: el.id, from: fontFamily, to: fallback });
      }
    }

    /* Fix 3: Normalize sub-pixel dimensions to avoid Figma auto-layout issues */
    if (el.w !== undefined && el.w !== null) el.w = Math.round(el.w * 10) / 10;
    if (el.h !== undefined && el.h !== null) el.h = Math.round(el.h * 10) / 10;
    if (el.x !== undefined && el.x !== null) el.x = Math.round(el.x);
    if (el.y !== undefined && el.y !== null) el.y = Math.round(el.y);

    /* Fix 4: Clamp border-radius to available dimensions */
    var br = parseFloat(p["border-radius"] || 0);
    if (br > 0) {
      var maxBr = Math.min(el.w || 9999, el.h || 9999) / 2;
      if (br > maxBr) {
        p["border-radius"] = String(maxBr);
        fixes.applied++;
        fixes.details.push({ fix: "clamp-radius", node: el.id, from: br, to: maxBr });
      }
    }

    /* Fix 5: Inject design token names as layer labels */
    if (designTokens && Object.keys(designTokens).length > 0) {
      for (var key in designTokens) {
        var tokenVal = designTokens[key];
        if (bg && _colorSimilar(bg, tokenVal)) {
          el.name = el.name || el.tag || "";
          if (el.name.indexOf(" [" + key + "]") < 0) {
            el.name = (el.name || el.tag || "") + " [" + key + "]";
          }
          break;
        }
      }
    }

    if (node.children) {
      for (var i = 0; i < node.children.length; i++) {
        walk(node.children[i], depth + 1);
      }
    }
  }

  walk(tree, 0);
  return fixes;
}

function _isSystemFont(font) {
  var sys = ["Arial", "Helvetica", "Times New Roman", "Times", "Courier New", "Courier", "Verdana", "Georgia", "Palatino", "Garamond", "Bookman", "Trebuchet MS", "Impact", "Tahoma", "Geneva", "Segoe UI", "sans-serif", "serif", "monospace", "Inter", "Roboto", "Open Sans", "Lato", "Montserrat", "Poppins", "Nunito", "Raleway", "Ubuntu", "system-ui"];
  var fontLc = font.toLowerCase();
  for (var i = 0; i < sys.length; i++) {
    if (fontLc.indexOf(sys[i].toLowerCase()) >= 0) return true;
  }
  return false;
}

function _findFontFallback(fontFamily) {
  var map = {
    "SF Pro": "Inter",
    "SFMono": "JetBrains Mono",
    "Helvetica Neue": "Helvetica Neue",
    "Arial Unicode MS": "Arial",
    "Apple Color Emoji": "Segoe UI Emoji",
  };
  for (var key in map) {
    if (fontFamily.toLowerCase().indexOf(key.toLowerCase()) >= 0) return map[key];
  }
  return null;
}

function _colorSimilar(a, b) {
  var ca = parseColor(a);
  var cb = typeof b === "string" ? parseColor(b) : b;
  if (!ca || !cb || ca.__hex === undefined || cb.__hex === undefined) return false;
  if (ca.__hex === cb.__hex) return true;
  var dr = ca.r - cb.r, dg = ca.g - cb.g, db = ca.b - cb.b;
  return (dr * dr + dg * dg + db * db) <= 3 * 3;
}

/* Fix inlined HTML — inject missing data-rect attributes */
function fixInlinedHtml(htmlStr) {
  var fixes = { applied: 0, details: [] };
  var fixed = htmlStr;

  var rectCount = (fixed.match(/data-rect=/g) || []).length;
  var elCount = (fixed.match(/data-el-id=/g) || []).length;
  var styleCount = (fixed.match(/style=/g) || []).length;

  if (rectCount === 0 && elCount > 0) {
    fixed = fixed.replace(/<div /g, "<div data-rect=\"0,0,100,100\" ");
    fixes.applied++;
    fixes.details.push({ fix: "inject-rect", note: "Injected placeholder data-rect on all divs" });
  }

  if (styleCount === 0 && fixed.length > 500) {
    fixed = fixed.replace(/(<[a-z]+[^>]*?)(>)/g, function(m, prefix, close) {
      if (prefix.indexOf("style=\"") < 0 && prefix.indexOf("<html") < 0 && prefix.indexOf("<head") < 0 && prefix.indexOf("<meta") < 0) {
        return prefix + " style=\"display:block\" " + close;
      }
      return m;
    });
    fixes.applied++;
    fixes.details.push({ fix: "inject-style", note: "Injected placeholder display:block on unlabeled elements" });
  }

  return { fixed: fixed, fixes: fixes };
}

module.exports = { fixTree, fixInlinedHtml };
