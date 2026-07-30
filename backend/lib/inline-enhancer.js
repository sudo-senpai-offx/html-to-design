/* Enhanced inline style generator — includes ALL computed styles from dom-extractor output */

/* Legacy reference — kept for backward compat metadata (not used for filtering) */
var ALL_STYLE_PROPS = [
  "display","visibility","opacity","position","z-index","inset",
  "top","right","bottom","left","float","clear",
  "background-color","background","background-image","background-size","background-position","background-repeat","background-attachment","background-blend-mode",
  "color","font-family","font-size","font-weight","font-style","font-variant","font-stretch",
  "line-height","letter-spacing","text-align","text-decoration","text-transform","text-overflow","white-space",
  "word-wrap","word-break","text-indent","vertical-align","text-shadow","word-spacing",
  "padding-top","padding-right","padding-bottom","padding-left",
  "margin-top","margin-right","margin-bottom","margin-left",
  "border-top-width","border-right-width","border-bottom-width","border-left-width","border-width",
  "border-top-color","border-right-color","border-bottom-color","border-left-color","border-color",
  "border-top-style","border-right-style","border-bottom-style","border-left-style","border-style",
  "border-top-left-radius","border-top-right-radius","border-bottom-right-radius","border-bottom-left-radius","border-radius",
  "box-shadow",
  "overflow","overflow-x","overflow-y",
  "width","height","min-width","min-height","max-width","max-height","aspect-ratio",
  "box-sizing","object-fit","object-position",
  "flex-direction","flex-wrap","flex","flex-basis","flex-grow","flex-shrink",
  "justify-content","align-items","align-self","align-content","gap","order","isolation",
  "grid-template-columns","grid-template-rows","grid-column-gap","grid-row-gap",
  "grid-auto-flow","grid-auto-columns","grid-auto-rows",
  "grid-column-start","grid-column-end","grid-row-start","grid-row-end",
  "column-gap","row-gap",
  "transform","transform-origin","translate","rotate","scale",
  "outline-width","outline-color","outline-style","outline-offset",
  "filter","backdrop-filter","mix-blend-mode","clip-path","shape-outside",
  "mask-image","mask-size","mask-position","mask-repeat",
  "list-style-type","list-style-position","list-style-image",
  "caption-side","border-collapse","border-spacing","table-layout","empty-cells",
  "writing-mode","text-orientation","direction","unicode-bidi",
  "image-rendering","cursor","pointer-events","touch-action",
  "container-type","container-name",
  "scroll-margin-top","scroll-margin-right","scroll-margin-bottom","scroll-margin-left",
  "scroll-padding-top","scroll-padding-right","scroll-padding-bottom","scroll-padding-left",
  "content","-webkit-line-clamp","-webkit-box-orient",
  "will-change","contain",
];

function escapeAttr(str) {
  return String(str == null ? "" : str).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/* Include ALL props as inline style — no whitelist, no default-value filtering */
function buildEnhancedStyle(props) {
  if (!props || typeof props !== "object") return "";
  var parts = [];
  for (var key in props) {
    var v = props[key];
    if (v == null || v === "") continue;
    parts.push(key + ":" + v);
  }
  if (parts.length === 0) return "";
  return parts.join(";");
}

function buildEnhancedHtml(flatElements, tree, options) {
  var enableDebugIds = !(options && options.skipDebugIds);
  var htmlParts = [];

  function walkNode(treeNode) {
    var el = treeNode.element;
    if (!el) return;
    var tag = el.tag;
    if (tag === "__page__" || tag === "pseudo-before" || tag === "pseudo-after") {
      for (var i = 0; i < treeNode.children.length; i++) {
        walkNode(treeNode.children[i]);
      }
      return;
    }

    var props = el.props || {};
    var style = buildEnhancedStyle(props);
    var id = el.id || "";
    var rect = (el.x || 0) + "," + (el.y || 0) + "," + (el.w || 0) + "," + (el.h || 0);

    var attrs = ' style="' + escapeAttr(style) + '"';
    attrs += ' data-rect="' + rect + '"';
    if (enableDebugIds && id) attrs += ' data-el-id="' + escapeAttr(id) + '"';
    if (el.cls) attrs += ' class="' + escapeAttr(el.cls) + '"';
    if (el.href) attrs += ' href="' + escapeAttr(el.href) + '"';

    var isVoid = ["img","input","br","hr","area","base","col","embed","link","meta","param","source","track","wbr"].indexOf(tag) >= 0;

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

  walkNode(tree);
  return '<!DOCTYPE html><html><head><meta charset="utf-8"></head><body>' + htmlParts.join("") + '</body></html>';
}

/* Report style inclusion stats — always 100% now */
function diagnoseStyleLoss(props) {
  if (!props) return { total: 0, included: 0, lost: [] };
  var total = 0;
  var included = 0;
  for (var key in props) {
    total++;
    var v = props[key];
    if (v != null && v !== "") included++;
  }
  return { total: total, included: included, lost: [] };
}

module.exports = { buildEnhancedStyle, buildEnhancedHtml, diagnoseStyleLoss, ALL_STYLE_PROPS };
