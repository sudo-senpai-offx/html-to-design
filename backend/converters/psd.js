const archiver = require("archiver");
const { Readable } = require("stream");
const { getPool } = require("../lib/browser-pool");

function collectLayers(el, offsetX, offsetY, depth, layers) {
  if (!el) return;
  var props = el.props || {};
  var x = (el.x || 0) + offsetX;
  var y = (el.y || 0) + offsetY;
  var w = el.w || 0;
  var h = el.h || 0;

  if (w < 1 || h < 1) return;

  var display = props["display"] || "block";
  var visibility = props["visibility"] || "visible";
  var opacity = parseFloat(props["opacity"]);
  if (display === "none" || visibility === "hidden") return;
  if (!isNaN(opacity) && opacity < 0.01) return;

  var hasText = el.text && el.text.length > 0;
  var bgColor = props["background-color"];
  var hasBg = bgColor && bgColor !== "transparent";
  var borderRadius = parseFloat(props["border-radius"]) || 0;
  var hasBorder = (parseFloat(props["border-top-width"]) || 0) > 0;
  var isImage = el.tag === "img" && el.src;

  if (hasBg || hasBorder || isImage || (hasText && w > 5)) {
    var name = el.cls ? el.cls.split(" ")[0] : el.tag || ("layer_" + depth);
    name = name.substring(0, 60);
    var label = "";
    if (hasText) label = " [\"text\"]";

    layers.push({
      name: name + label,
      selector: el.cls || el.tag || "",
      x: Math.round(x),
      y: Math.round(y),
      w: Math.round(w),
      h: Math.round(h),
      depth: depth,
      bgColor: hasBg ? bgColor : null,
      textColor: hasText ? (props["color"] || "#000") : null,
      text: hasText ? el.text : null,
      fontSize: hasText ? (props["font-size"] || "16px") : null,
      fontWeight: hasText ? (props["font-weight"] || "400") : null,
      fontFamily: hasText ? (props["font-family"] || "sans-serif") : null,
      borderRadius: borderRadius,
      borderWidth: hasBorder ? (parseFloat(props["border-top-width"]) || 0) : 0,
      borderColor: hasBorder ? (props["border-top-color"] || "#000") : null,
      boxShadow: props["box-shadow"] && props["box-shadow"] !== "none" ? props["box-shadow"] : null,
      isImage: isImage,
      imgSrc: isImage ? el.src : null,
      imgAlt: isImage ? (el.alt || "") : null,
      opacity: opacity,
    });
  }

  if (el.children) {
    for (var c of el.children) {
      collectLayers(c, offsetX, offsetY, depth + 1, layers);
    }
  }
}

function getLayerPngScript() {
  return `
  (function(layers) {
    return Promise.all(layers.map(function(layer) {
      return new Promise(function(resolve) {
        var el = document.querySelector(layer.selector);
        if (!el) { resolve(null); return; }
        try {
          var rect = el.getBoundingClientRect();
          var scale = window.devicePixelRatio || 1;
          var canvas = document.createElement("canvas");
          canvas.width = Math.round(rect.width * scale);
          canvas.height = Math.round(rect.height * scale);
          var ctx = canvas.getContext("2d");
          ctx.scale(scale, scale);
          ctx.fillStyle = "rgba(0,0,0,0)";
          ctx.fillRect(0, 0, rect.width, rect.height);

          var serial = (function() {
            var clone = el.cloneNode(true);
            clone.setAttribute("xmlns", "http://www.w3.org/1999/xhtml");
            var styles = [];
            var walk = clone;
            var origWalk = el;
            var stack = [[walk, origWalk]];
            while (stack.length > 0) {
              var pair = stack.pop();
              var c = pair[0], o = pair[1];
              var cs = window.getComputedStyle(o);
              var s = [];
              for (var i = 0; i < cs.length; i++) {
                var prop = cs[i];
                s.push(prop + ":" + cs.getPropertyValue(prop));
              }
              c.style.cssText = s.join(";");
              var ci = c.children, oi = o.children;
              for (var j = 0; j < ci.length && j < oi.length; j++) {
                stack.push([ci[j], oi[j]]);
              }
            }
            var html = "<!DOCTYPE html><html><head><style>*{margin:0;padding:0;box-sizing:border-box;}</style></head><body>" + clone.outerHTML + "</body></html>";
            return html;
          })();

          var iframe = document.createElement("iframe");
          iframe.style.cssText = "position:fixed;left:-9999px;top:-9999px;width:" + rect.width + "px;height:" + rect.height + "px;border:none;";
          document.body.appendChild(iframe);

          var doc = iframe.contentDocument || iframe.contentWindow.document;
          doc.open();
          doc.write(serial);
          doc.close();

          setTimeout(function() {
            try {
              var iframeBody = doc.body;
              var iframes = iframeBody.querySelectorAll("iframe, object, embed, video, img[src]");
              if (iframes.length === 0) {
                var dataUrl = canvas.toDataURL("image/png");
                document.body.removeChild(iframe);
                resolve(dataUrl.split(",")[1]);
                return;
              }

              var c2 = doc.createElement("canvas");
              c2.width = Math.round(rect.width);
              c2.height = Math.round(rect.height);
              var ctx2 = c2.getContext("2d");
              var foreignObj = doc.createElementNS("http://www.w3.org/2000/svg", "foreignObject");
              foreignObj.setAttribute("width", rect.width);
              foreignObj.setAttribute("height", rect.height);
              foreignObj.appendChild(iframeBody.cloneNode(true));
              var svg = doc.createElementNS("http://www.w3.org/2000/svg", "svg");
              svg.setAttribute("xmlns", "http://www.w3.org/2000/svg");
              svg.setAttribute("width", rect.width);
              svg.setAttribute("height", rect.height);
              svg.appendChild(foreignObj);
              var svgStr = new XMLSerializer().serializeToString(svg);
              var blob = new Blob([svgStr], {type: "image/svg+xml;charset=utf-8"});
              var url = URL.createObjectURL(blob);
              var img = new Image();
              img.onload = function() {
                ctx2.drawImage(img, 0, 0);
                URL.revokeObjectURL(url);
                var dataUrl2 = c2.toDataURL("image/png");
                document.body.removeChild(iframe);
                resolve(dataUrl2.split(",")[1]);
              };
              img.onerror = function() {
                var dataUrl3 = canvas.toDataURL("image/png");
                document.body.removeChild(iframe);
                resolve(dataUrl3.split(",")[1]);
              };
              img.src = url;
            } catch(e) {
              var dataUrl4 = canvas.toDataURL("image/png");
              document.body.removeChild(iframe);
              resolve(dataUrl4.split(",")[1]);
            }
          }, 300);
        } catch(e) { resolve(null); }
      });
    }));
  })`;
}

async function convertToPsd(html, options) {
  var width = (options && options.width) || 1440;
  var height = (options && options.height) || 900;
  var scale = (options && options.scale) || 2;
  var pool = getPool();

  var fullPagePng = await pool.execute(async (page) => {
    await page.setViewport({ width: width, height: height, deviceScaleFactor: scale });
    await page.setContent(html, { waitUntil: "networkidle2", timeout: 30000 });
    await page.evaluate(function() { return document.fonts && document.fonts.ready; });
    await new Promise(function(r) { setTimeout(r, 600); });
    var ph = await page.evaluate(function() { return document.documentElement.scrollHeight; });
    return page.screenshot({
      type: "png",
      clip: { x: 0, y: 0, width: width, height: Math.max(ph, height) },
    });
  }, { timeout: 60000, retries: 3 });

  var layers = [];
  try {
    var domResult = await pool.execute(async (page) => {
      await page.setViewport({ width: width, height: height, deviceScaleFactor: 1 });
      await page.setContent(html, { waitUntil: "networkidle2", timeout: 30000 });
      await page.evaluate(function() { return document.fonts && document.fonts.ready; });
      await new Promise(function(r) { setTimeout(r, 500); });

      var domTree = await page.evaluate(function() {
        function getCS(el) {
          var cs = window.getComputedStyle(el);
          var props = {};
          var important = [
            "display","visibility","opacity","position",
            "background-color","background","border-radius",
            "border-top-width","border-top-color","border-right-width","border-right-color",
            "border-bottom-width","border-bottom-color","border-left-width","border-left-color",
            "border-top-style","border-right-style","border-bottom-style","border-left-style",
            "color","font-family","font-size","font-weight","font-style",
            "line-height","letter-spacing","text-align","text-decoration",
            "text-transform","white-space","box-shadow","padding-top","padding-right",
            "padding-bottom","padding-left","width","height","top","left",
          ];
          for (var i = 0; i < important.length; i++) {
            var v = cs.getPropertyValue(important[i]);
            if (v) props[important[i]] = v;
          }
          return props;
        }

        function walk(el, depth) {
          if (!el || depth > 50 || el.nodeType !== 1) return null;
          var rect = el.getBoundingClientRect();
          if (rect.width < 1 || rect.height < 1) return null;
          var tag = el.tagName.toLowerCase();
          if (["script","style","noscript","link","meta"].indexOf(tag) >= 0) return null;

          var props = getCS(el);
          var text = "";
          for (var ci = 0; ci < el.childNodes.length; ci++) {
            var n = el.childNodes[ci];
            if (n.nodeType === 3 && n.textContent.trim()) {
              text += (text ? " " : "") + n.textContent.trim();
            }
          }

          var children = [];
          for (var i = 0; i < el.children.length; i++) {
            var child = walk(el.children[i], depth + 1);
            if (child) children.push(child);
          }

          return {
            tag: tag,
            cls: typeof el.className === "string" ? el.className : "",
            text: text,
            x: Math.round(rect.x),
            y: Math.round(rect.y),
            w: Math.round(rect.width),
            h: Math.round(rect.height),
            props: props,
            children: children,
            src: tag === "img" ? (el.currentSrc || el.src || "") : "",
            alt: el.alt || "",
          };
        }

        return walk(document.body, 0);
      });

      return domTree;
    }, { timeout: 30000, retries: 2 });

    if (domResult) {
      collectLayers(domResult, 0, 0, 0, layers);
    }
  } catch (err) {
    console.log("  PSD ZIP: DOM extraction failed, using screenshot only:", err.message);
  }

  var selectorLayers = layers.filter(function(l) { return l.selector && l.selector.length > 0; }).slice(0, 40);

  var elementPngs = [];
  if (selectorLayers.length > 0) {
    try {
      var script = getLayerPngScript();
      var layerArgs = selectorLayers.map(function(l) {
        return { selector: l.selector, w: l.w, h: l.h };
      });
      elementPngs = await pool.execute(async function(page) {
        await page.setViewport({ width: width, height: height, deviceScaleFactor: 1 });
        await page.setContent(html, { waitUntil: "networkidle2", timeout: 30000 });
        await new Promise(function(r) { setTimeout(r, 500); });
        var result = await page.evaluate(new Function("layers", "(" + script + ")(layers)"), layerArgs);
        return result;
      }, { timeout: 60000, retries: 2 });
    } catch (err) {
      console.log("  PSD ZIP: Element screenshots failed:", err.message);
      elementPngs = [];
    }
  }

  var metadata = {
    version: "1.0",
    format: "zip-png-layers",
    pageWidth: width,
    pageHeight: height,
    scale: scale,
    layers: [],
  };

  var archive = archiver("zip", { zlib: { level: 6 } });
  var chunks = [];
  archive.on("data", function(chunk) { chunks.push(chunk); });

  var finished = new Promise(function(resolve, reject) {
    archive.on("end", function() { resolve(Buffer.concat(chunks)); });
    archive.on("error", function(err) { reject(err); });
  });

  archive.append(fullPagePng, { name: "_full-page.png" });

  for (var i = 0; i < layers.length; i++) {
    var layer = layers[i];
    var layerMeta = {
      index: i,
      name: layer.name,
      x: layer.x,
      y: layer.y,
      w: layer.w,
      h: layer.h,
      depth: layer.depth,
      bgColor: layer.bgColor,
      textColor: layer.textColor,
      text: layer.text,
      fontSize: layer.fontSize,
      fontWeight: layer.fontWeight,
      fontFamily: layer.fontFamily,
      borderRadius: layer.borderRadius,
      borderWidth: layer.borderWidth,
      borderColor: layer.borderColor,
      boxShadow: layer.boxShadow,
      isImage: layer.isImage,
      imgSrc: layer.imgSrc,
      imgAlt: layer.imgAlt,
      opacity: layer.opacity,
    };

    var pngData = elementPngs[i];
    if (pngData && pngData.length > 0) {
      var paddedIdx = String(i).padStart(3, "0");
      var safeName = layer.name.replace(/[^a-zA-Z0-9_-]/g, "_").substring(0, 40);
      var filename = paddedIdx + "_" + safeName + ".png";
      archive.append(Buffer.from(pngData, "base64"), { name: filename });
      layerMeta.pngFile = filename;
    }

    metadata.layers.push(layerMeta);
  }

  archive.append(JSON.stringify(metadata, null, 2), { name: "metadata.json" });
  await archive.finalize();
  return await finished;
}

module.exports = { convertToPsd };
