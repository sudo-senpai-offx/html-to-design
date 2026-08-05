const JSZip = require("jszip");
const { createCanvas, Image } = require("canvas");
const { getPool } = require("../lib/browser-pool");
const { resolveFormatOptions } = require("../lib/config");

function uuid() {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function(c) {
    var r = Math.random() * 16 | 0;
    return (c === "x" ? r : (r & 0x3 | 0x8)).toString(16);
  });
}

function parseColor(str) {
  if (!str) return { r: 0, g: 0, b: 0, a: 1 };
  var m = str.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+))?\s*\)/);
  if (m) return { r: parseInt(m[1]) / 255, g: parseInt(m[2]) / 255, b: parseInt(m[3]) / 255, a: m[4] !== undefined ? parseFloat(m[4]) : 1 };
  if (str.startsWith("#")) {
    var hex = str.replace("#", "");
    if (hex.length === 3) hex = hex[0]+hex[0]+hex[1]+hex[1]+hex[2]+hex[2];
    if (hex.length >= 6) return { r: parseInt(hex.substring(0,2),16)/255, g: parseInt(hex.substring(2,4),16)/255, b: parseInt(hex.substring(4,6),16)/255, a: 1 };
  }
  return { r: 0, g: 0, b: 0, a: 1 };
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

  if (hasBg || hasBorder || isImage || (hasText && w > 5)) {
    layers.push({
      name: (el.cls ? el.cls.split(" ")[0] : el.tag || "layer").substring(0, 60),
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
      borderRadius: borderRadius,
      borderWidth: hasBorder ? (parseFloat(props["border-top-width"]) || 0) : 0,
      borderColor: hasBorder ? (props["border-top-color"] || "#000") : null,
      isImage: isImage,
      opacity: isNaN(opacity) ? 1 : opacity,
    });
  }

  if (el.children) {
    for (var c of el.children) {
      collectLayers(c, offsetX, offsetY, depth + 1, layers);
    }
  }
}

function buildSketchLayer(layerData, renderingBase64) {
  var layerId = uuid();
  var name = layerData.name.substring(0, 60);
  var w = layerData.w;
  var h = layerData.h;

  var style = {
    _class: "style",
    blur: { _class: "blur", isEnabled: false, center: "{0.5, 0.5}", motionAngle: 0, radius: 10, saturation: 1, type: "gaussian" },
    borderOptions: { _class: "borderOptions", dashPattern: [], isEnabled: true, lineCapStyle: "butt", lineJoinStyle: "miter" },
    borders: [],
    colorControls: { _class: "colorControls", isEnabled: false, brightness: 0, contrast: 1, hue: 0, saturation: 1 },
    contextSettings: { _class: "contextSettings", opacity: layerData.opacity },
    fills: [],
    innerShadows: [],
    miterLimit: 10,
    shadows: [],
    windingRule: "nonzero",
  };

  if (layerData.bgColor) {
    var c = parseColor(layerData.bgColor);
    style.fills.push({
      _class: "fill",
      color: { _class: "color", alpha: c.a, red: c.r, green: c.g, blue: c.b },
      contextSettings: { _class: "contextSettings", opacity: 1 },
      gradient: { _class: "gradient", asymptotes: [], stops: [], type: "linear" },
      isEnabled: true,
      noise: { _class: "noise", isEnabled: false, radius: 10 },
      patternFillType: "tile",
      patternMetadata: { _class: "MSJSONFileReference", _ref_class: "MSImmutableBitmapData", _ref: "" },
      patternTileScale: 1,
    });
  }

  if (layerData.borderWidth > 0 && layerData.borderColor) {
    var bc = parseColor(layerData.borderColor);
    style.borders.push({
      _class: "border",
      color: { _class: "color", alpha: 1, red: bc.r, green: bc.g, blue: bc.b },
      contextSettings: { _class: "contextSettings", opacity: 1 },
      fillType: "color",
      isEnabled: true,
      thickness: layerData.borderWidth,
    });
  }

  var sketchLayer = {
    _class: "rectangle",
    do_objectID: layerId,
    name: name,
    rect: { _class: "rect", x: layerData.x, y: layerData.y, width: w, height: h },
    frame: { _class: "rect", x: layerData.x, y: layerData.y, width: w, height: h },
    isFlippedHorizontal: false,
    isFlippedVertical: false,
    isLocked: false,
    isVisible: true,
    layerListExpandedType: 0,
    nameIsFixed: false,
    resizingType: 0,
    rotation: 0,
    shouldBreakMaskChain: false,
    style: style,
    hasClippingMask: false,
    clipToContent: false,
    includeBackgroundColorInExport: false,
    includeBackgroundColorInInstance: false,
    includeInCloudUpload: true,
  };

  if (layerData.borderRadius > 0) {
    sketchLayer._class = "rectangle";
    sketchLayer.fixedRadius = layerData.borderRadius;
    sketchLayer.points = [
      { _class: "curvePoint", cornerRadius: layerData.borderRadius, curveFrom: "{0, 0.5}", curveMode: 4, curveTo: "{0.5, 0}", point: "{0, 0}" },
      { _class: "curvePoint", cornerRadius: layerData.borderRadius, curveFrom: "{0.5, 0}", curveMode: 4, curveTo: "{1, 0.5}", point: "{1, 0}" },
      { _class: "curvePoint", cornerRadius: layerData.borderRadius, curveFrom: "{1, 0.5}", curveMode: 4, curveTo: "{0.5, 1}", point: "{1, 1}" },
      { _class: "curvePoint", cornerRadius: layerData.borderRadius, curveFrom: "{0.5, 1}", curveMode: 4, curveTo: "{0, 0.5}", point: "{0, 1}" },
    ];
  }

  if (layerData.text) {
    sketchLayer._class = "text";
    var tc = parseColor(layerData.textColor || "#000000");
    var ff = layerData.fontFamily || "Helvetica";
    if (ff.includes("serif") && !ff.includes("sans")) ff = "Times New Roman";
    else if (ff.includes("mono") || ff.includes("Courier")) ff = "Courier New";
    else ff = "Helvetica";

    sketchLayer.style.fills = [{
      _class: "fill",
      color: { _class: "color", alpha: 1, red: tc.r, green: tc.g, blue: tc.b },
      isEnabled: true,
      fillType: "color",
    }];
    sketchLayer.attributedString = {
      _class: "attributedString",
      string: layerData.text,
      attributes: [{
        _class: "stringAttribute",
        location: 0,
        length: layerData.text.length,
        attributes: {
          _class: "textAttributes",
          MSAttributedStringFontAttribute: {
            _class: "font",
            attributes: {
              name: ff,
              size: Math.round(parseFloat(layerData.fontSize) || 16),
            },
          },
          MSAttributedStringColorAttribute: {
            _class: "color",
            alpha: 1,
            red: tc.r,
            green: tc.g,
            blue: tc.b,
          },
          paragraphStyle: {
            _class: "paragraphStyle",
            alignment: (layerData.textAlign || "left") === "center" ? 1 : (layerData.textAlign || "left") === "right" ? 2 : 0,
          },
        },
      }],
    };
    sketchLayer.style.fills = [];
  }

  if (renderingBase64) {
    sketchLayer._imageData = renderingBase64;
    sketchLayer.style.fills = [{
      _class: "fill",
      patternFillType: "fill",
      fillType: "pattern",
      patternMetadata: {
        _class: "MSJSONFileReference",
        _ref_class: "MSImmutableBitmapData",
        _ref: renderingBase64,
      },
      isEnabled: true,
      contextSettings: { _class: "contextSettings", opacity: 1 },
      color: { _class: "color", alpha: 1, red: 1, green: 1, blue: 1 },
      gradient: { _class: "gradient", asymptotes: [], stops: [], type: "linear" },
      noise: { _class: "noise", isEnabled: false, radius: 10 },
      patternTileScale: 1,
    }];
  }

  return sketchLayer;
}

async function convertToXd(html, options) {
  var cfg = resolveFormatOptions("xd", options);
  var width = cfg.width;
  var height = cfg.height;
  var scale = cfg.scale;
  var maxElements = cfg.maxElements;
  var pool = getPool();

  var fullPageScreenshot = await pool.execute(async (page) => {
    await page.setViewport({ width: width, height: height, deviceScaleFactor: scale });
    await page.setContent(html, { waitUntil: "networkidle2", timeout: cfg.setContentTimeout });
    await page.evaluate(function() { return document.fonts && document.fonts.ready; });
    await new Promise(function(r) { setTimeout(r, 600); });
    var ph = await page.evaluate(function() { return document.documentElement.scrollHeight; });
    return page.screenshot({
      type: "png",
      clip: { x: 0, y: 0, width: width, height: Math.max(ph, height) },
    });
  }, { timeout: cfg.taskTimeout || 60000, retries: 3 });

  var layers = [];
  try {
    var domResult = await pool.execute(async (page) => {
      await page.setViewport({ width: width, height: height, deviceScaleFactor: 1 });
      await page.setContent(html, { waitUntil: "networkidle2", timeout: cfg.setContentTimeout });
      await page.evaluate(function() { return document.fonts && document.fonts.ready; });
      await new Promise(function(r) { setTimeout(r, 500); });

      var domTree = await page.evaluate(function(maxElems) {
        var MAX_ELEMENTS = maxElems || 25000;
        var elementCount = 0;
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
          if (elementCount >= MAX_ELEMENTS) return null;
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
          elementCount++;
          return {
            tag: tag, cls: typeof el.className === "string" ? el.className : "",
            text: text, x: Math.round(rect.x), y: Math.round(rect.y),
            w: Math.round(rect.width), h: Math.round(rect.height),
            props: props, children: children,
            src: tag === "img" ? (el.currentSrc || el.src || "") : "",
            alt: el.alt || "",
          };
        }
        return walk(document.body, 0);
      }, maxElements);
      return domTree;
    }, { timeout: cfg.taskTimeout || 30000, retries: 2 });

    if (domResult) {
      collectLayers(domResult, 0, 0, 0, layers);
    }
  } catch (err) {
    console.log("  XD: DOM extraction failed:", err.message);
  }

  var selectorLayers = layers.filter(function(l) { return l.selector && l.selector.length > 0; }).slice(0, 50);

  var elementRenderings = [];
  if (selectorLayers.length > 0) {
    /* Slice each layer's pixels straight from the full-page screenshot —
     * fast and pixel-accurate (no per-layer iframe re-rendering). */
    try {
      var fullPageImg = new Image();
      fullPageImg.src = fullPageScreenshot;
      for (var ri = 0; ri < selectorLayers.length; ri++) {
        var ldl = selectorLayers[ri];
        try {
          var sliceCanvas = createCanvas(Math.max(ldl.w, 1) * scale, Math.max(ldl.h, 1) * scale);
          var sctx = sliceCanvas.getContext("2d");
          sctx.drawImage(
            fullPageImg,
            ldl.x * scale, ldl.y * scale, Math.max(ldl.w, 1) * scale, Math.max(ldl.h, 1) * scale,
            0, 0, Math.max(ldl.w, 1) * scale, Math.max(ldl.h, 1) * scale
          );
          elementRenderings.push(sliceCanvas.toDataURL("image/png").split(",")[1]);
        } catch (e) {
          elementRenderings.push(null);
        }
      }
    } catch (err) {
      console.log("  XD: Element renderings failed:", err.message);
      elementRenderings = [];
    }
  }

  var zip = new JSZip();

  var pageId = uuid();
  var artboardId = uuid();
  var pageName = "Page 1";

  var sketchLayers = [];

  for (var i = 0; i < selectorLayers.length; i++) {
    var ld = selectorLayers[i];
    var rendering = elementRenderings[i] || null;
    var sketchLayer = buildSketchLayer(ld, rendering);
    sketchLayers.push(sketchLayer);
  }

  var artboard = {
    _class: "artboard",
    do_objectID: artboardId,
    name: "HTML Export",
    rect: { _class: "rect", x: 0, y: 0, width: width, height: height },
    frame: { _class: "rect", x: 0, y: 0, width: width, height: height },
    isFlippedHorizontal: false,
    isFlippedVertical: false,
    isLocked: false,
    isVisible: true,
    layerListExpandedType: 0,
    nameIsFixed: true,
    resizingType: 0,
    rotation: 0,
    shouldBreakMaskChain: false,
    hasClippingMask: false,
    includeBackgroundColorInExport: true,
    includeBackgroundColorInInstance: true,
    includeInCloudUpload: true,
    style: {
      _class: "style",
      blur: { _class: "blur", isEnabled: false, center: "{0.5, 0.5}", motionAngle: 0, radius: 10, saturation: 1, type: "gaussian" },
      borderOptions: { _class: "borderOptions", dashPattern: [], isEnabled: true, lineCapStyle: "butt", lineJoinStyle: "miter" },
      borders: [],
      colorControls: { _class: "colorControls", isEnabled: false, brightness: 0, contrast: 1, hue: 0, saturation: 1 },
      contextSettings: { _class: "contextSettings", opacity: 1 },
      fills: [{ _class: "fill", color: { _class: "color", alpha: 1, red: 1, green: 1, blue: 1 }, isEnabled: true, fillType: "color" }],
      innerShadows: [],
      miterLimit: 10,
      shadows: [],
      windingRule: "nonzero",
    },
    layers: sketchLayers,
  };

  var pageData = {
    _class: "page",
    do_objectID: pageId,
    name: pageName,
    layers: [artboard],
    layerListExpandedType: 0,
    nameIsFixed: false,
    resizingType: 0,
    rotation: 0,
    shouldBreakMaskChain: false,
  };

  zip.file(pageId + ".json", JSON.stringify(pageData, null, 2));

  zip.file("document.json", JSON.stringify({
    _class: "document",
    do_objectID: uuid(),
    assets: { _class: "assetCollection", colorAssets: [], colors: [], gradientAssets: [], gradients: [], imageAssets: [], images: [] },
    colorSpace: 0,
    currentPageIndex: 0,
    foreignLayerStyles: [],
    foreignSymbols: [],
    foreignTextStyles: [],
    layerStyles: [],
    layerSymbols: [],
    pages: [{ _class: "MSJSONFileReference", _ref_class: "MSImmutablePage", _ref: pageId + ".json" }],
  }, null, 2));

  zip.file("meta.json", JSON.stringify({
    commit: "html-to-design",
    pagesAndArtboards: [{ name: pageName, id: pageId, artboards: [{ name: "HTML Export", id: artboardId }] }],
    version: 113,
    fonts: [],
    compatibilityVersion: 99,
    app: "com.bohemiancoding.sketch3",
    autosaved: 0,
    variant: "NONAPPSTORE",
    created: { commit: "html-to-design", appVersion: "99.0", build: 99, app: "com.bohemiancoding.sketch3", compatibilityVersion: 99, version: 113, variant: "NONAPPSTORE" },
    saveHistory: ["NONAPPSTORE.0"],
    appVersion: "99.0",
    build: 99,
  }, null, 2));

  zip.file("user.json", JSON.stringify({
    document: { pageListHeight: 110, pageListCollapsed: 0 },
    assetImportSyncFlag: {},
    filePreferences: {},
    preferences: { documentRulerUnits: 0, showMeasures: true },
  }, null, 2));

  var zipBuffer = await zip.generateAsync({
    type: "nodebuffer",
    compression: "DEFLATE",
    compressionOptions: { level: 6 },
  });

  console.log("  XD: Generated " + (zipBuffer.length / 1024).toFixed(1) + "KB .sketch file with " + selectorLayers.length + " layers");
  return zipBuffer;
}

module.exports = { convertToXd };
