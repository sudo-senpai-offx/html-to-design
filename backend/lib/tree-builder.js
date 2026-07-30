function hasZeroArea(el) {
  return el.w <= 0 || el.h <= 0;
}

function contains(outer, inner) {
  if (hasZeroArea(outer) || hasZeroArea(inner)) return false;
  if (outer.x <= inner.x && outer.y <= inner.y &&
      outer.x + outer.w >= inner.x + inner.w &&
      outer.y + outer.h >= inner.y + inner.h) {
    return true;
  }
  var innerCx = inner.x + inner.w / 2;
  var innerCy = inner.y + inner.h / 2;
  if (innerCx >= outer.x && innerCx <= outer.x + outer.w &&
      innerCy >= outer.y && innerCy <= outer.y + outer.h) {
    var ox = Math.max(outer.x, inner.x);
    var oy = Math.max(outer.y, inner.y);
    var ow = Math.min(outer.x + outer.w, inner.x + inner.w) - ox;
    var oh = Math.min(outer.y + outer.h, inner.y + inner.h) - oy;
    if (ow > 0 && oh > 0) {
      var overlap = ow * oh;
      var innerArea = inner.w * inner.h;
      if (overlap / innerArea > 0.15) return true;
    }
    return true;
  }
  return false;
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
  if (!flatElements || flatElements.length === 0) {
    return {
      id: -1,
      element: { tag: "__page__", x: 0, y: 0, w: pageWidth || 1440, h: pageHeight || 900, props: {}, cls: "", text: "", attrs: {}, dataAttrs: {} },
      children: [],
    };
  }

  var elements = flatElements.slice();
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

  return {
    id: -1,
    element: { tag: "__page__", x: 0, y: 0, w: pageWidth, h: pageHeight, props: {}, cls: "", text: "", attrs: {}, dataAttrs: {} },
    children: roots,
  };
}

function containsRect(ox, oy, ow, oh, inner) {
  return ox <= inner.x && oy <= inner.y && ox + ow >= inner.x + inner.w && oy + oh >= inner.y + inner.h;
}

module.exports = { buildTree };
