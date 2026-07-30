var { parseColor } = require("./utils");

/* Validate a .fig-style node tree for completeness and consistency */
function validateTree(tree, pageW, pageH) {
  var issues = [];
  var stats = { totalNodes: 0, withFills: 0, withText: 0, withImages: 0, zeroSize: 0, noFill: 0, autoLayout: 0 };

  function walk(node, depth) {
    if (!node || !node.element) return;
    var el = node.element;
    var p = el.props || {};
    stats.totalNodes++;

    var w = el.w || 0;
    var h = el.h || 0;

    if (w <= 0 || h <= 0) {
      stats.zeroSize++;
      if (depth > 0) issues.push({ severity: "warning", node: el.id, message: "Zero-size element: " + (el.tag || "unknown") + " (" + w + "x" + h + ")" });
    }

    var bg = p["background-color"] || "";
    var display = p["display"] || "block";
    var hasText = el.text && el.text.length > 0;

    if (display !== "none" && w > 0 && h > 0) {
      var hasBg = bg && bg !== "transparent" && bg !== "rgba(0,0,0,0)";
      var isContainer = node.children && node.children.length > 0;
      var isImage = el.tag === "img";

      if (!hasBg && !isContainer && !isImage && !hasText && !el.src) {
        stats.noFill++;
        issues.push({ severity: "info", node: el.id, message: "No fill on " + (el.tag || "unknown") + " — may be invisible" });
      }

      if (hasBg) {
        var c = parseColor(bg);
        if (c && c.a < 0.01) issues.push({ severity: "info", node: el.id, message: "Fully transparent background on " + (el.tag || "unknown") });
        stats.withFills++;
      }

      if (hasText) stats.withText++;

      if (el.src) stats.withImages++;

      var flexDir = p["flex-direction"] || "";
      var displayVal = p["display"] || "";
      if (displayVal === "flex" || displayVal === "grid" || (flexDir && node.children && node.children.length >= 2)) {
        stats.autoLayout++;
      }
    }

    if (node.children) {
      for (var i = 0; i < node.children.length; i++) {
        walk(node.children[i], depth + 1);
      }
    }
  }

  walk(tree, 0);

  var completeness = _scoreCompleteness(stats, pageW, pageH);

  return { issues: issues, stats: stats, completeness: completeness };
}

function _scoreCompleteness(stats, pageW, pageH) {
  var score = 100;

  if (stats.zeroSize > stats.totalNodes * 0.1) score -= 15;
  else if (stats.zeroSize > 0) score -= 5;

  if (stats.noFill > stats.totalNodes * 0.3) score -= 10;
  else if (stats.noFill > stats.totalNodes * 0.1) score -= 3;

  if (stats.totalNodes === 0) score = 0;
  if (!pageW || !pageH || pageW <= 0 || pageH <= 0) score -= 10;

  return Math.max(0, Math.min(100, score));
}

/* Validate an inlined HTML string for completeness */
function validateInlinedHtml(htmlStr) {
  var issues = [];
  var styleCount = (htmlStr.match(/style="/g) || []).length;
  var rectCount = (htmlStr.match(/data-rect=/g) || []).length;
  var tagCount = (htmlStr.match(/<\w+/g) || []).length;

  if (styleCount === 0 && tagCount > 5) {
    issues.push({ severity: "error", message: "No inline styles found — may be missing computed style extraction" });
  }

  if (rectCount === 0 && tagCount > 5) {
    issues.push({ severity: "warning", message: "No data-rect attributes — fig-kiwi positioning will be missing" });
  }

  if (tagCount < 3) {
    issues.push({ severity: "error", message: "Very few HTML elements — page may be empty" });
  }

  return { issues: issues, stats: { styleCount: styleCount, rectCount: rectCount, tagCount: tagCount } };
}

/* Validate a clipboard payload */
function validateClipboard(payload) {
  var issues = [];
  if (!payload || payload.length === 0) {
    issues.push({ severity: "error", message: "Empty clipboard payload" });
    return { issues: issues, valid: false };
  }

  var htmlMarker = payload.indexOf("Version:0.9");
  var startHtml = payload.indexOf("StartHTML:");
  var endHtml = payload.indexOf("EndHTML:");
  var hasFigmaFrag = payload.indexOf("data-figma") >= 0 || payload.indexOf("data-rect") >= 0;

  if (startHtml < 0 || endHtml < 0) {
    issues.push({ severity: "warning", message: "Clipboard missing standard HTML format markers" });
  }
  if (!hasFigmaFrag) {
    issues.push({ severity: "info", message: "No figma-specific markers — may use generic format" });
  }

  return { issues: issues, valid: issues.length === 0 || issues.every(function(i) { return i.severity !== "error"; }) };
}

/* Cross-validate source HTML vs generated output */
function crossValidate(sourceHtml, elements, tree) {
  var issues = [];
  var sourceTagCount = (sourceHtml.match(/<\w+/g) || []).length;
  var elementCount = elements ? elements.length : 0;
  var treeNodeCount = 0;

  function countNodes(n) {
    treeNodeCount++;
    for (var i = 0; i < (n.children || []).length; i++) countNodes(n.children[i]);
  }
  if (tree) countNodes(tree);

  var ratio = sourceTagCount > 0 ? elementCount / sourceTagCount : 0;
  if (ratio < 0.3 && sourceTagCount > 10) {
    issues.push({ severity: "warning", message: "Element loss: extracted " + elementCount + "/" + sourceTagCount + " elements (" + Math.round(ratio * 100) + "%)" });
  } else if (ratio < 0.6 && sourceTagCount > 20) {
    issues.push({ severity: "info", message: "Partial element extraction: " + elementCount + "/" + sourceTagCount + " elements (" + Math.round(ratio * 100) + "%)" });
  }

  var treeRatio = elementCount > 0 ? treeNodeCount / elementCount : 0;
  if (treeRatio < 0.5 && elementCount > 10) {
    issues.push({ severity: "warning", message: "Tree flattening: " + treeNodeCount + " nodes in tree vs " + elementCount + " flat elements" });
  }

  return { issues: issues, stats: { sourceTags: sourceTagCount, flatElements: elementCount, treeNodes: treeNodeCount, ratio: ratio } };
}

module.exports = { validateTree, validateInlinedHtml, validateClipboard, crossValidate };
