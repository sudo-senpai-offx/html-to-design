var cssInliner = require("./css-inliner");

var MAX_CHUNK_SIZE = 18000;

function buildConnectorHtml(originalHtml, pageWidth, pageHeight) {
  if (!originalHtml || originalHtml.trim().length === 0) return originalHtml;
  var single = buildConnectorChunks(originalHtml, pageWidth, pageHeight, 999999999);
  return single[0];
}

function extractCssVars(html) {
  var vars = {};
  var rootMatch = html.match(/:root\s*\{([^}]+)\}/);
  if (rootMatch) {
    var rootBlock = rootMatch[1];
    var varMatches = rootBlock.matchAll(/--([\w-]+)\s*:\s*([^;]+);/g);
    for (var m of varMatches) {
      vars["--" + m[1]] = m[2].trim();
    }
  }
  return vars;
}

var VOID_TAGS = ["br","hr","img","input","meta","link","area","base","col","embed","source","track","wbr"];

function parseTopLevel(bodyHtml) {
  var elements = [];
  var re = /<\/?([a-zA-Z][\w-]*)([^>]*)>/g;
  var lastEnd = 0;
  var stack = [];
  var elementStart = -1;
  var match;

  function flushText(upTo) {
    var text = bodyHtml.substring(lastEnd, upTo).trim();
    if (text) elements.push({ type: "text", content: text });
    lastEnd = upTo;
  }

  while ((match = re.exec(bodyHtml)) !== null) {
    var fullTag = match[0];
    var tagName = match[1].toLowerCase();
    var isClose = fullTag.indexOf("</") === 0;
    var isVoid = VOID_TAGS.indexOf(tagName) >= 0;
    var isSelfClosing = fullTag.lastIndexOf("/") === fullTag.length - 2 && !isClose;

    if (isClose) {
      if (stack.length > 0 && stack[stack.length - 1] === tagName) {
        stack.pop();
        if (stack.length === 0) {
          var endIdx = match.index + fullTag.length;
          if (elementStart >= 0) {
            flushText(elementStart);
            elements.push({ type: "element", content: bodyHtml.substring(elementStart, endIdx), tag: tagName });
            lastEnd = endIdx;
            elementStart = -1;
          }
        }
      }
    } else if (isVoid || isSelfClosing) {
      if (stack.length === 0) {
        flushText(match.index);
        elements.push({ type: "element", content: fullTag, tag: tagName });
        lastEnd = match.index + fullTag.length;
      }
    } else {
      if (stack.length === 0) elementStart = match.index;
      stack.push(tagName);
    }
  }

  var remaining = bodyHtml.substring(lastEnd).trim();
  if (remaining) elements.push({ type: "text", content: remaining });

  return elements;
}

function splitAndWrap(largeElementHtml, tagName, threshold) {
  var openEnd = largeElementHtml.indexOf(">");
  if (openEnd < 0) return [largeElementHtml];
  var openTag = largeElementHtml.substring(0, openEnd + 1);
  var closeTag = "</" + tagName + ">";
  var closeIdx = largeElementHtml.lastIndexOf(closeTag);
  var inner = closeIdx >= 0 ? largeElementHtml.substring(openEnd + 1, closeIdx) : largeElementHtml.substring(openEnd + 1);

  var children = parseTopLevel(inner);
  var flatItems = [];
  for (var i = 0; i < children.length; i++) {
    if (children[i].type !== "element") continue;
    if (children[i].content.length > threshold) {
      var sub = splitAndWrap(children[i].content, children[i].tag, threshold);
      for (var s = 0; s < sub.length; s++) flatItems.push(sub[s]);
    } else {
      flatItems.push(children[i].content);
    }
  }

  if (flatItems.length === 0) return [largeElementHtml];

  var groups = [];
  var current = "";
  var overhead = openTag.length + closeTag.length;
  var effectiveChildThreshold = threshold - overhead;

  for (var f = 0; f < flatItems.length; f++) {
    var item = flatItems[f];
    if (current.length > 0 && current.length + item.length > effectiveChildThreshold) {
      groups.push(openTag + current + closeTag);
      current = "";
    }
    current += item;
  }
  if (current.length > 0) groups.push(openTag + current + closeTag);

  return groups;
}

function buildConnectorChunks(originalHtml, pageWidth, pageHeight, maxChunkSize) {
  if (!originalHtml || originalHtml.trim().length === 0) return [originalHtml];
  var html = originalHtml;

  html = html.replace(/<link\s+[^>]*rel=["']stylesheet["'][^>]*>/gi, "");

  var cssVars = extractCssVars(html);

  html = cssInliner.inlineCssStyles(html);

  var rootDeclarations = [];
  for (var vn in cssVars) {
    rootDeclarations.push(vn + ":" + cssVars[vn] + ";");
  }
  var rootStyle = rootDeclarations.length > 0 ? "<style>:root{" + rootDeclarations.join("") + "}</style>" : "";

  if (!html.match(/<body[^>]*style/i)) {
    html = html.replace(/<body([^>]*)>/, '<body style="margin:0;padding:0"$1>');
  }

  html = minifyHtml(html);

  var threshold = maxChunkSize || MAX_CHUNK_SIZE;
  var fullHtml;
  if (html.match(/<html/i)) {
    fullHtml = rootStyle ? html.replace("</head>", rootStyle + "</head>") : html;
  } else {
    fullHtml = wrapHtml(html, rootStyle);
  }

  if (fullHtml.length <= threshold) {
    var varsCount = Object.keys(cssVars).length;
    var inlineCount = (html.match(/style="/g) || []).length;
    console.log("  [ConnectorHtml] Output: " + fullHtml.length + "B (" + (fullHtml.length / 1024).toFixed(1) + "KB), " + varsCount + " CSS vars, " + inlineCount + " inline styles");
    return [fullHtml];
  }

  var headStyleMatch = html.match(/<head[^>]*>([\s\S]*?)<\/head>/i);
  var headStyles = headStyleMatch ? (headStyleMatch[1].match(/<style[^>]*>[\s\S]*?<\/style>/gi) || []).join("") : "";
  var bodyMatch = html.match(/<body[^>]*>([\s\S]*)<\/body>/i);
  var bodyContent = bodyMatch ? bodyMatch[1].trim() : html;
  var chunkHead = rootStyle + headStyles;

  var topLevel = parseTopLevel(bodyContent);
  var items = [];
  for (var t = 0; t < topLevel.length; t++) {
    if (topLevel[t].type !== "element") continue;
    if (topLevel[t].content.length > threshold) {
      var split = splitAndWrap(topLevel[t].content, topLevel[t].tag, threshold);
      for (var sp = 0; sp < split.length; sp++) items.push(split[sp]);
    } else {
      items.push(topLevel[t].content);
    }
  }

  if (items.length === 0) {
    items = ["<div>" + bodyContent + "</div>"];
  }

  var chunks = [];
  var current = "";
  var overhead = chunkHead.length + "<!DOCTYPE html><html><head></head><body></body></html>".length;
  var effectiveThreshold = threshold - overhead;

  for (var e = 0; e < items.length; e++) {
    if (current.length > 0 && current.length + items[e].length > effectiveThreshold) {
      chunks.push(buildChunkHtml(current, chunkHead));
      current = "";
    }
    current += items[e];
  }
  if (current.length > 0) chunks.push(buildChunkHtml(current, chunkHead));

  if (chunks.length === 0) chunks.push(buildChunkHtml("", chunkHead));

  console.log("  [ConnectorHtml] Split " + items.length + " element-groups into " + chunks.length + " chunks (" + chunks[0].length + "B to " + chunks[chunks.length - 1].length + "B, max=" + threshold + "B)");
  return chunks;
}

function buildChunkHtml(bodyContent, headContent) {
  return "<!DOCTYPE html><html><head>" + (headContent || "") + "</head><body>" + bodyContent + "</body></html>";
}

function wrapHtml(bodyContent, headContent) {
  return "<!DOCTYPE html><html><head>" + (headContent || "") + "</head><body>" + bodyContent + "</body></html>";
}

function minifyHtml(html) {
  html = html.replace(/<!--[\s\S]*?-->/g, "");
  html = html.replace(/\/\*[\s\S]*?\*\//g, "");
  html = html.replace(/\n\s*\n/g, "\n");
  html = html.replace(/\n/g, " ");
  html = html.replace(/>\s+</g, "><");
  html = html.replace(/\s{2,}/g, " ");
  html = html.replace(/\s([a-zA-Z][\w-]*)=/g, " $1=");
  return html.trim();
}

module.exports = { buildConnectorHtml: buildConnectorHtml, buildConnectorChunks: buildConnectorChunks };