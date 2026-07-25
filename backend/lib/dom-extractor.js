const { getPool } = require("./browser-pool");
const path = require("path");

var EXTRACT_SCRIPT = `
(function() {
  function getCS(el, pseudo) {
    var cs = window.getComputedStyle(el, pseudo || null);
    var props = {};
    var important = [
      "display","visibility","opacity","position","z-index",
      "top","right","bottom","left","inset",
      "background-color","background","background-image",
      "background-size","background-position","background-repeat","background-attachment",
      "color","font-family","font-size","font-weight","font-style",
      "line-height","letter-spacing","text-align","text-decoration",
      "text-transform","text-overflow","white-space","word-wrap","word-break",
      "text-indent","vertical-align",
      "content",
      "padding-top","padding-right","padding-bottom","padding-left",
      "margin-top","margin-right","margin-bottom","margin-left",
      "border-top-width","border-right-width","border-bottom-width","border-left-width",
      "border-top-color","border-right-color","border-bottom-color","border-left-color",
      "border-top-style","border-right-style","border-bottom-style","border-left-style",
      "border-top-left-radius","border-top-right-radius",
      "border-bottom-right-radius","border-bottom-left-radius",
      "border-width","border-color","border-style","border-radius",
      "box-shadow","gap","flex-direction","flex-wrap","flex",
      "flex-basis","flex-grow","flex-shrink",
      "justify-content","align-items","align-self","align-content",
      "width","height","min-width","min-height","max-width","max-height",
      "overflow","cursor","object-fit",
      "text-shadow","transform","transform-origin",
      "translate","rotate","scale",
      "grid-template-columns","grid-template-rows","grid-column-gap","grid-row-gap",
      "grid-auto-flow","aspect-ratio",
      "outline-width","outline-color","outline-style","outline-offset",
      "filter","backdrop-filter",
      "mix-blend-mode","background-blend-mode",
      "column-gap","row-gap"
    ];
    for (var i = 0; i < important.length; i++) {
      var val = cs.getPropertyValue(important[i]);
      if (val) props[important[i]] = val;
    }
    return props;
  }

  function extractPseudo(el, pseudo) {
    var cs = window.getComputedStyle(el, pseudo);
    var content = cs.getPropertyValue("content");
    if (!content || content === "none" || content === '\\"\\"' || content === '""' || content === "normal") return null;
    var text = content.replace(/^["']|["']$/g, "");
    if (!text || text.length === 0) return null;

    var rect = el.getBoundingClientRect();
    var pseudoCs = window.getComputedStyle(el, pseudo);
    var pos = pseudoCs.position;
    var x = rect.x, y = rect.y;
    var width = parseFloat(pseudoCs.width) || rect.width;
    var height = parseFloat(pseudoCs.height) || rect.height;

    if (pos === "absolute" || pos === "fixed") {
      var top = parseFloat(pseudoCs.top) || 0;
      var left = parseFloat(pseudoCs.left) || 0;
      x = rect.x + left;
      y = rect.y + top;
      try {
        var tempEl = document.createElement("span");
        tempEl.style.cssText = "position:absolute;visibility:hidden;pointer-events:none;";
        tempEl.textContent = text;
        tempEl.style.fontFamily = pseudoCs.fontFamily;
        tempEl.style.fontSize = pseudoCs.fontSize;
        tempEl.style.fontWeight = pseudoCs.fontWeight;
        tempEl.style.fontStyle = pseudoCs.fontStyle;
        tempEl.style.letterSpacing = pseudoCs.letterSpacing;
        el.appendChild(tempEl);
        var tr = tempEl.getBoundingClientRect();
        x = tr.x;
        y = tr.y;
        width = tr.width;
        height = tr.height;
        el.removeChild(tempEl);
      } catch(e) {}
    }

    var props = getCS(el, pseudo);
    return {
      tag: "pseudo-" + pseudo.replace("::", ""),
      cls: "", style: "", text: text,
      x: Math.round(x), y: Math.round(y),
      w: Math.round(width), h: Math.round(height),
      props: props, children: [], attrs: {},
      placeholder: "", inputType: "", value: "", src: "", alt: "",
      href: "", dataAttrs: {},
    };
  }

  function findPositionedAncestor(el) {
    var current = el.parentElement;
    while (current && current !== document.body) {
      var cs = window.getComputedStyle(current);
      var pos = cs.position;
      if (pos === "relative" || pos === "absolute" || pos === "fixed" || pos === "sticky") {
        return current;
      }
      current = current.parentElement;
    }
    return document.body;
  }

  function getSvgPaths(el) {
    var paths = [];
    var svgEls = el.querySelectorAll("path, circle, rect, line, polyline, polygon, ellipse");
    for (var i = 0; i < svgEls.length; i++) {
      var s = svgEls[i];
      var d = s.getAttribute("d");
      var tag = s.tagName.toLowerCase();
      if (tag === "path" && d) {
        paths.push({ type: "path", d: d, fill: s.getAttribute("fill") || "none", stroke: s.getAttribute("stroke") || "none", strokeWidth: s.getAttribute("stroke-width") || "1" });
      } else if (tag === "circle") {
        paths.push({ type: "circle", cx: s.getAttribute("cx"), cy: s.getAttribute("cy"), r: s.getAttribute("r"), fill: s.getAttribute("fill") || "none", stroke: s.getAttribute("stroke") || "none" });
      } else if (tag === "rect") {
        paths.push({ type: "rect", x: s.getAttribute("x"), y: s.getAttribute("y"), width: s.getAttribute("width"), height: s.getAttribute("height"), fill: s.getAttribute("fill") || "none" });
      }
    }
    return paths;
  }

  var svgRasterList = [];

  function walk(el, depth) {
    if (!el || depth > 100 || el.nodeType !== 1) return null;
    var rect = el.getBoundingClientRect();
    if (rect.width < 0.3 && rect.height < 0.3) return null;

    var tag = el.tagName.toLowerCase();
    var cls = typeof el.className === "string" ? el.className : "";
    var style = el.getAttribute("style") || "";

    var display = el.style.display || window.getComputedStyle(el).display;
    if (display === "none") return null;
    var visibility = window.getComputedStyle(el).visibility;
    if (visibility === "hidden") return null;
    var opacity = parseFloat(window.getComputedStyle(el).opacity);
    if (!isNaN(opacity) && opacity < 0.01) return null;

    if (tag === "br") return null;
    if (tag === "script" || tag === "style" || tag === "noscript") return null;

    var text = "";
    for (var i = 0; i < el.childNodes.length; i++) {
      var n = el.childNodes[i];
      if (n.nodeType === 3 && n.textContent.trim()) {
        text += (text ? " " : "") + n.textContent.trim();
      }
    }

    var props = getCS(el);

    var pos = props["position"] || "static";
    var isPositioned = pos === "absolute" || pos === "fixed";
    var posAncestor = null;
    var posAncestorRect = null;
    if (isPositioned) {
      posAncestor = findPositionedAncestor(el);
      posAncestorRect = posAncestor ? posAncestor.getBoundingClientRect() : null;
    }

    var svgPaths = [];
    var svgRasterId = -1;
    if (tag === "svg" && el.querySelector) {
      svgPaths = getSvgPaths(el);
      var svgRect = el.getBoundingClientRect();
      if (svgRect.width > 0 && svgRect.height > 0) {
        var svgHtml = el.outerHTML;
        if (!svgHtml.match(/xmlns\\s*=/)) {
          svgHtml = svgHtml.replace(/<svg/, '<svg xmlns="http://www.w3.org/2000/svg"');
        }
        var resolvedColor = window.getComputedStyle(el).color || "rgb(0,0,0)";
        svgHtml = svgHtml.replace(/currentColor/g, resolvedColor);
        svgRasterId = svgRasterList.length;
        svgRasterList.push({
          html: svgHtml,
          width: Math.round(svgRect.width),
          height: Math.round(svgRect.height),
          currentColor: resolvedColor,
        });
      }
    }

    var pseudos = [];
    var beforeNode = extractPseudo(el, "::before");
    if (beforeNode) pseudos.push(beforeNode);
    var afterNode = extractPseudo(el, "::after");
    if (afterNode) pseudos.push(afterNode);

    var attrs = {};
    if (tag === "svg" || tag === "path" || tag === "circle" || tag === "rect" ||
        tag === "line" || tag === "polyline" || tag === "polygon" || tag === "ellipse") {
      for (var a = 0; a < el.attributes.length; a++) {
        attrs[el.attributes[a].name] = el.attributes[a].value;
      }
    }

    var dataAttrs = {};
    for (var d = 0; d < el.attributes.length; d++) {
      if (el.attributes[d].name.startsWith("data-")) {
        dataAttrs[el.attributes[d].name] = el.attributes[d].value;
      }
    }

    var imgSrc = "";
    if (tag === "img") {
      imgSrc = el.currentSrc || el.src || "";
    }

    var bgImage = "";
    var bgCS = props["background-image"];
    if (bgCS && bgCS !== "none") {
      var urlMatch = bgCS.match(/url\\(["']?([^"')]+)["']?\\)/);
      if (urlMatch) bgImage = urlMatch[1];
    }

    var href = "";
    if (tag === "a") {
      href = el.href || "";
    }

    var figmaName = el.getAttribute("data-figma-name") || "";

    var children = [];
    for (var p = 0; p < pseudos.length; p++) {
      children.push(pseudos[p]);
    }
    for (var j = 0; j < el.children.length; j++) {
      var child = walk(el.children[j], depth + 1);
      if (child) children.push(child);
    }

    var node = {
      tag: tag, cls: cls, style: style, text: text,
      x: Math.round(rect.x), y: Math.round(rect.y),
      w: Math.round(rect.width), h: Math.round(rect.height),
      props: props, children: children, attrs: attrs,
      placeholder: el.placeholder || "",
      inputType: el.type || "",
      value: el.value || "",
      src: imgSrc, alt: el.alt || "",
      href: href, dataAttrs: dataAttrs,
      bgImage: bgImage,
      figmaName: figmaName,
    };

    if (isPositioned && posAncestorRect) {
      node.positionedAncestor = {
        x: Math.round(posAncestorRect.x),
        y: Math.round(posAncestorRect.y),
        w: Math.round(posAncestorRect.width),
        h: Math.round(posAncestorRect.height),
      };
    }

    if (svgRasterId >= 0) {
      node.svgRasterId = svgRasterId;
    }
    if (svgPaths.length > 0) {
      node.svgPaths = svgPaths;
    }

    return node;
  }

  var domTree = walk(document.body, 0);

  return { domTree: domTree, svgRasterList: svgRasterList };
})()
`;

async function extractFullDOM(htmlFilePath, options) {
  var width = (options && options.width) || 1440;
  var scale = (options && options.scale) || 2;
  var pool = getPool();

  return pool.execute(async (page) => {
    await page.setViewport({ width: width, height: 900, deviceScaleFactor: scale });
    var fileUrl = htmlFilePath.startsWith("file:")
      ? htmlFilePath
      : "file:///" + path.resolve(htmlFilePath).replace(/\\/g, "/");
    await page.goto(fileUrl, { waitUntil: "networkidle0", timeout: 30000 });
    await page.evaluate(function() { return document.fonts && document.fonts.ready; });
    await new Promise(function(r) { setTimeout(r, 800); });

    var result = await page.evaluate(EXTRACT_SCRIPT);
    var domTree = result.domTree;
    var svgRasterList = result.svgRasterList || [];
    var pageHeight = await page.evaluate(function() { return document.documentElement.scrollHeight; });

    var rasterizedSvgs = [];
    if (svgRasterList.length > 0) {
      rasterizedSvgs = await page.evaluate(function(svs) {
        return Promise.all(svs.map(function(sv) {
          return new Promise(function(resolve) {
            try {
              var canvas = document.createElement("canvas");
              var dpr = 2;
              canvas.width = sv.width * dpr;
              canvas.height = sv.height * dpr;
              var ctx = canvas.getContext("2d");
              var img = new Image();
              img.onload = function() {
                ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
                var dataUri = canvas.toDataURL("image/png");
                resolve(dataUri.split(",")[1]);
              };
              img.onerror = function() { resolve(null); };
              var encoded = btoa(unescape(encodeURIComponent(sv.html)));
              img.src = "data:image/svg+xml;base64," + encoded;
            } catch(e) { resolve(null); }
          });
        }));
      }, svgRasterList);
    }

    return { domTree: domTree, pageWidth: width, pageHeight: pageHeight, rasterizedSvgs: rasterizedSvgs };
  });
}

module.exports = { extractFullDOM };
