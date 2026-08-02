function hasZeroArea(el) {
  return el.w <= 0 || el.h <= 0;
}

var { flattenStackingContexts } = require("./stacking-flattener");

/**
 * Many frameworks wrap real content in transparent <div>s purely for layout.
 * Those wrappers share an exact rect with their single child and add nothing
 * visually — in Figma they only clutter the layer panel. Drop any element that
 * (a) carries no visual weight of its own and (b) exactly overlaps another
 * element that does.
 */
function deduplicateWrappers(elements) {
  if (!elements || elements.length < 2) return elements;

  function hasVisualWeight(el) {
    var p = (el && el.props) || {};
    var bg = p["background-color"] || "";
    var bgImage = p["background-image"] || "";
    var transparent = bg === "transparent" || bg === "" || /rgba\(0,\s*0,\s*0,\s*0(?:\.0+)?\)/.test(bg);
    var hasBorder =
      (parseFloat(p["border-top-width"]) || 0) > 0 ||
      (parseFloat(p["border-bottom-width"]) || 0) > 0 ||
      (parseFloat(p["border-left-width"]) || 0) > 0 ||
      (parseFloat(p["border-right-width"]) || 0) > 0;
    var hasText = !!(el.text && el.text.length > 0);
    var hasMedia = !!(el.src || el.bgImage || el.svgPaths || (el.attrs && el.attrs.fill && el.attrs.fill !== "none"));
    return hasText || hasMedia || (!transparent && bg !== "") || !!bgImage || hasBorder;
  }

  function sameRect(a, b) {
    return Math.abs((a.x || 0) - (b.x || 0)) < 1 &&
           Math.abs((a.y || 0) - (b.y || 0)) < 1 &&
           Math.abs((a.w || 0) - (b.w || 0)) < 1 &&
           Math.abs((a.h || 0) - (b.h || 0)) < 1;
  }

  var dropIds = {};
  for (var i = 0; i < elements.length; i++) {
    var el = elements[i];
    if (!el || el.id === undefined || dropIds[el.id] || hasVisualWeight(el)) continue;
    for (var j = 0; j < elements.length; j++) {
      if (i === j) continue;
      var other = elements[j];
      if (!other || other.id === el.id) continue;
      if (sameRect(el, other) && hasVisualWeight(other)) {
        dropIds[el.id] = true;
        break;
      }
    }
  }
  return elements.filter(function(e) { return !dropIds[e.id]; });
}

function contains(outer, inner) {
  var outerArea = outer.w * outer.h;
  var innerArea = inner.w * inner.h;
  if (outerArea === 0 || innerArea === 0) return false;

  var centerX = inner.x + inner.w / 2;
  var centerY = inner.y + inner.h / 2;
  var centerInside = centerX >= outer.x && centerX <= outer.x + outer.w &&
                     centerY >= outer.y && centerY <= outer.y + outer.h;

  var overlapX = Math.max(0, Math.min(outer.x + outer.w, inner.x + inner.w) - Math.max(outer.x, inner.x));
  var overlapY = Math.max(0, Math.min(outer.y + outer.h, inner.y + inner.h) - Math.max(outer.y, inner.y));
  var overlapArea = overlapX * overlapY;

  return centerInside || (overlapArea / innerArea > 0.10);
}

function area(el) {
  return el.w * el.h;
}

function buildSpatialGrid(elements, pageW, pageH) {
  var cellSize = 500;
  var cols = Math.max(1, Math.ceil(pageW / cellSize));
  var rows = Math.max(1, Math.ceil(pageH / cellSize));
  var grid = [];
  for (var i = 0; i < cols * rows; i++) grid.push([]);
  for (var ei = 0; ei < elements.length; ei++) {
    var el = elements[ei];
    var minCol = Math.max(0, Math.floor((el.x || 0) / cellSize));
    var maxCol = Math.min(cols - 1, Math.floor(((el.x || 0) + (el.w || 0)) / cellSize));
    var minRow = Math.max(0, Math.floor((el.y || 0) / cellSize));
    var maxRow = Math.min(rows - 1, Math.floor(((el.y || 0) + (el.h || 0)) / cellSize));
    for (var r = minRow; r <= maxRow; r++) {
      for (var c = minCol; c <= maxCol; c++) {
        grid[r * cols + c].push(ei);
      }
    }
  }
  return { grid: grid, cols: cols, rows: rows, cellSize: cellSize };
}

function buildTree(flatElements, pageWidth, pageHeight) {
  var deduped = deduplicateWrappers(flatElements);
  if (!deduped || deduped.length === 0) {
    return {
      id: -1,
      element: { tag: "__page__", x: 0, y: 0, w: pageWidth || 1440, h: pageHeight || 900, props: {}, cls: "", text: "", attrs: {}, dataAttrs: {} },
      children: [],
    };
  }

  var elements = deduped.slice();
  elements.sort(function(a, b) { return area(a) - area(b); });

  var spatial = buildSpatialGrid(elements, pageWidth, pageHeight);
  var grid = spatial.grid;
  var cols = spatial.cols;
  var cellSize = spatial.cellSize;

  var parentMap = {};
  for (var i = 0; i < elements.length; i++) {
    var el = elements[i];
    var bestParentId = null;
    var bestArea = Infinity;
    var bestOverlapRatio = 0;
    var bestCenterContained = false;

    var elMinCol = Math.max(0, Math.floor((el.x || 0) / cellSize));
    var elMaxCol = Math.min(cols - 1, Math.floor(((el.x || 0) + (el.w || 0)) / cellSize));
    var elMinRow = Math.max(0, Math.floor((el.y || 0) / cellSize));
    var elMaxRow = Math.min(spatial.rows - 1, Math.floor(((el.y || 0) + (el.h || 0)) / cellSize));

    var seenIds = {};
    for (var r = elMinRow; r <= elMaxRow; r++) {
      for (var c = elMinCol; c <= elMaxCol; c++) {
        var cell = grid[r * cols + c];
        for (var ci = 0; ci < cell.length; ci++) {
          var j = cell[ci];
          if (j <= i) continue;
          var candidate = elements[j];
          if (seenIds[candidate.id]) continue;
          seenIds[candidate.id] = true;

          if (contains(candidate, el)) {
            var candArea = area(candidate);
            var innerCx = el.x + el.w / 2;
            var innerCy = el.y + el.h / 2;
            var centerContained = innerCx >= candidate.x && innerCx <= candidate.x + candidate.w &&
                                  innerCy >= candidate.y && innerCy <= candidate.y + candidate.h;

            var overlapW = Math.max(0, Math.min(candidate.x + candidate.w, el.x + el.w) - Math.max(candidate.x, el.x));
            var overlapH = Math.max(0, Math.min(candidate.y + candidate.h, el.y + el.h) - Math.max(candidate.y, el.y));
            var overlapArea = overlapW * overlapH;
            var overlapRatio = el.w * el.h > 0 ? overlapArea / (el.w * el.h) : 0;

            var isBetter = false;
            if (!bestParentId) {
              isBetter = true;
            } else if (centerContained && !bestCenterContained) {
              isBetter = true;
            } else if (centerContained === bestCenterContained) {
              if (overlapRatio > bestOverlapRatio + 0.05) isBetter = true;
              else if (Math.abs(overlapRatio - bestOverlapRatio) < 0.05 && candArea < bestArea) isBetter = true;
            }

            if (isBetter) {
              bestParentId = candidate.id;
              bestArea = candArea;
              bestOverlapRatio = overlapRatio;
              bestCenterContained = centerContained;
            }
          }
        }
      }
    }

    if (bestParentId !== null) {
      parentMap[el.id] = bestParentId;
    }
  }

  var nodeMap = {};
  for (var k = 0; k < elements.length; k++) {
    var elem = elements[k];
    nodeMap[elem.id] = { id: elem.id, element: elem, children: [] };
  }

  var roots = [];
  var added = {};
  for (var m = 0; m < elements.length; m++) {
    var el2 = elements[m];
    var node = nodeMap[el2.id];
    var pid = parentMap[el2.id];
    if (pid !== undefined && nodeMap[pid]) {
      if (!added[el2.id]) {
        nodeMap[pid].children.push(node);
        added[el2.id] = true;
      }
    } else {
      if (!added[el2.id]) {
        roots.push(node);
        added[el2.id] = true;
      }
    }
  }

  var root = {
    id: -1,
    element: { tag: "__page__", x: 0, y: 0, w: pageWidth, h: pageHeight, props: {}, cls: "", text: "", attrs: {}, dataAttrs: {} },
    children: roots,
  };

  /* Flatten stacking contexts to match Figma's flat per-frame layer model:
   * children whose z-index would conflict outside their parent are promoted. */
  flattenStackingContexts(root);

  return root;
}

function containsRect(ox, oy, ow, oh, inner) {
  return ox <= inner.x && oy <= inner.y && ox + ow >= inner.x + inner.w && oy + oh >= inner.y + inner.h;
}

module.exports = { buildTree, deduplicateWrappers };
