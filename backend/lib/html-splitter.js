var juice = require("juice").default || require("juice");
var { JSDOM } = require("jsdom");

var DEFAULT_MAX_BYTES = 100 * 1024;

/* Tags and selectors that define semantic section boundaries */
var SECTION_TAGS = { "HEADER": 1, "NAV": 1, "MAIN": 1, "SECTION": 1, "ARTICLE": 1, "ASIDE": 1, "FOOTER": 1 };

/* Section-indicating class/id patterns */
var SECTION_PATTERNS = [
  /^header/i, /^nav/i, /^hero/i, /^banner/i, /^feature/i, /^section-/i,
  /^about/i, /^service/i, /^product/i, /^portfolio/i, /^gallery/i,
  /^blog/i, /^post/i, /^article/i, /^testimonial/i, /^review/i,
  /^team/i, /^pricing/i, /^faq/i, /^contact/i, /^cta/i, /^newsletter/i,
  /^subscribe/i, /^footer/i, /^sidebar/i, /^widget/i, /^content-/i,
  /^row-/i, /^col-/i, /^group-/i, /^wrap/i, /^container/i,
];

/* Low-importance tags that should merge into adjacent sections */
var MERGE_TAGS = { "SCRIPT": 1, "STYLE": 1, "NOSCRIPT": 1, "LINK": 1, "META": 1, "TITLE": 1, "HEAD": 1 };

function encode(str) {
  return Buffer.byteLength(str, "utf-8");
}

/*
 * Split source HTML+CSS into ≤maxBytes chunks with CSS already inlined into element style attributes.
 * Uses semantic DOM-based chunking: each major section (header, hero, section, footer, etc.)
 * becomes its own labeled chunk. Byte-size enforcement splits oversized sections further.
 */
function splitAndInlineHtml(html, css, maxBytes) {
  maxBytes = maxBytes || DEFAULT_MAX_BYTES;

  /* 1. Ensure full document with CSS injected */
  var docHtml = ensureFullDocument(html, css);

  /* 2. Juice-inline all CSS into element style attributes */
  var inlined;
  try {
    inlined = juice(docHtml, {
      applyWidthAttributes: true,
      applyHeightAttributes: true,
      removeStyleTags: true,
      preserveImportant: true,
      extraCss: css || "",
      resolveCSSVariables: true,
      preserveFontFaces: true,
      preserveMediaQueries: true,
      preserveKeyFrames: true,
      preservePseudos: true,
      inlinePseudoElements: true,
    });
  } catch (e) {
    console.error("[html-splitter] juice failed:", e.message);
    inlined = docHtml;
  }

  /* 3. Parse the inlined HTML */
  var dom = new JSDOM(inlined);
  var doc = dom.window.document;
  var body = doc.body;

  /* 4. Collect non-inlinable extras (@font-face, @keyframes, :root variables) from original CSS */
  var extraStyles = extractNonInlinableCss(css || extractCssFromDoc(doc));

  /* 5. Find the best split level — walk down past single wrappers */
  var splitRoot = findSplitRoot(body);

  /* 6. Build chunk template */
  var chunkHead = "<!DOCTYPE html>\n<html lang=\"en\">\n<head>\n<meta charset=\"UTF-8\">\n<meta name=\"viewport\" content=\"width=device-width, initial-scale=1.0\">\n";
  if (extraStyles.trim()) {
    chunkHead += "<style>\n" + extraStyles + "\n</style>\n";
  }
  chunkHead += "</head>\n<body>\n";
  var chunkTail = "\n</body>\n</html>";
  var headSize = encode(chunkHead);
  var tailSize = encode(chunkTail);

  /* 7. Collect direct children of split root, merging non-semantic interstitial nodes */
  var sections = collectSections(splitRoot);

  /* 8. Build chunks from semantic sections */
  var chunks = [];
  var chunkIndex = 0;

  function flushChunk(nodes, forcedLabel) {
    if (!nodes || nodes.length === 0) return;
    var html = chunkHead;
    for (var ni = 0; ni < nodes.length; ni++) {
      html += serializeNode(nodes[ni]);
    }
    html += chunkTail;
    var size = encode(html);
    var label = forcedLabel || deriveLabel(nodes);
    chunks.push({
      html: html,
      index: chunkIndex++,
      size: size,
      label: label,
      elementCount: nodes.length,
    });
  }

  function deriveLabel(nodes) {
    if (nodes.length === 1) {
      return nodeLabel(nodes[0]);
    }
    for (var ni = 0; ni < nodes.length; ni++) {
      var lbl = nodeLabel(nodes[ni]);
      if (lbl !== nodes[ni].tagName.toLowerCase()) return "group-" + lbl;
    }
    return "section-" + (chunkIndex + 1);
  }

  /* 9. Process each section — each section is one chunk unless oversized */
  for (var si = 0; si < sections.length; si++) {
    var sec = sections[si];
    var secHtml = serializeNode(sec.node);
    var secSize = encode(secHtml);
    var totalSize = secSize + headSize + tailSize;

    if (totalSize <= maxBytes) {
      /* Section fits as one chunk */
      flushChunk([sec.node], sec.label);
    } else {
      /* Section is oversized — try splitting its direct children into sub-chunks */
      var subChunks = splitOversizedSection(sec.node, sec.label, maxBytes, headSize, tailSize);
      for (var sci = 0; sci < subChunks.length; sci++) {
        var sc = subChunks[sci];
        flushChunk(sc.nodes, sc.label);
      }
    }
  }

  /* 10. If nothing was chunked, return full HTML as single chunk */
  if (chunks.length === 0) {
    var fullHtml = chunkHead;
    for (var cj = 0; cj < sections.length; cj++) {
      fullHtml += serializeNode(sections[cj].node);
    }
    fullHtml += chunkTail;
    chunks.push({
      html: fullHtml,
      index: 0,
      size: encode(fullHtml),
      label: "full-page",
      elementCount: sections.length,
    });
  }

  /* 11. Cache HTML for writer access */
  for (var ck = 0; ck < chunks.length; ck++) {
    chunks[ck]._html = chunks[ck].html;
  }

  console.log("  [html-splitter] " + chunks.length + " chunk(s), split root: " + (splitRoot === body ? "body" : (splitRoot.tagName + (splitRoot.id ? "#" + splitRoot.id : ""))));
  if (chunks.length <= 10) {
    for (var ci = 0; ci < chunks.length; ci++) {
      console.log("    [" + ci + "] " + chunks[ci].label + " — " + (chunks[ci].size / 1024).toFixed(1) + "KB");
    }
  }
  return chunks;
}

function nodeLabel(el) {
  if (!el) return "unknown";
  if (el.id) return el.id;
  if (el.className && typeof el.className === "string") {
    var cls = el.className.trim().split(/\s+/)[0];
    if (cls) return cls;
  }
  return el.tagName.toLowerCase();
}

function isSemanticElement(el) {
  if (!el || el.nodeType !== 1) return false;
  var tag = el.tagName.toUpperCase();
  if (SECTION_TAGS[tag]) return true;
  if (el.id && SECTION_PATTERNS.some(function(p) { return p.test(el.id); })) return true;
  if (el.className && typeof el.className === "string") {
    var classes = el.className.trim().split(/\s+/);
    for (var ci = 0; ci < classes.length; ci++) {
      if (SECTION_PATTERNS.some(function(p) { return p.test(classes[ci]); })) return true;
    }
  }
  return false;
}

/*
 * Collect direct children of root, identifying semantic sections.
 * Adjacent non-semantic elements are merged into the nearest section.
 * Returns [{ node: Element, label: String, isSemantic: Boolean }]
 */
function collectSections(root) {
  var children = [];
  for (var ci = 0; ci < root.children.length; ci++) {
    children.push(root.children[ci]);
  }

  if (children.length === 0) {
    /* No direct children — treat root as one section */
    return [{ node: root, label: nodeLabel(root), isSemantic: isSemanticElement(root) }];
  }

  var sections = [];

  for (var ci = 0; ci < children.length; ci++) {
    var el = children[ci];
    var sem = isSemanticElement(el);

    if (sem) {
      /* Start a new section */
      sections.push({ node: el, label: nodeLabel(el), isSemantic: true });
    } else if (sections.length > 0) {
      /* Non-semantic element — merge into last section if possible */
      var last = sections[sections.length - 1];
      /* Check if merging would exceed max bytes (soft — sections will be split later if needed) */
      last.additional = last.additional || [];
      last.additional.push(el);
    } else {
      /* First element(s) before any semantic section — group as "intro" */
      sections.push({ node: el, label: "intro", isSemantic: false, additional: [] });
    }
  }

  /* Resolve merged groups — if a section has `additional` nodes, wrap them with the primary node */
  var resolved = [];
  for (var si = 0; si < sections.length; si++) {
    var sec = sections[si];
    if (sec.additional && sec.additional.length > 0) {
      /* Wrap primary + additional into a document fragment for chunking */
      var wrapper = root.ownerDocument.createElement("div");
      wrapper.appendChild(sec.node.cloneNode(true));
      for (var ai = 0; ai < sec.additional.length; ai++) {
        wrapper.appendChild(sec.additional[ai].cloneNode(true));
      }
      resolved.push({ node: wrapper, label: sec.label + "-group", isSemantic: sec.isSemantic });
    } else {
      resolved.push({ node: sec.node, label: sec.label, isSemantic: sec.isSemantic });
    }
  }

  return resolved;
}

/*
 * Split an oversized section into ≤maxBytes sub-chunks.
 * Attempts semantic splitting first (grandchildren), then byte-size greedy.
 */
function splitOversizedSection(sectionEl, sectionLabel, maxBytes, headSize, tailSize) {
  var children = [];
  for (var ci = 0; ci < sectionEl.children.length; ci++) {
    children.push(sectionEl.children[ci]);
  }

  if (children.length === 0) {
    /* Leaf section that's oversized — return as-is (oversized chunk) */
    return [{ nodes: [sectionEl], label: sectionLabel + "-oversized" }];
  }

  /* Greedy byte-size packing — no semantic re-checking at this level */
  var subSections = [];
  var currentGroup = [];
  var currentSize = 0;

  for (var ci = 0; ci < children.length; ci++) {
    var el = children[ci];
    var elHtml = serializeNode(el);
    var elSize = encode(elHtml);
    var standaloneSize = elSize + headSize + tailSize;

    if (standaloneSize > maxBytes && el.children.length > 0) {
      if (currentGroup.length > 0) {
        subSections.push({ nodes: currentGroup, label: sectionLabel + "-part" });
        currentGroup = [];
        currentSize = 0;
      }
      var deeper = splitOversizedSection(el, sectionLabel + "-" + nodeLabel(el), maxBytes, headSize, tailSize);
      for (var di = 0; di < deeper.length; di++) {
        subSections.push(deeper[di]);
      }
      continue;
    }

    if (currentSize + elSize + headSize + tailSize > maxBytes && currentGroup.length > 0) {
      subSections.push({ nodes: currentGroup, label: sectionLabel + "-part" });
      currentGroup = [];
      currentSize = 0;
    }

    currentGroup.push(el);
    currentSize += elSize;
  }

  if (currentGroup.length > 0) {
    subSections.push({ nodes: currentGroup, label: sectionLabel + "-part" });
  }

  if (subSections.length > 1) {
    for (var si = 0; si < subSections.length; si++) {
      subSections[si].label = sectionLabel + "-" + (si + 1);
    }
  }

  return subSections.length > 0 ? subSections : [{ nodes: [sectionEl], label: sectionLabel + "-oversized" }];
}

function findSplitRoot(body) {
  var current = body;
  var maxDepth = 10;
  var depth = 0;
  while (depth < maxDepth) {
    if (current.children.length >= 2) return current;
    if (current.children.length === 0) return current;
    var onlyChild = current.children[0];
    if (!onlyChild || onlyChild.nodeType !== 1) return current;
    var tag = onlyChild.tagName.toUpperCase();
    if (tag === "DIV" || tag === "SECTION" || tag === "MAIN" || tag === "ARTICLE" || tag === "ASIDE" || tag === "NAV") {
      current = onlyChild;
      depth++;
    } else {
      return current;
    }
  }
  return current;
}

function extractNonInlinableCss(cssText) {
  if (!cssText) return "";
  var parts = [];
  /* @font-face */
  var fontFaceMatches = cssText.match(/@font-face\s*\{[^}]+\}/gi);
  if (fontFaceMatches) parts.push(fontFaceMatches.join("\n"));
  /* @keyframes */
  var keyframesMatches = cssText.match(/@keyframes\s+[^{]+\{[^}]+\}[^}]*\}/gi);
  if (keyframesMatches) parts.push(keyframesMatches.join("\n"));
  /* :root variables */
  var rootMatches = cssText.match(/:root\s*\{[^}]+\}/gi);
  if (rootMatches) parts.push(rootMatches.join("\n"));
  /* @media — keep all */
  var mediaMatches = cssText.match(/@media[^{]+\{[\s\S]*?[^}]\}/gi);
  if (mediaMatches) parts.push(mediaMatches.join("\n"));
  return parts.join("\n");
}

function extractCssFromDoc(doc) {
  var css = "";
  var styles = doc.querySelectorAll("style");
  for (var si = 0; si < styles.length; si++) {
    css += styles[si].textContent + "\n";
  }
  return css;
}

function ensureFullDocument(html, css) {
  if (html.indexOf("<!DOCTYPE") >= 0 || html.indexOf("<html") >= 0) {
    if (css && html.indexOf("<style>") < 0 && html.indexOf("<style ") < 0) {
      html = html.replace("</head>", "<style>\n" + css + "\n</style>\n</head>");
    }
    return html;
  }
  var headStyle = css ? "<style>\n" + css + "\n</style>\n" : "";
  return "<!DOCTYPE html>\n<html lang=\"en\">\n<head>\n<meta charset=\"UTF-8\">\n<meta name=\"viewport\" content=\"width=device-width, initial-scale=1.0\">\n" + headStyle + "</head>\n<body>\n" + html + "\n</body>\n</html>";
}

function serializeNode(node) {
  if (node.nodeType === 3) return node.textContent;
  if (node.nodeType !== 1) return "";
  return node.outerHTML;
}

module.exports = { splitAndInlineHtml: splitAndInlineHtml, DEFAULT_MAX_BYTES: DEFAULT_MAX_BYTES };
