const { getPool } = require("./browser-pool");
const path = require("path");

var EXTRACT_SCRIPT = `
(function() {
  var flatElements = [];
  var nextId = 0;

  function getCS(el, pseudo) {
    var cs = window.getComputedStyle(el, pseudo || null);
    var props = {};
    var len = cs.length;
    for (var i = 0; i < len; i++) {
      var name = cs[i];
      var val = cs.getPropertyValue(name);
      if (val) props[name] = val;
    }
    return props;
  }

  function extractPseudo(el, pseudo) {
    try {
      var cs = window.getComputedStyle(el, pseudo);
      var content = cs.getPropertyValue("content");
      if (!content || content === "none" || content === '""' || content === "normal") return null;
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
      var element = {
        id: nextId++,
        tag: "pseudo-" + pseudo.replace("::", ""),
        cls: "", style: "", text: text,
        x: Math.round(x), y: Math.round(y),
        w: Math.round(width), h: Math.round(height),
        props: props, attrs: {},
        placeholder: "", inputType: "", value: "", src: "", alt: "",
        href: "", dataAttrs: {},
        isVisible: true,
      };
      flatElements.push(element);
      return element;
    } catch(e) { return null; }
  }

  function getSvgPaths(el) {
    var paths = [];
    try {
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
    } catch(e) {}
    return paths;
  }

  var svgRasterList = [];
  var MAX_ELEMENTS = 25000;
  var MAX_DEPTH = 80;

  function walk(el, depth) {
    try {
      if (!el || depth > MAX_DEPTH || el.nodeType !== 1) return;
      if (flatElements.length >= MAX_ELEMENTS) return;

      var tag = el.tagName.toLowerCase();
      if (tag === "br") return;
      if (tag === "script" || tag === "style" || tag === "noscript") return;

      var rect = el.getBoundingClientRect();
      var cls = typeof el.className === "string" ? el.className : "";
      var style = el.getAttribute("style") || "";

      var text = "";
      for (var i = 0; i < el.childNodes.length; i++) {
        var n = el.childNodes[i];
        if (n.nodeType === 3 && n.textContent.trim()) {
          text += (text ? " " : "") + n.textContent.trim();
        }
      }

      var props = getCS(el);

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

      var disp = props["display"] || "block";
      var vis = props["visibility"] || "visible";
      var op = parseFloat(props["opacity"]);
      var isVisible = !(disp === "none" || vis === "hidden" || (!isNaN(op) && op < 0.01));

      var textWidth = 0;
      var textHeight = 0;
      if (text && tag !== "br" && tag !== "img" && tag !== "svg") {
        try {
          var measurer = el.ownerDocument.createElement("span");
          measurer.style.cssText = "position:absolute;visibility:hidden;white-space:nowrap;font:" + (props["font-weight"] || "400") + " " + (props["font-size"] || "16px") + "/" + (props["line-height"] || "1.4") + " " + (props["font-family"] || "sans-serif") + ";letter-spacing:" + (props["letter-spacing"] || "0") + ";";
          measurer.textContent = text;
          el.appendChild(measurer);
          var mr = measurer.getBoundingClientRect();
          textWidth = Math.round(mr.width);
          textHeight = Math.round(mr.height);
          el.removeChild(measurer);
        } catch (e) {}
      }

      var element = {
        id: nextId++,
        tag: tag, cls: cls, style: style, text: text,
        x: Math.round(rect.x), y: Math.round(rect.y),
        w: Math.round(rect.width), h: Math.round(rect.height),
        props: props, attrs: attrs,
        placeholder: el.placeholder || "",
        inputType: el.type || "",
        value: el.value || "",
        src: imgSrc, alt: el.alt || "",
        href: href, dataAttrs: dataAttrs,
        bgImage: bgImage,
        figmaName: figmaName,
        isVisible: isVisible,
        textWidth: textWidth,
        textHeight: textHeight,
      };

      if (svgRasterId >= 0) {
        element.svgRasterId = svgRasterId;
      }
      if (svgPaths.length > 0) {
        element.svgPaths = svgPaths;
      }

      flatElements.push(element);

      for (var p = 0; p < pseudos.length; p++) {
        walk_pseudo(pseudos[p]);
      }
      for (var j = 0; j < el.children.length; j++) {
        walk(el.children[j], depth + 1);
      }
    } catch(e) { /* skip broken nodes */ }
  }

  function walk_pseudo(pseudoEl) {
    if (pseudoEl) flatElements.push(pseudoEl);
  }

  walk(document.body, 0);

  return { flatElements: flatElements, svgRasterList: svgRasterList };
})()
`;

async function extractFullDOM(htmlFilePath, options) {
  var width = (options && options.width) || 1440;
  var scale = (options && options.scale) || 2;
  var cssContent = (options && options.css) || "";
  var pool = getPool();

  return pool.execute(async (page) => {
    var fileUrl = htmlFilePath.startsWith("file:")
      ? htmlFilePath
      : "file:///" + path.resolve(htmlFilePath).replace(/\\/g, "/");
    await page.setViewport({ width: width, height: 900, deviceScaleFactor: scale });
    await page.goto(fileUrl, { waitUntil: "networkidle0", timeout: 30000 });
    await page.evaluate(function() { return document.fonts && document.fonts.ready; });
    /* Inject externally-provided CSS if any, ensuring authored styles are applied */
    if (cssContent) {
      await page.addStyleTag({ content: cssContent });
      await new Promise(function(r) { setTimeout(r, 200); });
    }
    await new Promise(function(r) { setTimeout(r, 800); });

    var bodyHeight = await page.evaluate(function() { return document.body.scrollHeight || document.documentElement.scrollHeight; });
    var maxHeight = 16000;
    if (bodyHeight > maxHeight) {
      console.log("  [Extractor] Page height " + bodyHeight + "px exceeds max " + maxHeight + "px, clamping");
      bodyHeight = maxHeight;
    }
    if (bodyHeight > 900) {
      await page.setViewport({ width: width, height: bodyHeight + 100, deviceScaleFactor: scale });
      await new Promise(function(r) { setTimeout(r, 300); });
    }

    var result = await page.evaluate(EXTRACT_SCRIPT);
    var flatElements = result.flatElements;
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

    return { flatElements: flatElements, pageWidth: width, pageHeight: pageHeight, rasterizedSvgs: rasterizedSvgs };
  }, { timeout: 120000, retries: 3 });
}

module.exports = { extractFullDOM };
