const { writePsdBuffer, Compression } = require("ag-psd");
const { createCanvas } = require("canvas");
const { getPool } = require("../lib/browser-pool");

function parseColor(str) {
  if (!str) return null;
  var m = str.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+))?\s*\)/);
  if (m) return { r: parseInt(m[1]), g: parseInt(m[2]), b: parseInt(m[3]), a: m[4] !== undefined ? parseFloat(m[4]) : 1 };
  if (str.startsWith("#")) {
    var hex = str.replace("#", "");
    if (hex.length === 3) hex = hex[0]+hex[0]+hex[1]+hex[1]+hex[2]+hex[2];
    if (hex.length === 6) return { r: parseInt(hex.substring(0,2),16), g: parseInt(hex.substring(2,4),16), b: parseInt(hex.substring(4,6),16), a: 1 };
  }
  return null;
}

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
  var hasBgImage = el.bgImage && el.bgImage.length > 0;
  var hasBoxShadow = props["box-shadow"] && props["box-shadow"] !== "none";

  if (hasBg || hasBorder || isImage || hasBgImage || hasBoxShadow || (hasText && w > 5)) {
    layers.push({
      name: (el.cls ? el.cls.split(" ")[0] : el.tag || ("layer_" + depth)).substring(0, 60),
      selector: el.cls || el.tag || "",
      x: Math.round(x), y: Math.round(y),
      w: Math.round(w), h: Math.round(h),
      depth: depth,
      bgColor: hasBg ? bgColor : null,
      textColor: hasText ? (props["color"] || "#000") : null,
      text: hasText ? el.text : null,
      fontSize: hasText ? (props["font-size"] || "16px") : null,
      fontWeight: hasText ? (props["font-weight"] || "400") : null,
      fontFamily: hasText ? (props["font-family"] || "sans-serif") : null,
      lineHeight: hasText ? (props["line-height"] || "normal") : null,
      letterSpacing: hasText ? (props["letter-spacing"] || "normal") : null,
      textAlign: hasText ? (props["text-align"] || "left") : null,
      borderRadius: borderRadius,
      borderWidth: hasBorder ? (parseFloat(props["border-top-width"]) || 0) : 0,
      borderColor: hasBorder ? (props["border-top-color"] || "#000") : null,
      boxShadow: hasBoxShadow ? props["box-shadow"] : null,
      isImage: isImage,
      imgSrc: isImage ? el.src : null,
      imgAlt: isImage ? (el.alt || "") : null,
      opacity: isNaN(opacity) ? 1 : opacity,
      display: display,
      padding: {
        top: parseFloat(props["padding-top"]) || 0,
        right: parseFloat(props["padding-right"]) || 0,
        bottom: parseFloat(props["padding-bottom"]) || 0,
        left: parseFloat(props["padding-left"]) || 0,
      },
    });
  }

  if (el.children) {
    for (var c of el.children) {
      collectLayers(c, offsetX, offsetY, depth + 1, layers);
    }
  }
}

async function renderLayerToCanvas(layer, page, pageWidth, pageHeight, scale) {
  try {
    var w = Math.max(layer.w, 1);
    var h = Math.max(layer.h, 1);

    var renderedCanvas = createCanvas(w * scale, h * scale);
    var ctx = renderedCanvas.getContext("2d");
    ctx.scale(scale, scale);

    if (layer.bgColor) {
      var c = parseColor(layer.bgColor);
      if (c) {
        ctx.globalAlpha = layer.opacity;
        ctx.fillStyle = "rgb(" + c.r + "," + c.g + "," + c.b + ")";
        if (layer.borderRadius > 0) {
          ctx.beginPath();
          ctx.roundRect(0, 0, w, h, layer.borderRadius);
          ctx.fill();
        } else {
          ctx.fillRect(0, 0, w, h);
        }
        ctx.globalAlpha = 1;
      }
    }

    if (layer.borderWidth > 0 && layer.borderColor) {
      var bc = parseColor(layer.borderColor);
      if (bc) {
        ctx.strokeStyle = "rgb(" + bc.r + "," + bc.g + "," + bc.b + ")";
        ctx.lineWidth = layer.borderWidth;
        ctx.strokeRect(layer.borderWidth / 2, layer.borderWidth / 2, w - layer.borderWidth, h - layer.borderWidth);
      }
    }

    if (layer.text) {
      var fs = parseFloat(layer.fontSize) || 16;
      var fw = parseInt(layer.fontWeight) || 400;
      var fontColor = parseColor(layer.textColor || "#000000");
      if (fontColor) {
        ctx.fillStyle = "rgb(" + fontColor.r + "," + fontColor.g + "," + fontColor.b + ")";
      }
      var fontStyle = fw >= 700 ? "bold " : fw >= 500 ? "600 " : "";
      ctx.font = fontStyle + fs + "px sans-serif";
      ctx.textBaseline = "top";
      var tx = layer.padding.left || 4;
      var ty = layer.padding.top || 4;
      ctx.fillText(layer.text, tx, ty, w - tx - (layer.padding.right || 4));
    }

    return renderedCanvas;
  } catch (e) {
    return null;
  }
}

async function convertToPsd(html, options) {
  var width = (options && options.width) || 1440;
  var height = (options && options.height) || 900;
  var scale = (options && options.scale) || 2;
  var pool = getPool();

  var fullPageCanvas = await pool.execute(async (page) => {
    await page.setViewport({ width: width, height: height, deviceScaleFactor: scale });
    await page.setContent(html, { waitUntil: "networkidle2", timeout: 30000 });
    await page.evaluate(function() { return document.fonts && document.fonts.ready; });
    await new Promise(function(r) { setTimeout(r, 600); });
    var ph = await page.evaluate(function() { return document.documentElement.scrollHeight; });
    var clipHeight = Math.max(ph, height);
    var screenshotBuf = await page.screenshot({
      type: "png",
      clip: { x: 0, y: 0, width: width, height: clipHeight },
    });
    var img = createCanvas(width * scale, clipHeight * scale);
    var pngImg = new (require("canvas").Image)();
    pngImg.src = screenshotBuf;
    var ctx = img.getContext("2d");
    ctx.drawImage(pngImg, 0, 0, img.width, img.height);
    return { canvas: img, pageHeight: clipHeight };
  }, { timeout: 60000, retries: 3 });

  var fullPageCanvasImg = fullPageCanvas.canvas;
  var actualHeight = fullPageCanvas.pageHeight;

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
            bgImage: "",
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
    console.log("  PSD: DOM extraction failed, using screenshot only:", err.message);
  }

  var selectorLayers = layers.filter(function(l) { return l.selector && l.selector.length > 0; }).slice(0, 50);

  var elementRenderings = [];
  if (selectorLayers.length > 0) {
    try {
      var layerArgs = selectorLayers.map(function(l) {
        return { selector: l.selector, w: l.w, h: l.h, x: l.x, y: l.y };
      });
      elementRenderings = await pool.execute(async function(page) {
        await page.setViewport({ width: width, height: height, deviceScaleFactor: 1 });
        await page.setContent(html, { waitUntil: "networkidle2", timeout: 30000 });
        await new Promise(function(r) { setTimeout(r, 500); });
        var results = await page.evaluate(function(layers) {
          return Promise.all(layers.map(function(layer) {
            return new Promise(function(resolve) {
              var el = document.querySelector(layer.selector);
              if (!el) { resolve(null); return; }
              try {
                var canvas = document.createElement("canvas");
                var dpr = window.devicePixelRatio || 1;
                canvas.width = Math.round(layer.w * dpr);
                canvas.height = Math.round(layer.h * dpr);
                var ctx = canvas.getContext("2d");
                ctx.scale(dpr, dpr);

                var clone = el.cloneNode(true);
                clone.setAttribute("xmlns", "http://www.w3.org/1999/xhtml");
                var styles = [];
                var walk2 = clone;
                var origWalk = el;
                var stack = [[walk2, origWalk]];
                while (stack.length > 0) {
                  var pair = stack.pop();
                  var c2 = pair[0], o = pair[1];
                  var cs = window.getComputedStyle(o);
                  var s = [];
                  for (var i = 0; i < cs.length; i++) {
                    var prop = cs[i];
                    s.push(prop + ":" + cs.getPropertyValue(prop));
                  }
                  c2.style.cssText = s.join(";");
                  var ci2 = c2.children, oi2 = o.children;
                  for (var j = 0; j < ci2.length && j < oi2.length; j++) {
                    stack.push([ci2[j], oi2[j]]);
                  }
                }
                var htmlStr = "<!DOCTYPE html><html><head><style>*{margin:0;padding:0;box-sizing:border-box;}</style></head><body>" + clone.outerHTML + "</body></html>";

                var iframe = document.createElement("iframe");
                iframe.style.cssText = "position:fixed;left:-9999px;top:-9999px;width:" + layer.w + "px;height:" + layer.h + "px;border:none;";
                document.body.appendChild(iframe);
                var iDoc = iframe.contentDocument || iframe.contentWindow.document;
                iDoc.open();
                iDoc.write(htmlStr);
                iDoc.close();

                setTimeout(function() {
                  try {
                    var iframeBody = iDoc.body;
                    var hasEmbeds = iframeBody.querySelectorAll("iframe, object, embed, video").length > 0;
                    if (!hasEmbeds) {
                      var dataUrl = canvas.toDataURL("image/png");
                      document.body.removeChild(iframe);
                      resolve(dataUrl.split(",")[1]);
                      return;
                    }
                    var c3 = iDoc.createElement("canvas");
                    c3.width = Math.round(layer.w);
                    c3.height = Math.round(layer.h);
                    var ctx3 = c3.getContext("2d");
                    var foreignObj = iDoc.createElementNS("http://www.w3.org/2000/svg", "foreignObject");
                    foreignObj.setAttribute("width", layer.w);
                    foreignObj.setAttribute("height", layer.h);
                    foreignObj.appendChild(iframeBody.cloneNode(true));
                    var svg = iDoc.createElementNS("http://www.w3.org/2000/svg", "svg");
                    svg.setAttribute("xmlns", "http://www.w3.org/2000/svg");
                    svg.setAttribute("width", layer.w);
                    svg.setAttribute("height", layer.h);
                    svg.appendChild(foreignObj);
                    var svgStr = new XMLSerializer().serializeToString(svg);
                    var blob = new Blob([svgStr], {type: "image/svg+xml;charset=utf-8"});
                    var url = URL.createObjectURL(blob);
                    var img = new Image();
                    img.onload = function() {
                      ctx3.drawImage(img, 0, 0);
                      URL.revokeObjectURL(url);
                      var dataUrl2 = c3.toDataURL("image/png");
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
        }, layerArgs);
        return results;
      }, { timeout: 60000, retries: 2 });
    } catch (err) {
      console.log("  PSD: Element renderings failed:", err.message);
      elementRenderings = [];
    }
  }

  var backgroundLayer = {
    name: "Background",
    left: 0, top: 0,
    width: width * scale, height: actualHeight * scale,
    canvas: fullPageCanvasImg,
  };

  var psdLayers = [backgroundLayer];
  var groupStack = [];

  function addLayer(layerData, rendering, depth) {
    var group = null;
    for (var g of groupStack) {
      if (g.depth < depth) group = g;
    }

    var w = Math.max(layerData.w, 1);
    var h = Math.max(layerData.h, 1);
    var layerCanvas = null;
    var opacity = layerData.opacity;

    if (rendering) {
      try {
        var imgBuf = Buffer.from(rendering, "base64");
        var pngImg = new (require("canvas").Image)();
        pngImg.src = imgBuf;
        layerCanvas = createCanvas(w * scale, h * scale);
        var ctx = layerCanvas.getContext("2d");
        ctx.drawImage(pngImg, 0, 0, layerCanvas.width, layerCanvas.height);
      } catch (e) {
        layerCanvas = null;
      }
    }

    if (!layerCanvas) {
      layerCanvas = createCanvas(w * scale, h * scale);
      var ctx = layerCanvas.getContext("2d");
      ctx.scale(scale, scale);

      if (layerData.bgColor) {
        var c = parseColor(layerData.bgColor);
        if (c) {
          ctx.globalAlpha = opacity;
          ctx.fillStyle = "rgb(" + c.r + "," + c.g + "," + c.b + ")";
          if (layerData.borderRadius > 0) {
            ctx.beginPath();
            ctx.roundRect(0, 0, w, h, layerData.borderRadius);
            ctx.fill();
          } else {
            ctx.fillRect(0, 0, w, h);
          }
          ctx.globalAlpha = 1;
        }
      }

      if (layerData.borderWidth > 0 && layerData.borderColor) {
        var bc = parseColor(layerData.borderColor);
        if (bc) {
          ctx.strokeStyle = "rgb(" + bc.r + "," + bc.g + "," + bc.b + ")";
          ctx.lineWidth = layerData.borderWidth;
          ctx.strokeRect(layerData.borderWidth / 2, layerData.borderWidth / 2, w - layerData.borderWidth, h - layerData.borderWidth);
        }
      }

      if (layerData.text) {
        var fs = parseFloat(layerData.fontSize) || 16;
        var fw = parseInt(layerData.fontWeight) || 400;
        var fontColor = parseColor(layerData.textColor || "#000000");
        if (fontColor) ctx.fillStyle = "rgb(" + fontColor.r + "," + fontColor.g + "," + fontColor.b + ")";
        var fontStyle = fw >= 700 ? "bold " : fw >= 500 ? "600 " : "";
        ctx.font = fontStyle + fs + "px sans-serif";
        ctx.textBaseline = "top";
        var tx = layerData.padding.left || 4;
        var ty = layerData.padding.top || 4;
        ctx.fillText(layerData.text, tx, ty, w - tx - (layerData.padding.right || 4));
      }
    }

    var psdLayer = {
      name: layerData.name.substring(0, 60),
      left: layerData.x * scale,
      top: layerData.y * scale,
      width: w * scale,
      height: h * scale,
      canvas: layerCanvas,
      opacity: opacity,
      hidden: opacity < 0.01,
    };

    if (layerData.text) {
      var ff = "Arial";
      var ffStr = layerData.fontFamily || "";
      if (ffStr.includes("serif") && !ffStr.includes("sans")) ff = "Times New Roman";
      else if (ffStr.includes("mono") || ffStr.includes("Courier")) ff = "Courier New";

      psdLayer.text = {
        text: layerData.text,
        transform: { xx: 1, xy: 0, yx: 0, yy: 1, tx: 0, ty: 0 },
        style: {
          font: { name: ff },
          fontSize: Math.round(parseFloat(layerData.fontSize) || 16),
          fillColor: (function() {
            var tc = parseColor(layerData.textColor || "#000000");
            return tc ? { r: tc.r / 255, g: tc.g / 255, b: tc.b / 255 } : { r: 0, g: 0, b: 0 };
          })(),
        },
        engine: "Adobe Photoshop 24.0",
      };
    }

    return psdLayer;
  }

  for (var i = 0; i < selectorLayers.length; i++) {
    var ld = selectorLayers[i];
    var rendering = elementRenderings[i] || null;
    var psdLayer = addLayer(ld, rendering, ld.depth);
    psdLayers.push(psdLayer);
  }

  var doc = {
    width: width * scale,
    height: actualHeight * scale,
    children: psdLayers,
    creator: {
      tool: "HTML to Design Converter v2.0",
      version: "2.0",
    },
  };

  var psdBuffer = writePsdBuffer(doc, {
    generateThumbnail: true,
    trimImageData: false,
  });

  console.log("  PSD: Generated " + (psdBuffer.length / 1024).toFixed(1) + "KB .psd file with " + psdLayers.length + " layers");
  return psdBuffer;
}

module.exports = { convertToPsd };
