/* Splits inlined HTML into labeled batches under a size limit (default 100KB) */

var DEFAULT_MAX_BYTES = 100 * 1024; /* 100KB */
var MAX_ELEMENTS_PER_PAGE = 100000; /* safety cap */

function encode(str) {
  return Buffer.byteLength(str, "utf-8");
}

/* Estimate element nesting depth based on its tree position */
function estimateDepth(treeNode, depth) {
  if (!treeNode) return 0;
  depth = depth || 0;
  var maxChildDepth = 0;
  if (treeNode.children) {
    for (var i = 0; i < treeNode.children.length; i++) {
      var cd = estimateDepth(treeNode.children[i], depth + 1);
      if (cd > maxChildDepth) maxChildDepth = cd;
    }
  }
  return depth + maxChildDepth;
}

/* 
 * Split a tree into sequential batches.
 * Each batch is a subtree that fits within maxBytes when serialized.
 * Strategy: breadth-first grouping — sibling elements that fit together stay together.
 */
function buildBatches(tree, maxBytes, batchLabelPrefix, options) {
  maxBytes = maxBytes || DEFAULT_MAX_BYTES;
  batchLabelPrefix = batchLabelPrefix || "Batch";
  options = options || {};
  var writeBatch = options.writeBatch || null; /* async fn(batchIndex, label, filename, html) called when each batch is finalized */

  if (!tree || !tree.element) {
    return [];
  }

  var batches = [];
  var currentBatch = { elements: [], label: "", size: 0, elementCount: 0 };
  var batchIndex = 0;

  /* Calculate serialized size of a single element tree */
  function estimateElementSize(treeNode) {
    if (!treeNode || !treeNode.element) return 50;
    var el = treeNode.element;
    var size = 50;

    var tag = el.tag || "div";
    size += tag.length * 2;

    var props = el.props || {};
    for (var key in props) {
      if (props[key]) size += key.length + String(props[key]).length + 4;
    }

    if (el.text) size += el.text.length * 2;
    if (el.id) size += el.id.length;
    if (el.src) size += Math.min(el.src.length, 500); /* images truncated estimate */
    if (el.cls) size += el.cls.length;

    if (treeNode.children) {
      for (var i = 0; i < treeNode.children.length; i++) {
        size += estimateElementSize(treeNode.children[i]);
      }
    }

    return size;
  }

  function nextBatch() {
    if (currentBatch.elements.length > 0) {
      batchIndex++;
      currentBatch.elementCount = currentBatch.elements.length;
      /* Cache serialized HTML — avoids re-serialization during post-processing */
      currentBatch._html = serializeBatch(currentBatch.elements);
      currentBatch.size = encode(currentBatch._html);
      /* writeBatch not called here — filename unknown until post-processing */
      batches.push(currentBatch);
    }
    currentBatch = { elements: [], label: "", size: 0, elementCount: 0 };
  }

  function canFit(size) {
    return currentBatch.size + size <= maxBytes;
  }

  function addToBatch(treeNode) {
    currentBatch.elements.push(treeNode);
    currentBatch.size += estimateElementSize(treeNode);
  }

  /* ---- BATCHING STRATEGY ---- */
  /* Flatten tree into a list of elements with depth tracking for sort */
  var allNodes = [];

  function flattenNode(treeNode, depth) {
    if (!treeNode || !treeNode.element) return;
    var tag = treeNode.element.tag;
    if (tag === "__page__" || tag === "pseudo-before" || tag === "pseudo-after") {
      if (treeNode.children) {
        for (var i = 0; i < treeNode.children.length; i++) {
          flattenNode(treeNode.children[i], depth);
        }
      }
      return;
    }
    treeNode._depth = depth;
    allNodes.push(treeNode);
  }

  flattenNode(tree, 0);

  /* Sort: top→bottom (Y primary), outer→inner (depth secondary), left→right (X tertiary) */
  allNodes.sort(function(a, b) {
    var aEl = a.element, bEl = b.element;
    var ay = aEl ? (aEl.y || 0) : 0;
    var by = bEl ? (bEl.y || 0) : 0;
    if (Math.abs(ay - by) < 5) {
      /* Same row — outer→inner by depth, then left→right by X */
      var aDepth = a._depth || 0;
      var bDepth = b._depth || 0;
      if (aDepth !== bDepth) return aDepth - bDepth;
      var ax = aEl ? (aEl.x || 0) : 0;
      var bx = bEl ? (bEl.x || 0) : 0;
      return ax - bx;
    }
    return ay - by;
  });

  /* Visual CSS properties that should be preserved on children when a parent is split */
  var VISUAL_PARENT_PROPS = {
    "background": true,
    "background-color": true,
    "background-image": true,
    "border-radius": true,
    "border-top-left-radius": true,
    "border-top-right-radius": true,
    "border-bottom-right-radius": true,
    "border-bottom-left-radius": true,
    "box-shadow": true,
    "border": true,
    "border-color": true,
    "border-width": true,
    "border-style": true,
    "outline": true,
    "outline-color": true,
    "outline-width": true,
    "outline-style": true,
  };

  /* Recursive pack: fit elements into ≤maxBytes batches.
   * If a single node exceeds maxBytes, descend into its children and pack them individually.
   * Preserves parent visual properties (background, border-radius, etc.) on children
   * via data-parent-visual attribute so the Figma plugin can reconstruct parent frames.
   */
  function packNode(treeNode, parentVisualProps) {
    if (!treeNode || !treeNode.element) return;
    var nodeSize = estimateElementSize(treeNode);

    /* Single node exceeds limit — split by children */
    if (nodeSize > maxBytes) {
      var children = treeNode.children || [];
      if (children.length > 0) {
        if (currentBatch.elements.length > 0) nextBatch();

        /* Capture this node's visual props to pass to children */
        var el = treeNode.element;
        var childVisualProps = parentVisualProps ? Object.assign({}, parentVisualProps) : {};
        if (el.props) {
          for (var vpk in VISUAL_PARENT_PROPS) {
            if (el.props[vpk]) childVisualProps[vpk] = el.props[vpk];
          }
        }

        for (var ci = 0; ci < children.length; ci++) {
          packNode(children[ci], childVisualProps);
        }
        return;
      }
      /* Leaf oversized — mark with warning */
      if (currentBatch.elements.length > 0) nextBatch();
      addToBatch(treeNode);
      return;
    }

    /* Attach parent visual props as data-parent-visual on the element */
    if (parentVisualProps) {
      var visualParts = [];
      for (var vk in parentVisualProps) {
        if (parentVisualProps[vk]) visualParts.push(vk + ":" + parentVisualProps[vk]);
      }
      if (visualParts.length > 0) {
        treeNode.element._parentVisual = visualParts.join(";");
      }
    }

    /* Node fits within limit — normal greedy pack */
    if (currentBatch.elements.length > 0 && currentBatch.size + nodeSize > maxBytes) {
      nextBatch();
    }
    addToBatch(treeNode);
  }

  for (var ni = 0; ni < allNodes.length; ni++) {
    packNode(allNodes[ni], null);
  }

  if (currentBatch.elements.length > 0) {
    nextBatch();
  }

  /* ---------- DERIVE SECTION NAME FROM BATCH ---------- */
  function deriveSectionName(elements) {
    if (!elements || elements.length === 0) return "empty";
    var tagCounts = {};
    var keywordCounts = {};
    var texts = [];
    var totalW = 0;

    var hintKeywords = ["header", "nav", "hero", "banner", "section", "content", "main", "sidebar", "aside", "footer", "card", "list", "grid", "form", "modal", "popup", "toolbar", "menu", "tab", "table", "chart", "widget", "panel", "container", "wrapper", "article", "post", "comment", "author", "meta", "title", "heading", "subtitle", "description", "cta", "button", "link", "image", "video", "icon", "avatar", "badge", "tag", "search", "filter", "sort", "pagination", "breadcrumb", "carousel", "slider", "accordion", "tabs", "plan", "product", "service", "team", "testimonial", "pricing", "contact", "slide", "row", "column", "feature", "benefit", "highlight", "stat", "counter", "gallery", "portfolio", "project", "status", "alert", "message", "notification", "tooltip", "item"];

    for (var ei = 0; ei < elements.length; ei++) {
      var el = elements[ei].element || {};
      var tag = el.tag || "div";
      tagCounts[tag] = (tagCounts[tag] || 0) + 1;
      if (el.cls) {
        var parts = el.cls.split(/\s+/);
        for (var pi = 0; pi < parts.length; pi++) {
          if (!parts[pi]) continue;
          for (var hi = 0; hi < hintKeywords.length; hi++) {
            if (parts[pi].toLowerCase().indexOf(hintKeywords[hi]) >= 0) {
              keywordCounts[hintKeywords[hi]] = (keywordCounts[hintKeywords[hi]] || 0) + 1;
            }
          }
        }
      }
      if (el.text && el.text.length > 3 && el.text.length < 40) {
        texts.push(el.text.trim().substring(0, 30));
      }
      totalW += el.w || 0;
    }

    /* Pick the most common keyword hint */
    var hint = "";
    var maxCount = 0;
    for (var kw in keywordCounts) {
      if (keywordCounts[kw] > maxCount) {
        maxCount = keywordCounts[kw];
        hint = kw;
      }
    }

    /* Compute Y range */
    var minY = Infinity, maxY = -Infinity, minX = Infinity;
    for (var ei2 = 0; ei2 < elements.length; ei2++) {
      var el2 = elements[ei2].element || {};
      if ((el2.y || 0) < minY) minY = el2.y || 0;
      if ((el2.y || 0) + (el2.h || 0) > maxY) maxY = (el2.y || 0) + (el2.h || 0);
      if ((el2.x || 0) < minX) minX = el2.x || 0;
    }
    if (minY === Infinity) minY = 0;
    if (maxY === -Infinity) maxY = 0;

    var sectionName = hint || "section";
    if (texts.length > 0 && hint === "section") {
      sectionName = texts[0].toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").substring(0, 24) || "section";
    }

    return { name: sectionName, yStart: minY, yEnd: maxY, xStart: minX };
  }

  /* Re-label with position-derived names and write each batch once */
  var total = batches.length;
  for (var b = 0; b < batches.length; b++) {
    var sectionInfo = deriveSectionName(batches[b].elements);
    batches[b].sectionName = sectionInfo.name;
    batches[b].yStart = sectionInfo.yStart;
    batches[b].yEnd = sectionInfo.yEnd;
    batches[b].xStart = sectionInfo.xStart;
    batches[b].totalBatches = total;
    batches[b].index = b;
    var yPos = "y" + sectionInfo.yStart;
    /* Use cached _html from nextBatch — no re-serialization needed */
    if (batches[b]._html) {
      batches[b].size = encode(batches[b]._html);
    } else {
      batches[b]._html = serializeBatch(batches[b].elements);
      batches[b].size = encode(batches[b]._html);
    }
    batches[b].filename = yPos + "-" + sectionInfo.name + "-chunk-" + (b + 1) + "-of-" + total + ".html";
    batches[b].label = yPos + " " + sectionInfo.name + " (" + (b + 1) + "/" + total + ")";
    /* Single writeBatch call — guaranteed correct filename */
    if (writeBatch && batches[b]._html) {
      try {
        writeBatch(b + 1, batches[b].label, batches[b].filename, batches[b]._html);
        batches[b]._written = true;
      } catch (e) {
        console.error("[html-batcher] writeBatch error:", e.message);
      }
    }
    if (batches[b].size > maxBytes) {
      batches[b].oversized = true;
      batches[b].oversizeBy = batches[b].size - maxBytes;
    }
  }

  return batches;
}

function escapeAttr(v) {
  return String(v == null ? "" : v).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function serializeBatch(elements) {
  if (!elements || elements.length === 0) return "";
  var parts = [];
  for (var i = 0; i < elements.length; i++) {
    serializeNode(elements[i], parts);
  }
  return '<!DOCTYPE html><html><head><meta charset="utf-8"></head><body>' + parts.join("") + '</body></html>';
}

function serializeNode(treeNode, parts) {
  if (!treeNode || !treeNode.element) return;
  var el = treeNode.element;
  var tag = el.tag;
  if (tag === "__page__" || tag === "pseudo-before" || tag === "pseudo-after") {
    if (treeNode.children) {
      for (var i = 0; i < treeNode.children.length; i++) {
        serializeNode(treeNode.children[i], parts);
      }
    }
    return;
  }

  var style = "";
  var props = el.props || {};
  var styleParts = [];
  for (var key in props) {
    if (props[key]) styleParts.push(key + ":" + props[key]);
  }
  if (styleParts.length > 0) style = ' style="' + escapeAttr(styleParts.join(";")) + '"';

  var rect = (el.x || 0) + "," + (el.y || 0) + "," + (el.w || 0) + "," + (el.h || 0);
  var attrs = style + ' data-rect="' + rect + '"';
  if (el.id) attrs += ' data-el-id="' + escapeAttr(el.id) + '"';
  if (el.cls) attrs += ' class="' + escapeAttr(el.cls) + '"';
  if (el._parentVisual) attrs += ' data-parent-visual="' + escapeAttr(el._parentVisual) + '"';

  var isVoid = ["img","input","br","hr"].indexOf(tag) >= 0;
  if (isVoid) {
    parts.push('<' + tag + attrs + '>');
    return;
  }

  parts.push('<' + tag + attrs + '>');
  var hasText = el.text && el.text.length > 0;
  var hasChildren = treeNode.children && treeNode.children.length > 0;

  if (hasText && !hasChildren) {
    parts.push(escapeAttr(el.text));
  } else {
    if (hasChildren) {
      for (var ci = 0; ci < treeNode.children.length; ci++) {
        serializeNode(treeNode.children[ci], parts);
      }
    }
    if (hasText && hasChildren) {
      parts.push(escapeAttr(el.text));
    }
  }
  parts.push('</' + tag + '>');
}

/* Serialize all batches with batch-info headers for manual reconstruction */
function serializeBatchesManifest(batches, sourceInfo) {
  var totalSize = 0;
  var parts = [];
  parts.push("HTM-to-Design Batch Manifest");
  parts.push("========================================");
  parts.push("Source: " + (sourceInfo || "N/A"));
  parts.push("Total batches: " + batches.length);
  parts.push("Max per batch: " + (DEFAULT_MAX_BYTES / 1024).toFixed(0) + "KB");
  parts.push("");
  parts.push("Import order (top-to-bottom by Y position):");
  parts.push("");

  for (var i = 0; i < batches.length; i++) {
    var b = batches[i];
    totalSize += b.size;
    parts.push("  " + (i + 1) + ". " + b.filename);
    parts.push("     Label: " + b.label);
    parts.push("     Position: Y " + b.yStart + "\u2013" + b.yEnd + ", X " + b.xStart);
    parts.push("     Size: " + (b.size / 1024).toFixed(1) + "KB | Elements: " + (b.elements ? b.elements.length : 0));
    if (b.oversized) {
      parts.push("     WARNING: Oversized by " + (b.oversizeBy / 1024).toFixed(1) + "KB");
    }
    parts.push("");
  }

  parts.push("Total size: " + (totalSize / 1024).toFixed(1) + "KB");
  parts.push("");
  parts.push("Instructions:");
  parts.push("  1. Copy the FULL HTML content of each batch file (including DOCTYPE)");
  parts.push("  2. Open the HTM-to-Design Figma plugin");
  parts.push("  3. Paste each batch into the plugin\u2019s import dialog");
  parts.push("  4. Import in the numbered order above \u2014 each batch creates frames positioned by data-rect");
  parts.push("  5. Batches are named by Y-position and section type for easy identification");
  parts.push("");

  return parts.join("\n");
}

module.exports = { buildBatches, serializeBatchesManifest, serializeBatch, DEFAULT_MAX_BYTES, MAX_ELEMENTS_PER_PAGE };
