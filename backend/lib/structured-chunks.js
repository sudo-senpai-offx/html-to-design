var { buildConnectorInlinedHtml } = require("./clipboard-writer");

var MAX_CHUNK_SIZE = 6000;
var HARD_SINGLE_ELEMENT_LIMIT = 5000;

function calcSubtreeSize(node) {
  var el = node && node.element;
  if (!el) return 0;
  var total = 30 + (el.tag || "div").length;
  var props = el.props || {};
  for (var k in props) {
    var v = props[k];
    if (v != null && k.indexOf("-webkit-") !== 0 && k.indexOf("scroll-") !== 0 && k.indexOf("container-") !== 0 && k.indexOf("mask-") !== 0 && k.indexOf("backdrop-") !== 0 && k !== "clip-path" && k !== "shape-outside" && k !== "mix-blend-mode" && k !== "background-blend-mode" && k !== "filter") {
      total += k.length + String(v).length + 2;
    }
  }
  total += (el.text || "").length;
  total += 55;
  for (var i = 0; i < node.children.length; i++) {
    total += calcSubtreeSize(node.children[i]);
  }
  return total;
}

function sortTreeSpatially(node) {
  if (!node.children || node.children.length === 0) return;
  node.children.sort(function(a, b) {
    if (!a.element || !b.element) return 0;
    var ax = a.element.x || 0;
    var bx = b.element.x || 0;
    if (Math.abs(ax - bx) > 5) return ax - bx;
    var ay = a.element.y || 0;
    var by = b.element.y || 0;
    return ay - by;
  });
  for (var i = 0; i < node.children.length; i++) {
    sortTreeSpatially(node.children[i]);
  }
}

function flattenTree(node, out) {
  out.push(node);
  for (var i = 0; i < node.children.length; i++) {
    flattenTree(node.children[i], out);
  }
}

function collectChunks(nodes, maxSize) {
  var chunks = [];
  var currentBatch = [];
  var currentSize = 0;

  function flush() {
    if (currentBatch.length > 0) {
      chunks.push(currentBatch);
      currentBatch = [];
      currentSize = 0;
    }
  }

  for (var i = 0; i < nodes.length; i++) {
    var node = nodes[i];
    var subSize = calcSubtreeSize(node);

    if (subSize > HARD_SINGLE_ELEMENT_LIMIT && node.children.length > 0) {
      flush();
      var grandChildren = node.children;
      var subChunks = collectChunks(grandChildren, maxSize);
      for (var sc = 0; sc < subChunks.length; sc++) {
        chunks.push(subChunks[sc]);
      }
    } else if (subSize > maxSize) {
      if (currentBatch.length > 0) flush();
      chunks.push([node]);
    } else if (currentSize + subSize > maxSize && currentBatch.length > 0) {
      chunks.push(currentBatch);
      currentBatch = [node];
      currentSize = subSize;
    } else {
      currentBatch.push(node);
      currentSize += subSize;
    }
  }

  if (currentBatch.length > 0) chunks.push(currentBatch);
  return chunks;
}

function getChunkBounds(nodes) {
  var minX = 1e9, minY = 1e9, maxX = -1e9, maxY = -1e9;
  function walk(n) {
    if (!n.element) return;
    var ex = n.element.x || 0;
    var ey = n.element.y || 0;
    var ew = n.element.w || 0;
    var eh = n.element.h || 0;
    if (ex < minX) minX = ex;
    if (ey < minY) minY = ey;
    if (ex + ew > maxX) maxX = ex + ew;
    if (ey + eh > maxY) maxY = ey + eh;
    for (var i = 0; i < n.children.length; i++) walk(n.children[i]);
  }
  for (var i = 0; i < nodes.length; i++) walk(nodes[i]);
  return {
    x: minX === 1e9 ? 0 : minX,
    y: minY === 1e9 ? 0 : minY,
    w: maxX === -1e9 ? 0 : maxX - minX,
    h: maxY === -1e9 ? 0 : maxY - minY,
  };
}

function countElements(nodes) {
  var c = 0;
  function walk(n) { c++; for (var i = 0; i < n.children.length; i++) walk(n.children[i]); }
  for (var i = 0; i < nodes.length; i++) walk(nodes[i]);
  return c;
}

function buildStructuredChunks(flatElements, tree, maxChunkSize) {
  maxChunkSize = maxChunkSize || MAX_CHUNK_SIZE;

  sortTreeSpatially(tree);

  var nodeGroups = collectChunks(tree.children, maxChunkSize);

  if (nodeGroups.length === 0) {
    return [{
      html: buildConnectorInlinedHtml(flatElements, tree),
      label: "Full Page",
      bounds: { x: 0, y: 0, w: tree.element.w || 0, h: tree.element.h || 0 },
      elementCount: flatElements.length,
      index: 0,
      total: 1,
    }];
  }

  var pageW = tree.element.w || 0;
  var pageH = tree.element.h || 0;

  var chunks = [];
  for (var ci = 0; ci < nodeGroups.length; ci++) {
    var group = nodeGroups[ci];
    var bounds = getChunkBounds(group);
    var miniTree = {
      id: -1,
      element: {
        tag: "__page__",
        x: 0, y: 0, w: pageW, h: pageH,
        props: {}, cls: "", text: "", attrs: {}, dataAttrs: {},
      },
      children: group,
    };
    var html = buildConnectorInlinedHtml(flatElements, miniTree);

    if (html.length > MAX_CHUNK_SIZE + 2000) {
      var flatList = [];
      flattenTree(miniTree, flatList);
      var singleChunks = [];
      for (var si = 0; si < flatList.length; si++) {
        if (!flatList[si].element || flatList[si].element.tag === "__page__") continue;
        var singleTree = {
          id: -1,
          element: {
            tag: "__page__",
            x: 0, y: 0, w: pageW, h: pageH,
            props: {}, cls: "", text: "", attrs: {}, dataAttrs: {},
          },
          children: [flatList[si]],
        };
        var singleHtml = buildConnectorInlinedHtml(flatElements, singleTree);
        var singleBounds = getChunkBounds([flatList[si]]);
        singleChunks.push({
          html: singleHtml,
          label: "Single " + (flatList[si].element.tag || "elem") + " @ " + singleBounds.x + "," + singleBounds.y,
          bounds: singleBounds,
          elementCount: countElements([flatList[si]]),
          index: chunks.length + singleChunks.length,
          total: 0,
          size: singleHtml.length,
        });
      }
      for (var ss = 0; ss < singleChunks.length; ss++) {
        singleChunks[ss].total = chunks.length + singleChunks.length;
        chunks.push(singleChunks[ss]);
      }
    } else {
      chunks.push({
        html: html,
        label: "Chunk " + (ci + 1) + "/" + nodeGroups.length + " (" + bounds.w + "x" + bounds.h + " @ " + bounds.x + "," + bounds.y + ")",
        bounds: bounds,
        elementCount: countElements(group),
        index: ci,
        total: nodeGroups.length,
        size: html.length,
      });
    }
  }

  var total = chunks.length;
  for (var fi = 0; fi < chunks.length; fi++) {
    chunks[fi].total = total;
    chunks[fi].index = fi;
  }

  return chunks;
}

module.exports = { buildStructuredChunks, sortTreeSpatially, MAX_CHUNK_SIZE };
