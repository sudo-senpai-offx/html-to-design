const { JSDOM } = require("jsdom");

var _lib = null;
function getLib() {
  if (!_lib) {
    _lib = require("@magicpatterns/html-to-figma");
  }
  return _lib;
}

function escapeAttr(str) {
  return String(str == null ? "" : str).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

var STYLE_PROPS = []; /* kept for backward compat — buildInlineStyle now iterates all props */
var ALL_STYLE_PROPS_OLD = [
  "display","visibility","opacity","position","z-index",
  "top","right","bottom","left",
  "background-color","background-image","background-size","background-repeat",
  "color","font-family","font-size","font-weight","font-style",
  "line-height","letter-spacing","text-align","text-decoration",
  "text-transform","text-overflow","white-space",
  "padding-top","padding-right","padding-bottom","padding-left",
  "margin-top","margin-right","margin-bottom","margin-left",
  "border-top-width","border-right-width","border-bottom-width","border-left-width",
  "border-top-color","border-right-color","border-bottom-color","border-left-color",
  "border-top-style","border-right-style","border-bottom-style","border-left-style",
  "border-top-left-radius","border-top-right-radius","border-bottom-right-radius","border-bottom-left-radius",
  "box-shadow","gap","flex-direction","flex-wrap",
  "flex-basis","flex-grow","flex-shrink",
  "justify-content","align-items","align-self","align-content",
  "width","height","min-width","min-height","max-width","max-height",
  "overflow","object-fit",
  "transform","transform-origin",
  "grid-template-columns","grid-template-rows","column-gap","row-gap",
  "outline-width","outline-color","outline-style","outline-offset",
  "word-spacing","content",
];

function buildInlineStyle(props) {
  var parts = [];
  for (var key in props) {
    var v = props[key];
    if (v) parts.push(key + ":" + v);
  }
  if (parts.length === 0) return "";
  return parts.join(";");
}

function buildInlinedHtml(flatElements, tree) {
  var htmlParts = [];
  htmlParts.push('<meta charset="utf-8">');

  function walkNode(treeNode) {
    var el = treeNode.element;
    if (!el) return;
    var tag = el.tag;
    if (tag === "__page__") {
      for (var i = 0; i < treeNode.children.length; i++) {
        walkNode(treeNode.children[i]);
      }
      return;
    }

    if (tag === "pseudo-before" || tag === "pseudo-after") {
      var pText = el.text || "";
      if (pText.length === 0) return;
      var pProps = el.props || {};
      var pStyle = buildInlineStyle(pProps);
      var pRect = el.x + "," + el.y + "," + el.w + "," + el.h;
      htmlParts.push('<span data-rect="' + pRect + '" style="' + escapeAttr(pStyle) + '">' + escapeAttr(pText) + '</span>');
      return;
    }

    var props = el.props || {};
    var style = buildInlineStyle(props);
    var rect = el.x + "," + el.y + "," + el.w + "," + el.h;
    var attrs = ' data-rect="' + rect + '" style="' + escapeAttr(style) + '"';
    if (el.cls) attrs += ' class="' + escapeAttr(el.cls) + '"';
    if (el.href) attrs += ' href="' + escapeAttr(el.href) + '"';

    var isVoid = ["img", "input", "br", "hr", "area", "base", "col", "embed", "link", "meta", "param", "source", "track", "wbr"].indexOf(tag) >= 0;

    if (isVoid) {
      if (tag === "img" && el.src) {
        htmlParts.push('<img' + attrs + ' src="' + escapeAttr(el.src) + '" alt="' + escapeAttr(el.alt || '') + '">');
      } else {
        htmlParts.push('<' + tag + attrs + '>');
      }
      return;
    }

    var hasChildElements = treeNode.children.length > 0;
    var hasText = el.text && el.text.length > 0;

    if (tag === "svg") {
      var svgAttrs = "";
      if (el.attrs) {
        for (var k in el.attrs) {
          svgAttrs += " " + k + '="' + escapeAttr(el.attrs[k]) + '"';
        }
      }
      htmlParts.push('<svg' + attrs + svgAttrs + '>');
      for (var si = 0; si < treeNode.children.length; si++) {
        walkSvgNode(treeNode.children[si]);
      }
      htmlParts.push('</svg>');
      return;
    }

    if (tag === "img" && el.src) {
      attrs += ' src="' + escapeAttr(el.src) + '" alt="' + escapeAttr(el.alt || '') + '"';
    }

    htmlParts.push('<' + tag + attrs + '>');

    if (hasText && !hasChildElements) {
      htmlParts.push(escapeAttr(el.text));
    } else {
      for (var ci = 0; ci < treeNode.children.length; ci++) {
        walkNode(treeNode.children[ci]);
      }
      if (hasText && hasChildElements) {
        htmlParts.push(escapeAttr(el.text));
      }
    }

    htmlParts.push('</' + tag + '>');
  }

  function walkSvgNode(treeNode) {
    var el = treeNode.element;
    if (!el) return;
    var tag = el.tag;
    var attrs = "";
    if (el.attrs) {
      for (var k in el.attrs) {
        attrs += " " + k + '="' + escapeAttr(el.attrs[k]) + '"';
      }
    }
    htmlParts.push('<' + tag + attrs + '>');
    if (el.text) htmlParts.push(escapeAttr(el.text));
    for (var ci = 0; ci < treeNode.children.length; ci++) {
      walkSvgNode(treeNode.children[ci]);
    }
    htmlParts.push('</' + tag + '>');
  }

  walkNode(tree);
  return '<!DOCTYPE html><html><head><meta charset="utf-8"></head><body>' + htmlParts.join("") + '</body></html>';
}

/* Connector style builder — iterates all props but skips complex/web-only properties */
var CONNECTOR_SKIP_PREFIXES = ["-webkit-", "scroll-margin", "scroll-padding", "container-", "mask-", "backdrop-filter", "clip-path", "shape-outside", "mix-blend-mode", "background-blend-mode", "filter"];

function buildConnectorStyle(props) {
  var parts = [];
  for (var key in props) {
    var v = props[key];
    if (!v) continue;
    var shouldSkip = false;
    for (var s = 0; s < CONNECTOR_SKIP_PREFIXES.length; s++) {
      if (key.indexOf(CONNECTOR_SKIP_PREFIXES[s]) === 0) { shouldSkip = true; break; }
    }
    if (shouldSkip) continue;
    var entry = key + ":" + v;
    if (parts.indexOf(entry) >= 0) continue;
    parts.push(entry);
  }
  if (parts.length === 0) return "";
  return parts.join(";");
}

function buildConnectorInlinedHtml(flatElements, tree) {
  var htmlParts = [];
  htmlParts.push('<meta charset="utf-8">');

  function inheritProps(childProps, parentProps) {
    var inherited = ["color", "font-family", "font-size", "font-weight", "font-style", "line-height", "text-align", "letter-spacing", "visibility"];
    for (var i = 0; i < inherited.length; i++) {
      var p = inherited[i];
      if (!childProps[p] && parentProps[p]) {
        childProps[p] = parentProps[p];
      }
    }
    return childProps;
  }

  function walkNode(treeNode, inheritedProps) {
    var el = treeNode.element;
    if (!el) return;
    var tag = el.tag;
    if (tag === "__page__") {
      for (var i = 0; i < treeNode.children.length; i++) {
        walkNode(treeNode.children[i], inheritedProps);
      }
      return;
    }

    var props = el.props || {};
    props = inheritProps(props, inheritedProps || {});

    if (tag === "pseudo-before" || tag === "pseudo-after") {
      var pText = el.text || "";
      if (pText.length === 0) return;
      var pStyle = buildConnectorStyle(props);
      var pRect = el.x + "," + el.y + "," + el.w + "," + el.h;
      htmlParts.push('<span data-rect="' + pRect + '" style="' + escapeAttr(pStyle) + '">' + escapeAttr(pText) + '</span>');
      return;
    }

    var style = buildConnectorStyle(props);
    var rect = el.x + "," + el.y + "," + el.w + "," + el.h;
    var attrs = ' data-rect="' + rect + '" style="' + escapeAttr(style) + '"';
    if (el.href) attrs += ' href="' + escapeAttr(el.href) + '"';

    var isVoid = ["img", "input", "br", "hr", "area", "base", "col", "embed", "link", "meta", "param", "source", "track", "wbr"].indexOf(tag) >= 0;

    if (isVoid) {
      if (tag === "img" && el.src) {
        htmlParts.push('<img' + attrs + ' src="' + escapeAttr(el.src) + '" alt="' + escapeAttr(el.alt || '') + '">');
      } else {
        htmlParts.push('<' + tag + attrs + '>');
      }
      return;
    }

    htmlParts.push('<' + tag + attrs + '>');
    var hasText = el.text && el.text.length > 0;
    var hasChildElements = treeNode.children.length > 0;
    if (hasText && !hasChildElements && tag !== "svg") {
      htmlParts.push(escapeAttr(el.text));
    } else {
      for (var ci = 0; ci < treeNode.children.length; ci++) {
        walkNode(treeNode.children[ci], props);
      }
      if (hasText && hasChildElements) {
        htmlParts.push(escapeAttr(el.text));
      }
    }
    htmlParts.push('</' + tag + '>');
  }

  walkNode(tree, null);
  return '<!DOCTYPE html><html><head><meta charset="utf-8"></head><body>' + htmlParts.join("") + '</body></html>';
}

async function convertToClipboard(flatElements, tree, pageWidth, pageHeight, options) {
  console.log("  Building fig-kiwi clipboard payload...");
  var lib = getLib();
  var pageName = (options && options.pageName) || "HTML Export";
  var dom = new JSDOM('<!DOCTYPE html><html><body></body></html>');
  var doc = dom.window.document;
  var pw = pageWidth || 1440;
  var ph = pageHeight || 900;
  var root = doc.createElement("div");
  root.setAttribute("data-rect", "0,0," + pw + "," + ph);
  root.style.width = pw + "px";
  root.style.height = ph + "px";
  root.style.position = "relative";
  doc.body.appendChild(root);

  function buildDom(treeNode, parentEl) {
    var el = treeNode.element;
    if (!el) return;
    if (el.tag === "__page__") {
      for (var i = 0; i < treeNode.children.length; i++) {
        buildDom(treeNode.children[i], parentEl);
      }
      return;
    }
    var domEl = doc.createElement(el.tag || "div");
    domEl.setAttribute("data-rect", (el.x || 0) + "," + (el.y || 0) + "," + (el.w || 0) + "," + (el.h || 0));
    if (el.text) domEl.textContent = el.text;
    if (el.cls) domEl.className = el.cls;
    if (el.href) domEl.setAttribute("href", el.href);
    if (el.props) {
      for (var k in el.props) {
        try { domEl.style[k] = el.props[k]; } catch(e) {}
      }
    }
    if (el.attrs) {
      for (var a in el.attrs) {
        domEl.setAttribute(a, el.attrs[a]);
      }
    }
    parentEl.appendChild(domEl);
    for (var ci = 0; ci < treeNode.children.length; ci++) {
      buildDom(treeNode.children[ci], domEl);
    }
  }

  buildDom(tree, root);

  var timedOut = false;
  var timer = setTimeout(function() { timedOut = true; }, 30000);
  return lib.generateFromElement(root, {
    topLayerName: pageName,
    pasteID: Math.floor(Math.random() * 2147483647),
  }).then(function(result) {
    clearTimeout(timer);
    if (timedOut) throw new Error("Clipboard generation timed out after 30s");
    console.log("  Clipboard payload: " + (result.length / 1024).toFixed(1) + "KB");
    return result;
  }).catch(function(err) {
    clearTimeout(timer);
    throw err;
  });
}

var convertToClipboardSync = convertToClipboard;

module.exports = { convertToClipboard, convertToClipboardSync, buildInlinedHtml, buildConnectorInlinedHtml };
