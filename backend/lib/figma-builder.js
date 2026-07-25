const { createEmptyFigDoc } = require("openfig-core");
const {
  solidFill, resolveFills, resolveImageFill, parseShadow, parseBoxShadows,
  getStroke, getRadius, fontFamily, fontWeight,
  makePos, zOrderChar, guid, pluginData, readableName,
  parseColor, computeSHA1, computeSHA1Bytes,
  parseGradient,
} = require("./utils");
const { extractStyles } = require("./style-extractor");
const { detectAutoLayout } = require("./layout");

function isNodeEmpty(node) {
  var fills = node.fillPaints || [];
  var hasFill = fills.some(function(f) {
    if (f.type === "SOLID" && f.color) return f.color.a > 0.01;
    if (f.type === "IMAGE") return true;
    if (f.type && f.type.indexOf("GRADIENT") >= 0) return true;
    return false;
  });
  var hasStroke = node.strokeWeight > 0;
  var hasEffects = node.effects && node.effects.length > 0;
  var hasAutoLayout = node.stackMode && node.stackMode !== "NONE";
  var hasClip = node.frameMaskDisabled === false;
  return !hasFill && !hasStroke && !hasEffects && !hasAutoLayout && !hasClip;
}

function extractDesignTokens(domTree) {
  var colorMap = new Map();
  var spacingSet = new Set();
  var radiusSet = new Set();

  function walk(el) {
    if (!el) return;
    var props = el.props || {};
    var colors = [
      props["background-color"], props["color"],
      props["border-top-color"], props["border-right-color"],
      props["border-bottom-color"], props["border-left-color"],
    ];
    for (var c of colors) {
      if (c && c !== "transparent" && c !== "currentColor" && c !== "inherit") {
        var parsed = parseColor(c);
        if (parsed && parsed.a > 0.01) {
          var hex = "#" + [parsed.r, parsed.g, parsed.b].map(function(v) {
            return Math.round(v * 255).toString(16).padStart(2, "0");
          }).join("");
          colorMap.set(hex.toLowerCase(), (colorMap.get(hex.toLowerCase()) || 0) + 1);
        }
      }
    }
    ["padding-top", "padding-right", "padding-bottom", "padding-left",
     "gap", "row-gap", "column-gap"].forEach(function(p) {
      var val = parseFloat(props[p]);
      if (val && val > 0 && val <= 200) spacingSet.add(val);
    });
    var rad = parseFloat(props["border-radius"]);
    if (rad && rad > 0 && rad <= 100) radiusSet.add(rad);
    if (el.children) el.children.forEach(walk);
  }
  walk(domTree);

  return {
    colors: Array.from(colorMap.entries()).sort(function(a, b) { return b[1] - a[1]; }).slice(0, 30).map(function(e) { return e[0]; }),
    spacing: Array.from(spacingSet).sort(function(a, b) { return a - b; }).slice(0, 20),
    radius: Array.from(radiusSet).sort(function(a, b) { return a - b; }).slice(0, 10),
  };
}

function extractTextStyles(domTree) {
  var styleMap = new Map();
  function walk(el) {
    if (!el) return;
    var props = el.props || {};
    if (el.text && el.text.length > 0 && (props["font-size"] || props["font-family"])) {
      var key = [fontFamily(props["font-family"]), fontWeight(props["font-weight"] || "400"),
        parseFloat(props["font-size"]) || 16, props["color"] || "#1A1A1A"].join("|");
      if (!styleMap.has(key)) {
        styleMap.set(key, {
          family: fontFamily(props["font-family"]),
          style: fontWeight(props["font-weight"] || "400"),
          size: parseFloat(props["font-size"]) || 16,
          color: parseColor(props["color"] || "#1A1A1A") || { r: 0.1, g: 0.1, b: 0.1, a: 1 },
          lineHeight: parseFloat(props["line-height"]) || (parseFloat(props["font-size"]) || 16) * 1.6,
          letterSpacing: parseFloat(props["letter-spacing"]) || 0,
          count: 1,
        });
      } else { styleMap.get(key).count++; }
    }
    if (el.children) el.children.forEach(walk);
  }
  walk(domTree);
  return Array.from(styleMap.values()).sort(function(a, b) { return b.count - a.count; }).slice(0, 20);
}

function mapJustifyContent(jc) {
  if (jc === "center") return "CENTER";
  if (jc === "flex-end" || jc === "end") return "MAX";
  if (jc === "space-between") return "SPACE_BETWEEN";
  if (jc === "space-around" || jc === "space-evenly") return "SPACE_BETWEEN";
  return "MIN";
}

function mapAlignItems(ai) {
  if (ai === "center") return "CENTER";
  if (ai === "flex-end" || ai === "end") return "MAX";
  if (ai === "stretch") return "STRETCH";
  return "MIN";
}

function buildDesignTokens(doc, canvasGuid, domTree, ctx) {
  var tokens = extractDesignTokens(domTree);

  var colorsFrameGuid = guid(1, ctx.nextId++);
  doc.message.nodeChanges.push({
    guid: colorsFrameGuid, type: "FRAME", name: "Colors",
    phase: "CREATED", parentIndex: { guid: canvasGuid, position: "!" },
    visible: true, opacity: 1,
    size: { x: tokens.colors.length * 60, y: 80 },
    transform: makePos(0, 0),
    fillPaints: [], strokeWeight: 0, strokeAlign: "OUTSIDE",
    frameMaskDisabled: false,
    stackMode: "HORIZONTAL", stackSpacing: 8,
    pluginData: pluginData(false),
  });
  for (var hex of tokens.colors) {
    var c = parseColor(hex);
    if (!c) continue;
    doc.message.nodeChanges.push({
      guid: guid(1, ctx.nextId++), type: "FRAME", name: hex,
      phase: "CREATED", parentIndex: { guid: colorsFrameGuid, position: zOrderChar(0) },
      visible: true, opacity: 1, size: { x: 50, y: 50 },
      transform: makePos(0, 0),
      fillPaints: [{ type: "SOLID", color: c, opacity: 1, visible: true, blendMode: "NORMAL" }],
      strokeWeight: 1, strokeAlign: "INSIDE",
      strokePaints: [{ type: "SOLID", color: { r: 0, g: 0, b: 0, a: 0.1 }, opacity: 1, visible: true, blendMode: "NORMAL" }],
      cornerRadius: 8, frameMaskDisabled: false,
      pluginData: pluginData(false),
    });
  }
}

function buildTextStyles(doc, canvasGuid, domTree, ctx) {
  var textStyles = extractTextStyles(domTree);
  var stylesFrameGuid = guid(1, ctx.nextId++);
  doc.message.nodeChanges.push({
    guid: stylesFrameGuid, type: "FRAME", name: "Text Styles",
    phase: "CREATED", parentIndex: { guid: canvasGuid, position: "!" },
    visible: true, opacity: 1,
    size: { x: 400, y: textStyles.length * 60 },
    transform: makePos(0, 100),
    fillPaints: [], strokeWeight: 0, strokeAlign: "OUTSIDE",
    frameMaskDisabled: false, stackMode: "VERTICAL", stackSpacing: 4,
    pluginData: pluginData(false),
  });
  for (var i = 0; i < textStyles.length; i++) {
    var ts = textStyles[i];
    var styleName = ts.family + " " + ts.style + " " + ts.size + "px";
    var rowGuid = guid(1, ctx.nextId++);
    doc.message.nodeChanges.push({
      guid: rowGuid, type: "FRAME", name: styleName.substring(0, 50),
      phase: "CREATED", parentIndex: { guid: stylesFrameGuid, position: zOrderChar(i) },
      visible: true, opacity: 1, size: { x: 400, y: Math.max(ts.lineHeight * 1.5, 30) },
      transform: makePos(0, 0), fillPaints: [],
      strokeWeight: 0, strokeAlign: "OUTSIDE", frameMaskDisabled: false,
      stackMode: "HORIZONTAL", stackSpacing: 12,
      pluginData: pluginData(false),
    });
    doc.message.nodeChanges.push({
      guid: guid(1, ctx.nextId++), type: "TEXT", name: styleName.substring(0, 50),
      phase: "CREATED", parentIndex: { guid: rowGuid, position: zOrderChar(0) },
      visible: true, opacity: 1, size: { x: 300, y: ts.lineHeight },
      transform: makePos(0, 0),
      textData: { characters: "Aa " + styleName },
      fontName: { family: ts.family, style: ts.style, postscript: "" },
      fontSize: Math.min(ts.size, 32),
      lineHeight: { value: ts.lineHeight, units: "PIXELS" },
      letterSpacing: { value: ts.letterSpacing, units: "PIXELS" },
      textAutoResize: "WIDTH_AND_HEIGHT",
      textAlignHorizontal: "LEFT", textAlignVertical: "CENTER",
      fillPaints: [{ type: "SOLID", color: ts.color, opacity: 1, visible: true, blendMode: "NORMAL" }],
      strokeWeight: 0, strokeAlign: "OUTSIDE",
      pluginData: pluginData(true),
    });
  }
}

async function buildNodes(el, parentGuid, parentX, parentY, childIndex, assetManager, doc, parentAutoLayout, parentSvgRastered, ctx) {
  if (!el) return [];
  var nodes = [];
  var tag = el.tag;
  var cls = el.cls || "";
  var props = el.props || {};
  var vpX = el.x, vpY = el.y, w = el.w, h = el.h;

  var pos = props["position"] || "static";
  var isAbsFixed = pos === "absolute" || pos === "fixed";
  var isRelative = pos === "relative";
  var relX, relY;

  if (isAbsFixed && el.positionedAncestor) {
    relX = vpX - el.positionedAncestor.x;
    relY = vpY - el.positionedAncestor.y;
  } else if (isRelative) {
    relX = (vpX - parentX) + ((parseFloat(props["left"]) || 0) || -(parseFloat(props["right"]) || 0));
    relY = (vpY - parentY) + ((parseFloat(props["top"]) || 0) || -(parseFloat(props["bottom"]) || 0));
  } else if (parentAutoLayout) {
    relX = 0; relY = 0;
  } else {
    relX = vpX - parentX; relY = vpY - parentY;
  }

  var s = extractStyles(props, w, h);
  var hasText = el.text && el.text.length > 0;
  var hasChildren = el.children && el.children.length > 0;

  var isSvg = ["svg","path","circle","rect","line","polyline","polygon","ellipse"].indexOf(tag) >= 0;
  var isPseudo = tag === "pseudo-before" || tag === "pseudo-after";
  var isTextInput = tag === "input" || tag === "textarea" || tag === "select";
  var isButton = tag === "button" || cls.includes("btn") || cls.includes("button");
  var isImage = tag === "img";
  var isLink = tag === "a";

  if (parentSvgRastered && isSvg && el.svgRasterId === undefined) return [];
  var display = props["display"] || "block";
  var visibility = props["visibility"] || "visible";
  var opacityVal = parseFloat(props["opacity"]);
  if (display === "none" || visibility === "hidden") return [];
  if (!isNaN(opacityVal) && opacityVal < 0.01) return [];

  var fill = s.fills.slice();
  if (isButton && fill.length === 0) fill = solidFill(props["background-color"] || "#3B82F6");
  if (isSvg && el.attrs && el.attrs.fill && el.attrs.fill !== "none") {
    var svgFill = parseColor(el.attrs.fill);
    if (svgFill) fill = [{ type: "SOLID", color: svgFill, opacity: parseFloat(el.attrs.opacity) || 1, visible: true, blendMode: "NORMAL" }];
  }

  var zPos = zOrderChar(childIndex || 0);
  var name = readableName(tag, cls, hasText ? el.text : "");
  if (isPseudo) name = (tag === "pseudo-before" ? "::before " : "::after ") + (el.text || "").substring(0, 20);
  if (cls) name = cls.split(/\s+/)[0].replace(/^[.#]/, "") + " [" + tag + "]";
  name = name.substring(0, 50);

  var containerGuid = null;
  var overflow = props["overflow"] || "visible";
  var clipsContent = overflow === "hidden" || overflow === "scroll" || overflow === "auto";

  if (w > 0 && h > 0) {
    containerGuid = guid(1, ctx.nextId++);
    var isContainer = !isSvg && !isImage && (hasChildren || hasText);
    var nodeType = "RECTANGLE";
    if (tag === "circle" || tag === "ellipse") nodeType = "ELLIPSE";
    if (isContainer) nodeType = "FRAME";

    var node = {
      guid: containerGuid, type: nodeType, name: name,
      phase: "CREATED", parentIndex: { guid: parentGuid, position: zPos },
      visible: true, opacity: s.opacity,
      size: { x: Math.max(w, 1), y: Math.max(h, 1) },
      transform: makePos(relX, relY),
      fillPaints: fill,
      strokeWeight: s.stroke.weight,
      strokeAlign: s.stroke.weight > 0 ? "INSIDE" : "OUTSIDE",
      strokePaints: s.stroke.paints,
      cornerRadius: isSvg ? 0 : s.radius,
      effects: s.effects,
      frameMaskDisabled: clipsContent ? false : true,
      pluginData: pluginData(false),
    };

    if (isContainer) {
      var display2 = props["display"] || "block";
      var isFlex = display2 === "flex" || display2 === "inline-flex";
      var isGrid = display2 === "grid" || display2 === "inline-grid";
      if (isFlex || isGrid) {
        var flexDir = props["flex-direction"] || "row";
        node.stackMode = (flexDir === "column" || flexDir === "column-reverse") ? "VERTICAL" : "HORIZONTAL";
        node.stackSpacing = parseFloat(props["gap"]) || parseFloat(props["column-gap"]) || parseFloat(props["row-gap"]) || 0;
        node.stackJustify = mapJustifyContent(props["justify-content"] || "flex-start");
        node.stackCounterAlign = mapAlignItems(props["align-items"] || "stretch");
        if (props["flex-wrap"] === "wrap" || props["flex-wrap"] === "wrap-reverse") node.stackWrapEnabled = true;
        var pt = parseFloat(props["padding-top"]) || 0;
        var pr = parseFloat(props["padding-right"]) || 0;
        var pb = parseFloat(props["padding-bottom"]) || 0;
        var pl = parseFloat(props["padding-left"]) || 0;
        if (pt > 0) node.stackPaddingTop = pt;
        if (pr > 0) node.stackPaddingRight = pr;
        if (pb > 0) node.stackPaddingBottom = pb;
        if (pl > 0) node.stackPaddingLeft = pl;
        node.stackPrimarySizing = "FIXED";
        node.stackCounterSizing = "FIXED";
        if (isGrid) node.name = name + " [Grid]";
      }
    }

    if (s.blurAmount > 0) {
      if (!node.effects) node.effects = [];
      node.effects.push({ type: "BACKGROUND_BLUR", visible: true, opacity: 0.5, radius: s.blurAmount, blendMode: "NORMAL" });
    }
    if (s.outline) {
      node.strokeWeight = s.outline.weight;
      node.strokeAlign = "OUTSIDE";
      node.strokePaints = [{ type: "SOLID", color: s.outline.color, opacity: 1, visible: true, blendMode: "NORMAL" }];
    }

    if (s.bgImageUrl && assetManager) {
      try {
        var imgResult = await assetManager.download(s.bgImageUrl);
        if (imgResult && imgResult.buffer) {
          var imgHash = computeSHA1(imgResult.buffer);
          var imgHashBytes = computeSHA1Bytes(imgResult.buffer);
          if (!doc.images) doc.images = new Map();
          doc.images.set(imgHash, imgResult.buffer);
          var bgScaleMode = "FILL";
          var bgSize = props["background-size"] || "";
          if (bgSize === "contain") bgScaleMode = "FIT";
          else if (bgSize === "auto") bgScaleMode = "TILE";
          node.fillPaints = [{
            type: "IMAGE", opacity: 1, visible: true, blendMode: "NORMAL",
            transform: { m00: 1, m01: 0, m02: 0, m10: 0, m11: 1, m12: 0 },
            image: { hash: imgHashBytes },
            imageScaleMode: bgScaleMode,
          }];
        }
      } catch (e) {}
    }

    nodes.push(node);
  }

  if (isImage && el.src && w > 0 && h > 0) {
    var imgScaleMode = "FILL";
    var objFit = props["object-fit"] || "fill";
    if (objFit === "contain") imgScaleMode = "FIT";
    else if (objFit === "cover") imgScaleMode = "FILL";
    else if (objFit === "none") imgScaleMode = "NONE";

    if (!containerGuid) {
      containerGuid = guid(1, ctx.nextId++);
      nodes.push({
        guid: containerGuid, type: "RECTANGLE", name: (el.alt || "Image").substring(0, 50),
        phase: "CREATED", parentIndex: { guid: parentGuid, position: zPos },
        visible: true, opacity: s.opacity,
        size: { x: Math.max(w, 1), y: Math.max(h, 1) },
        transform: makePos(relX, relY),
        fillPaints: solidFill("#f3f4f6"),
        strokeWeight: 0, strokeAlign: "OUTSIDE", cornerRadius: s.radius,
        frameMaskDisabled: true, pluginData: pluginData(false),
      });
    }
    try {
      var imgResult2 = await assetManager.download(el.src);
      if (imgResult2 && imgResult2.buffer) {
        var imgHash2 = computeSHA1(imgResult2.buffer);
        var imgHashBytes2 = computeSHA1Bytes(imgResult2.buffer);
        if (!doc.images) doc.images = new Map();
        doc.images.set(imgHash2, imgResult2.buffer);
        var targetNode = null;
        for (var n of nodes) {
          if (n.guid && n.guid.localID === containerGuid.localID) { targetNode = n; break; }
        }
        if (targetNode) {
          targetNode.fillPaints = [{
            type: "IMAGE", opacity: 1, visible: true, blendMode: "NORMAL",
            transform: { m00: 1, m01: 0, m02: 0, m10: 0, m11: 1, m12: 0 },
            image: { hash: imgHashBytes2 },
            imageScaleMode: imgScaleMode,
          }];
        }
      }
    } catch (e) {}
  }

  if (isSvg && el.svgRasterId !== undefined && el.svgRasterId >= 0 && w > 0 && h > 0) {
    if (!containerGuid) {
      containerGuid = guid(1, ctx.nextId++);
      nodes.push({
        guid: containerGuid, type: "RECTANGLE", name: (el.figmaName || "SVG Icon").substring(0, 50),
        phase: "CREATED", parentIndex: { guid: parentGuid, position: zPos },
        visible: true, opacity: s.opacity,
        size: { x: Math.max(w, 1), y: Math.max(h, 1) },
        transform: makePos(relX, relY),
        fillPaints: solidFill("#f3f4f6"),
        strokeWeight: 0, strokeAlign: "OUTSIDE", frameMaskDisabled: true,
        pluginData: pluginData(false),
      });
    }
    ctx.pendingImages.push({ svgRasterId: el.svgRasterId, nodeGuid: containerGuid, scaleMode: "FIT" });
  } else if (isSvg && el.svgPaths && el.svgPaths.length > 0 && !containerGuid) {
    containerGuid = guid(1, ctx.nextId++);
    var svgFill = parseColor(el.attrs && el.attrs.fill);
    nodes.push({
      guid: containerGuid, type: "VECTOR", name: "SVG Icon",
      phase: "CREATED", parentIndex: { guid: parentGuid, position: zPos },
      visible: true, opacity: s.opacity,
      size: { x: Math.max(w, 1), y: Math.max(h, 1) },
      transform: makePos(relX, relY),
      fillPaints: svgFill ? [{ type: "SOLID", color: svgFill, opacity: 1, visible: true, blendMode: "NORMAL" }] : fill,
      strokeWeight: 0, strokeAlign: "OUTSIDE", effects: s.effects,
      frameMaskDisabled: true, pluginData: pluginData(false),
    });
  }

  if (isTextInput) {
    var displayVal = el.value || el.placeholder || "";
    if (displayVal) {
      nodes.push({
        guid: guid(1, ctx.nextId++), type: "TEXT", name: ("Input: " + displayVal).substring(0, 50),
        phase: "CREATED", parentIndex: { guid: containerGuid || parentGuid, position: zOrderChar(0) },
        visible: true, opacity: s.opacity,
        size: { x: Math.max(w - 32, 10), y: Math.max(h - 28, 10) },
        transform: makePos(16, 14),
        textData: { characters: displayVal },
        fontName: { family: fontFamily(props["font-family"]), style: fontWeight(props["font-weight"]), postscript: "" },
        fontSize: parseFloat(props["font-size"]) || 16,
        lineHeight: { value: (parseFloat(props["font-size"]) || 16) * 1.4, units: "PIXELS" },
        letterSpacing: { value: 0, units: "PIXELS" },
        textAutoResize: "HEIGHT",
        textAlignHorizontal: s.textProps ? s.textProps.align : "LEFT",
        textAlignVertical: "TOP",
        fillPaints: solidFill(s.textProps ? s.textProps.color : "#1A1A1A"),
        strokeWeight: 0, strokeAlign: "OUTSIDE",
        pluginData: pluginData(true),
      });
    }
  }

  if (isButton && hasText) {
    nodes.push({
      guid: guid(1, ctx.nextId++), type: "TEXT", name: el.text.substring(0, 50),
      phase: "CREATED", parentIndex: { guid: containerGuid || parentGuid, position: zOrderChar(0) },
      visible: true, opacity: s.opacity,
      size: { x: Math.max(w, 10), y: Math.max(h, 10) },
      transform: makePos(0, 0),
      textData: { characters: el.text },
      fontName: { family: fontFamily(props["font-family"]) || "Inter", style: fontWeight(props["font-weight"] || "600"), postscript: "" },
      fontSize: parseFloat(props["font-size"]) || 16,
      lineHeight: { value: (parseFloat(props["font-size"]) || 16) * 1.4, units: "PIXELS" },
      letterSpacing: { value: 0, units: "PIXELS" },
      textAutoResize: "WIDTH_AND_HEIGHT",
      textAlignHorizontal: "CENTER", textAlignVertical: "CENTER",
      fillPaints: solidFill(props["color"] || "#FFFFFF"),
      strokeWeight: 0, strokeAlign: "OUTSIDE",
      pluginData: pluginData(true),
    });
  }

  if (hasText && !isTextInput && !isButton) {
    var ff = fontFamily(props["font-family"]);
    var textFill = solidFill(props["color"] || "#1A1A1A");
    if (s.textProps && s.textProps.color) {
      var tc = parseColor(s.textProps.color);
      if (tc && tc.a > 0.01) textFill = solidFill(s.textProps.color);
    }

    var whiteSpace = props["white-space"] || "normal";
    var textOverflow = props["text-overflow"] || "clip";
    var textAutoResize = "HEIGHT";
    var textTruncation = undefined;
    if (whiteSpace === "nowrap" || textOverflow === "ellipsis") {
      textAutoResize = "WIDTH_AND_HEIGHT";
      if (textOverflow === "ellipsis") textTruncation = "TRUNCATE";
    }

    var allEffects = (s.effects || []).slice();
    if (s.textShadowEffects && s.textShadowEffects.length > 0) {
      allEffects = allEffects.concat(s.textShadowEffects);
    }

    var textTransform = props["text-transform"] || "none";
    var displayText = el.text;
    if (textTransform === "uppercase") displayText = displayText.toUpperCase();
    else if (textTransform === "lowercase") displayText = displayText.toLowerCase();
    else if (textTransform === "capitalize") displayText = displayText.replace(/\b\w/g, function(c) { return c.toUpperCase(); });

    var fontSize = parseFloat(props["font-size"]) || 16;
    var lineHeightVal = parseFloat(props["line-height"]);
    if (!lineHeightVal || isNaN(lineHeightVal)) lineHeightVal = fontSize * 1.6;
    var letterSpacing = parseFloat(props["letter-spacing"]) || 0;
    var textDecoration = s.textProps ? s.textProps.decoration : undefined;

    var textX = 0, textY = 0;
    if (!containerGuid) { textX = relX; textY = relY; }

    var fontWeightVal = fontWeight(props["font-weight"] || "400");
    var fontStyleVal = props["font-style"] === "italic" ? "Italic" : "";
    var fullStyle = fontWeightVal + (fontStyleVal ? " " + fontStyleVal : "");

    nodes.push({
      guid: guid(1, ctx.nextId++), type: "TEXT", name: displayText.substring(0, 60),
      phase: "CREATED", parentIndex: { guid: containerGuid || parentGuid, position: zOrderChar(hasChildren ? 99 : 0) },
      visible: true, opacity: s.opacity,
      size: { x: Math.max(w, 1), y: Math.max(h, 1) },
      transform: makePos(textX, textY),
      textData: { characters: displayText },
      fontName: { family: ff, style: fullStyle, postscript: "" },
      fontSize: fontSize,
      lineHeight: { value: lineHeightVal, units: "PIXELS" },
      letterSpacing: { value: letterSpacing, units: "PIXELS" },
      textAutoResize: textAutoResize,
      textAlignHorizontal: s.textProps ? s.textProps.align : "LEFT",
      textAlignVertical: "TOP",
      fillPaints: textFill,
      strokeWeight: 0, strokeAlign: "OUTSIDE",
      textDecoration: textDecoration,
      truncation: textTruncation,
      effects: allEffects.length > 0 ? allEffects : undefined,
      pluginData: pluginData(true),
    });
  }

  if (el.children) {
    var targetGuid = containerGuid || parentGuid;
    var elAutoLayout = containerGuid !== null && (props["display"] === "flex" || props["display"] === "inline-flex" || props["display"] === "grid" || props["display"] === "inline-grid");
    var childSvgRastered = parentSvgRastered || (isSvg && el.svgRasterId !== undefined && el.svgRasterId >= 0);
    for (var i = 0; i < el.children.length; i++) {
      var childNodes = await buildNodes(el.children[i], targetGuid, vpX, vpY, i, assetManager, doc, elAutoLayout, childSvgRastered, ctx);
      nodes.push(...childNodes);
    }
  }

  return nodes;
}

function injectPendingImages(doc, pendingImages, assetManager, rasterizedSvgs) {
  for (var pending of pendingImages) {
    var hash = null, buffer = null;
    if (pending.svgRasterId !== undefined && rasterizedSvgs && rasterizedSvgs[pending.svgRasterId]) {
      buffer = Buffer.from(rasterizedSvgs[pending.svgRasterId], "base64");
      hash = computeSHA1(buffer);
      if (!doc.images) doc.images = new Map();
      doc.images.set(hash, buffer);
    } else if (pending.url && assetManager && assetManager.cache.has(pending.url)) {
      var cached = assetManager.cache.get(pending.url);
      buffer = cached.buffer; hash = cached.hash;
      if (!doc.images) doc.images = new Map();
      doc.images.set(hash, cached.buffer);
    } else { continue; }
    var hashBytes = computeSHA1Bytes(buffer);
    var targetNode = null;
    for (var n of doc.message.nodeChanges) {
      if (n.guid && n.guid.localID === pending.nodeGuid.localID) { targetNode = n; break; }
    }
    if (targetNode) {
      targetNode.fillPaints = [{
        type: "IMAGE", opacity: 1, visible: true, blendMode: "NORMAL",
        transform: { m00: 1, m01: 0, m02: 0, m10: 0, m11: 1, m12: 0 },
        image: { hash: hashBytes },
        imageScaleMode: pending.scaleMode,
      }];
    }
  }
}

function flattenTree(doc) {
  var nodes = doc.message.nodeChanges;
  var pageGuidLocal = null;
  for (var n of nodes) {
    if (n.type === "FRAME" && n.name && n.size && n.size.x > 1000) {
      pageGuidLocal = n.guid; break;
    }
  }
  var removed = 0, changed = true;
  while (changed) {
    changed = false;
    for (var i = nodes.length - 1; i >= 0; i--) {
      var node = nodes[i];
      if (node.type !== "FRAME") continue;
      if (pageGuidLocal && node.guid.localID === pageGuidLocal.localID) continue;
      if (node.name === "Components" || node.name === "Colors" || node.name === "Text Styles") continue;
      if (!isNodeEmpty(node)) continue;
      var children = [];
      for (var j = 0; j < nodes.length; j++) {
        var c = nodes[j];
        if (c.parentIndex && c.parentIndex.guid && c.parentIndex.guid.localID === node.guid.localID) children.push(c);
      }
      if (children.length === 0) { nodes.splice(i, 1); removed++; changed = true; continue; }
      if (children.length === 1) {
        var child = children[0];
        child.parentIndex = { guid: node.parentIndex.guid, position: node.parentIndex.position };
        if (child.transform && node.transform) {
          child.transform = { m00: 1, m01: 0,
            m02: Math.round((child.transform.m02 || 0) + (node.transform.m02 || 0)),
            m10: 0, m11: 1,
            m12: Math.round((child.transform.m12 || 0) + (node.transform.m12 || 0)),
          };
        }
        if (!child.pluginData || child.pluginData.length === 0) child.pluginData = pluginData(child.type === "TEXT");
        nodes.splice(i, 1); removed++; changed = true;
      }
    }
  }
  return removed;
}

function generateThumbnail(domTree, pageWidth, pageHeight, doc) {
  try {
    var { createCanvas } = require("canvas");
    var tw = 400, th = 225;
    var canvas = createCanvas(tw, th);
    var ctx = canvas.getContext("2d");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, tw, th);

    var scaleX = tw / Math.max(pageWidth, 1);
    var scaleY = th / Math.max(pageHeight, 1);
    var scale = Math.min(scaleX, scaleY);

    ctx.save();
    ctx.scale(scale, scale);

    function drawNode(node, offsetX, offsetY) {
      if (!node) return;
      var props = node.props || {};
      var x = (node.x || 0) + offsetX;
      var y = (node.y || 0) + offsetY;
      var w = node.w || 0;
      var h = node.h || 0;
      if (w < 1 || h < 1) return;

      var display = props["display"] || "block";
      var visibility = props["visibility"] || "visible";
      var opacity = parseFloat(props["opacity"]);
      if (display === "none" || visibility === "hidden") return;
      if (!isNaN(opacity) && opacity < 0.01) return;

      var bgColor = props["background-color"];
      if (bgColor && bgColor !== "transparent") {
        var m = bgColor.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
        if (m) {
          ctx.save();
          ctx.globalAlpha = opacity || 1;
          ctx.fillStyle = "rgb(" + m[1] + "," + m[2] + "," + m[3] + ")";
          var radius = parseFloat(props["border-radius"]) || 0;
          if (radius > 0) {
            ctx.beginPath();
            ctx.roundRect(x, y, w, h, radius);
            ctx.fill();
          } else {
            ctx.fillRect(x, y, w, h);
          }
          ctx.restore();
        }
      }

      var borderWidth = parseFloat(props["border-top-width"]) || 0;
      if (borderWidth > 0 && props["border-top-color"] && props["border-top-color"] !== "transparent") {
        ctx.save();
        ctx.strokeStyle = props["border-top-color"];
        ctx.lineWidth = borderWidth;
        ctx.strokeRect(x + borderWidth / 2, y + borderWidth / 2, w - borderWidth, h - borderWidth);
        ctx.restore();
      }

      var text = "";
      for (var ci = 0; ci < (node.children || []).length; ci++) {
        var child = node.children[ci];
        if (child && child.text && child.text.length > 0) {
          text = child.text;
          break;
        }
      }
      if (!text && node.text) text = node.text;

      if (text && text.length > 0) {
        var fontSize = parseFloat(props["font-size"]) || parseFloat((node.props || {})["font-size"]) || 14;
        var color = props["color"] || "#000000";
        ctx.save();
        ctx.fillStyle = color;
        ctx.font = fontSize + "px sans-serif";
        ctx.textBaseline = "top";
        var maxW = w - 8;
        var displayText = text.length > 40 ? text.substring(0, 37) + "..." : text;
        ctx.fillText(displayText, x + 4, y + 4, maxW);
        ctx.restore();
      }

      if (node.children) {
        for (var i = 0; i < node.children.length; i++) {
          drawNode(node.children[i], offsetX, offsetY);
        }
      }
    }

    if (domTree) drawNode(domTree, 0, 0);
    ctx.restore();

    var buf = canvas.toBuffer("image/png");
    doc.thumbnail = new Uint8Array(buf);
  } catch (e) {
    // keep default thumbnail on error
  }
}

async function buildDocument(domTree, pageWidth, pageHeight, pageName, assetManager, rasterizedSvgs) {
  var ctx = { nextId: 500, pageGuid: null, pendingImages: [] };
  var doc = createEmptyFigDoc();
  for (var n of doc.message.nodeChanges) {
    if (n.guid && n.guid.localID >= ctx.nextId) ctx.nextId = n.guid.localID + 1;
  }
  var canvasGuid = doc.message.nodeChanges.find(function(n) { return n.type === "CANVAS"; }).guid;

  buildDesignTokens(doc, canvasGuid, domTree, ctx);
  buildTextStyles(doc, canvasGuid, domTree, ctx);

  ctx.pageGuid = guid(1, ctx.nextId++);
  doc.message.nodeChanges.push({
    guid: ctx.pageGuid, type: "FRAME", name: pageName,
    phase: "CREATED", parentIndex: { guid: canvasGuid, position: "!" },
    visible: true, opacity: 1,
    size: { x: pageWidth, y: pageHeight },
    transform: { m00: 1, m01: 0, m02: 0, m10: 0, m11: 1, m12: 0 },
    frameMaskDisabled: false, pluginData: pluginData(false),
  });

  var allNodes = await buildNodes(domTree, ctx.pageGuid, 0, 0, 0, assetManager, doc, false, undefined, ctx);
  doc.message.nodeChanges.push(...allNodes);
  injectPendingImages(doc, ctx.pendingImages, assetManager, rasterizedSvgs);
  flattenTree(doc);

  generateThumbnail(domTree, pageWidth, pageHeight, doc);
  doc.meta = { file_name: pageName || "HTML Export", version: 1 };

  return doc;
}

module.exports = { buildDocument };
