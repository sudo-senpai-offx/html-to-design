const { createEmptyFigDoc } = require("openfig-core");
const {
  solidFill, resolveFills, resolveImageFill, parseShadow, parseBoxShadows,
  getStroke, getRadius, fontFamily, fontWeight,
  makePos, zOrderChar, guid, pluginData, readableName,
  parseColor, computeSHA1, computeSHA1Bytes,
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
  var fontFamilySet = new Set();

  function walk(el) {
    if (!el) return;
    var props = el.props || {};
    var colors = [
      props["background-color"],
      props["color"],
      props["border-color"],
      props["border-top-color"],
      props["border-right-color"],
      props["border-bottom-color"],
      props["border-left-color"],
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

    var bgImage = props["background-image"];
    if (bgImage && (bgImage.includes("linear-gradient") || bgImage.includes("radial-gradient"))) {
      var stopsMatch = bgImage.match(/(rgba?\([^)]+\)|#[0-9a-fA-F]{3,8}|transparent)\s*([\d.]+)%?/g);
      if (stopsMatch) {
        for (var s of stopsMatch) {
          var cm = s.match(/(rgba?\([^)]+\)|#[0-9a-fA-F]{3,8})/);
          if (cm) {
            var parsed2 = parseColor(cm[1]);
            if (parsed2 && parsed2.a > 0.01) {
              var hex2 = "#" + [parsed2.r, parsed2.g, parsed2.b].map(function(v) {
                return Math.round(v * 255).toString(16).padStart(2, "0");
              }).join("");
              colorMap.set(hex2.toLowerCase(), (colorMap.get(hex2.toLowerCase()) || 0) + 1);
            }
          }
        }
      }
    }

    ["margin-top", "margin-bottom", "margin-left", "margin-right",
     "padding-top", "padding-bottom", "padding-left", "padding-right",
     "gap", "row-gap", "column-gap"].forEach(function(p) {
      var val = parseFloat(props[p]);
      if (val && val > 0 && val <= 200) spacingSet.add(val);
    });
    var rad = parseFloat(props["border-radius"]);
    if (rad && rad > 0 && rad <= 100) radiusSet.add(rad);

    if (props["font-family"]) {
      fontFamilySet.add(props["font-family"]);
    }

    if (el.children) el.children.forEach(walk);
  }
  walk(domTree);

  var sorted = Array.from(colorMap.entries())
    .sort(function(a, b) { return b[1] - a[1]; })
    .slice(0, 30)
    .map(function(e) { return e[0]; });

  var sortedSpacing = Array.from(spacingSet).sort(function(a, b) { return a - b; }).slice(0, 20);
  var sortedRadius = Array.from(radiusSet).sort(function(a, b) { return a - b; }).slice(0, 10);
  var sortedFonts = Array.from(fontFamilySet).slice(0, 5);

  return { colors: sorted, spacing: sortedSpacing, radius: sortedRadius, fonts: sortedFonts };
}

function buildNodes(el, parentGuid, parentX, parentY, childIndex, assetManager, doc, parentAutoLayout, parentSvgRastered, ctx) {
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
    var relTop = parseFloat(props["top"]) || 0;
    var relLeft = parseFloat(props["left"]) || 0;
    var relRight = parseFloat(props["right"]) || 0;
    var relBottom = parseFloat(props["bottom"]) || 0;
    relX = (vpX - parentX) + (relLeft || -relRight || 0);
    relY = (vpY - parentY) + (relTop || -relBottom || 0);
  } else if (parentAutoLayout) {
    relX = 0;
    relY = 0;
  } else {
    relX = vpX - parentX;
    relY = vpY - parentY;
  }

  var s = extractStyles(props, w, h);
  var hasText = el.text && el.text.length > 0;
  var hasChildren = el.children && el.children.length > 0;

  var isSvg = tag === "svg" || tag === "path" || tag === "circle" || tag === "rect" ||
              tag === "line" || tag === "polyline" || tag === "polygon" || tag === "ellipse";
  var isPseudo = tag === "pseudo-before" || tag === "pseudo-after";
  var isTextInput = tag === "input" || tag === "textarea" || tag === "select";
  var isButton = tag === "button" || cls.includes("btn") || cls.includes("button");
  var isImage = tag === "img";
  var isLink = tag === "a";
  var isListItem = tag === "li";

  if (parentSvgRastered && isSvg && el.svgRasterId === undefined) {
    return [];
  }

  var display = props["display"] || "block";
  var visibility = props["visibility"] || "visible";
  var opacityVal = parseFloat(props["opacity"]);
  if (display === "none") return [];
  if (visibility === "hidden") return [];
  if (!isNaN(opacityVal) && opacityVal < 0.01) return [];

  var fill = s.fills.slice();
  if (isButton && fill.length === 0) {
    fill = solidFill(props["background-color"] || "#3B82F6");
  }

  if (isSvg && el.attrs && el.attrs.fill && el.attrs.fill !== "none") {
    var svgFill = parseColor(el.attrs.fill);
    if (svgFill) {
      fill = [{ type: "SOLID", color: svgFill, opacity: parseFloat(el.attrs.opacity) || 1, visible: true, blendMode: "NORMAL" }];
    }
  }

  var zPos = zOrderChar(childIndex || 0);
  var name = el.figmaName || readableName(tag, cls, hasText ? el.text : "");
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
      guid: containerGuid, type: nodeType,
      name: name.substring(0, 50),
      phase: "CREATED",
      parentIndex: { guid: parentGuid, position: zPos },
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

    if (isContainer && s.layoutMode !== "NONE") {
      var layout = detectAutoLayout(el, el.children ? el.children.length : 0);
      node.stackMode = layout.stackMode;
      node.stackSpacing = layout.stackSpacing;
      node.stackJustify = layout.stackJustify;
      node.stackCounterAlign = layout.stackCounterAlign;
      node.stackPrimarySizing = layout.stackPrimarySizing;
      node.stackCounterSizing = layout.stackCounterSizing;
      if (layout.stackWrapEnabled) node.stackWrapEnabled = true;
      if (layout.stackPaddingTop > 0) node.stackPaddingTop = layout.stackPaddingTop;
      if (layout.stackPaddingRight > 0) node.stackPaddingRight = layout.stackPaddingRight;
      if (layout.stackPaddingBottom > 0) node.stackPaddingBottom = layout.stackPaddingBottom;
      if (layout.stackPaddingLeft > 0) node.stackPaddingLeft = layout.stackPaddingLeft;

      if (layout.isGrid && layout.gridInfo) {
        node.name = name.substring(0, 40) + " [Grid]";
      }
    }

    if (isButton) {
      node.name = name.substring(0, 40) + " [Button]";
    }
    if (isLink) {
      node.name = name.substring(0, 40) + " [Link]";
    }
    if (isListItem) {
      node.name = name.substring(0, 40) + " [List Item]";
    }

    nodes.push(node);

    if (s.bgImageUrl && assetManager) {
      var bgScaleMode = "FILL";
      var bgSize = props["background-size"] || "";
      if (bgSize === "contain") bgScaleMode = "FIT";
      else if (bgSize === "cover") bgScaleMode = "FILL";
      else if (bgSize === "auto") bgScaleMode = "TILE";
      ctx.pendingImages.push({ url: s.bgImageUrl, nodeGuid: containerGuid, scaleMode: bgScaleMode });
    }

    if (s.blurAmount > 0) {
      if (!node.effects) node.effects = [];
      node.effects.push({
        type: "BACKGROUND_BLUR",
        visible: true,
        opacity: 0.5,
        radius: s.blurAmount,
        blendMode: "NORMAL",
      });
    }

    if (s.outline) {
      node.strokeWeight = s.outline.weight;
      node.strokeAlign = "OUTSIDE";
      node.strokePaints = [{ type: "SOLID", color: s.outline.color, opacity: 1, visible: true, blendMode: "NORMAL" }];
    }
  }

  if (isImage && el.src && w > 0 && h > 0) {
    var imgScaleMode = "FILL";
    var objFit = props["object-fit"] || "fill";
    if (objFit === "contain") imgScaleMode = "FIT";
    else if (objFit === "cover") imgScaleMode = "FILL";
    else if (objFit === "none") imgScaleMode = "NONE";
    else if (objFit === "scale-down") imgScaleMode = "FIT";

    if (!containerGuid) {
      containerGuid = guid(1, ctx.nextId++);
      nodes.push({
        guid: containerGuid, type: "RECTANGLE",
        name: (el.alt || "Image").substring(0, 50),
        phase: "CREATED",
        parentIndex: { guid: parentGuid, position: zPos },
        visible: true, opacity: s.opacity,
        size: { x: Math.max(w, 1), y: Math.max(h, 1) },
        transform: makePos(relX, relY),
        fillPaints: solidFill("#f3f4f6"),
        strokeWeight: 0, strokeAlign: "OUTSIDE",
        cornerRadius: s.radius,
        effects: undefined,
        frameMaskDisabled: true,
        pluginData: pluginData(false),
      });
    }
    ctx.pendingImages.push({ url: el.src, nodeGuid: containerGuid, scaleMode: imgScaleMode });
  }

  if (isSvg && el.svgRasterId !== undefined && el.svgRasterId >= 0 && w > 0 && h > 0) {
    if (!containerGuid) {
      containerGuid = guid(1, ctx.nextId++);
      nodes.push({
        guid: containerGuid, type: "RECTANGLE",
        name: (el.figmaName || "SVG Icon").substring(0, 50),
        phase: "CREATED",
        parentIndex: { guid: parentGuid, position: zPos },
        visible: true, opacity: s.opacity,
        size: { x: Math.max(w, 1), y: Math.max(h, 1) },
        transform: makePos(relX, relY),
        fillPaints: solidFill("#f3f4f6"),
        strokeWeight: 0, strokeAlign: "OUTSIDE",
        effects: undefined,
        frameMaskDisabled: true,
        pluginData: pluginData(false),
      });
    }
    ctx.pendingImages.push({ svgRasterId: el.svgRasterId, nodeGuid: containerGuid, scaleMode: "FIT" });
  } else if (isSvg && el.svgPaths && el.svgPaths.length > 0 && !containerGuid) {
    containerGuid = guid(1, ctx.nextId++);
    var svgFill = parseColor(el.attrs && el.attrs.fill);
    nodes.push({
      guid: containerGuid, type: "VECTOR",
      name: "SVG Icon",
      phase: "CREATED",
      parentIndex: { guid: parentGuid, position: zPos },
      visible: true, opacity: s.opacity,
      size: { x: Math.max(w, 1), y: Math.max(h, 1) },
      transform: makePos(relX, relY),
      fillPaints: svgFill ? [{ type: "SOLID", color: svgFill, opacity: 1, visible: true, blendMode: "NORMAL" }] : fill,
      strokeWeight: 0, strokeAlign: "OUTSIDE",
      effects: s.effects,
      frameMaskDisabled: true,
      pluginData: pluginData(false),
    });
  }

  if (isTextInput) {
    var displayVal = el.value || el.placeholder || "";
    if (displayVal) {
      nodes.push({
        guid: guid(1, ctx.nextId++), type: "TEXT",
        name: ("Input: " + displayVal).substring(0, 50),
        phase: "CREATED",
        parentIndex: { guid: containerGuid || parentGuid, position: zOrderChar(0) },
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
      guid: guid(1, ctx.nextId++), type: "TEXT",
      name: el.text.substring(0, 50),
      phase: "CREATED",
      parentIndex: { guid: containerGuid || parentGuid, position: zOrderChar(0) },
      visible: true, opacity: s.opacity,
      size: { x: Math.max(w, 10), y: Math.max(h, 10) },
      transform: makePos(0, 0),
      textData: { characters: el.text },
      fontName: { family: fontFamily(props["font-family"]) || "Inter", style: fontWeight(props["font-weight"] || "600"), postscript: "" },
      fontSize: parseFloat(props["font-size"]) || 16,
      lineHeight: { value: (parseFloat(props["font-size"]) || 16) * 1.4, units: "PIXELS" },
      letterSpacing: { value: 0, units: "PIXELS" },
      textAutoResize: "WIDTH_AND_HEIGHT",
      textAlignHorizontal: "CENTER",
      textAlignVertical: "CENTER",
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
      if (tc && tc.a > 0.01) {
        textFill = solidFill(s.textProps.color);
      }
    }

    var whiteSpace = props["white-space"] || "normal";
    var textOverflow = props["text-overflow"] || "clip";
    var textAutoResize = "HEIGHT";
    var textTruncation = undefined;
    if (whiteSpace === "nowrap" || textOverflow === "ellipsis") {
      textAutoResize = "WIDTH_AND_HEIGHT";
      if (textOverflow === "ellipsis") {
        textTruncation = "TRUNCATE";
      }
    }

    var allEffects = s.effects || [];
    if (s.textShadowEffects && s.textShadowEffects.length > 0) {
      allEffects = allEffects.concat(s.textShadowEffects);
    }

    var textTransform = props["text-transform"] || "none";
    var displayText = el.text;
    if (textTransform === "uppercase") displayText = displayText.toUpperCase();
    else if (textTransform === "lowercase") displayText = displayText.toLowerCase();
    else if (textTransform === "capitalize") {
      displayText = displayText.replace(/\b\w/g, function(c) { return c.toUpperCase(); });
    }

    var fontSize = parseFloat(props["font-size"]) || 16;
    var lineHeightVal = parseFloat(props["line-height"]);
    if (!lineHeightVal || isNaN(lineHeightVal)) {
      lineHeightVal = fontSize * 1.6;
    }
    var letterSpacing = parseFloat(props["letter-spacing"]) || 0;

    var textX = 0;
    var textY = 0;
    if (!containerGuid) {
      textX = relX;
      textY = relY;
    }

    var textDecoration = undefined;
    if (s.textProps && s.textProps.decoration) {
      textDecoration = s.textProps.decoration;
    }

    nodes.push({
      guid: guid(1, ctx.nextId++), type: "TEXT",
      name: displayText.substring(0, 60),
      phase: "CREATED",
      parentIndex: { guid: containerGuid || parentGuid, position: zOrderChar(hasChildren ? 99 : 0) },
      visible: true, opacity: s.opacity,
      size: { x: Math.max(w, 1), y: Math.max(h, 1) },
      transform: makePos(textX, textY),
      textData: { characters: displayText },
      fontName: { family: ff, style: fontWeight(props["font-weight"] || "400"), postscript: "" },
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
    var elAutoLayout = isContainer && s.layoutMode !== "NONE";
    var childSvgRastered = parentSvgRastered || (isSvg && el.svgRasterId !== undefined && el.svgRasterId >= 0);
    for (var i = 0; i < el.children.length; i++) {
      nodes.push(...buildNodes(el.children[i], targetGuid, vpX, vpY, i, assetManager, doc, elAutoLayout, childSvgRastered, ctx));
    }
  }

  return nodes;
}

function injectPendingImages(doc, pendingImages, assetManager, rasterizedSvgs) {
  for (var pending of pendingImages) {
    var hash = null;
    var buffer = null;

    if (pending.svgRasterId !== undefined && rasterizedSvgs && rasterizedSvgs[pending.svgRasterId]) {
      var b64 = rasterizedSvgs[pending.svgRasterId];
      buffer = Buffer.from(b64, "base64");
      hash = computeSHA1(buffer);
      if (!doc.images) doc.images = new Map();
      doc.images.set(hash, buffer);
    } else if (pending.url && assetManager && assetManager.cache.has(pending.url)) {
      var cached = assetManager.cache.get(pending.url);
      buffer = cached.buffer;
      hash = cached.hash;
      if (!doc.images) doc.images = new Map();
      doc.images.set(hash, cached.buffer);
    } else {
      continue;
    }

    var hashBytes = computeSHA1Bytes(buffer);

    var targetNode = null;
    for (var n of doc.message.nodeChanges) {
      if (n.guid && n.guid.localID === pending.nodeGuid.localID) { targetNode = n; break; }
    }
    if (targetNode) {
      targetNode.fillPaints = [{
        type: "IMAGE",
        opacity: 1, visible: true, blendMode: "NORMAL",
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
      pageGuidLocal = n.guid;
      break;
    }
  }

  var removed = 0;
  var changed = true;
  while (changed) {
    changed = false;
    for (var i = nodes.length - 1; i >= 0; i--) {
      var node = nodes[i];
      if (node.type !== "FRAME") continue;
      if (pageGuidLocal && node.guid.localID === pageGuidLocal.localID) continue;
      if (node.name === "Components") continue;

      if (!isNodeEmpty(node)) continue;

      var children = [];
      for (var j = 0; j < nodes.length; j++) {
        var c = nodes[j];
        if (c.parentIndex && c.parentIndex.guid && c.parentIndex.guid.localID === node.guid.localID) {
          children.push(c);
        }
      }

      if (children.length === 0) {
        nodes.splice(i, 1);
        removed++;
        changed = true;
        continue;
      }

      if (children.length === 1) {
        var child = children[0];
        child.parentIndex = { guid: node.parentIndex.guid, position: node.parentIndex.position };
        if (child.transform && node.transform) {
          child.transform = {
            m00: 1, m01: 0,
            m02: Math.round((child.transform.m02 || 0) + (node.transform.m02 || 0)),
            m10: 0, m11: 1,
            m12: Math.round((child.transform.m12 || 0) + (node.transform.m12 || 0)),
          };
        }
        if (!child.pluginData || child.pluginData.length === 0) {
          child.pluginData = pluginData(child.type === "TEXT");
        }
        nodes.splice(i, 1);
        removed++;
        changed = true;
      }
    }
  }
  return removed;
}

function buildDesignTokens(doc, canvasGuid, domTree, ctx) {
  var tokens = extractDesignTokens(domTree);

  var varSetGuid = guid(1, ctx.nextId++);
  var modeId = guid(1, ctx.nextId++);

  doc.message.nodeChanges.push({
    guid: varSetGuid, type: "VARIABLE_SET", name: "Design Tokens",
    phase: "CREATED",
    parentIndex: { guid: canvasGuid, position: "!" },
    strokeAlign: "CENTER", strokeJoin: "BEVEL",
    variableSetModes: [{ id: modeId, name: "Default", sortPosition: "!" }],
  });

  var posIdx = 0;
  for (var hex of tokens.colors) {
    var c = parseColor(hex);
    if (!c) continue;
    var parts = hex.replace("#", "").match(/.{2}/g);
    var colorName = "Color/" + parts.map(function(p) { return parseInt(p, 16); }).join("-");
    doc.message.nodeChanges.push({
      guid: guid(1, ctx.nextId++), type: "VARIABLE", name: colorName,
      phase: "CREATED",
      parentIndex: { guid: canvasGuid, position: zOrderChar(posIdx++) },
      strokeAlign: "CENTER", strokeJoin: "BEVEL",
      variableSetID: varSetGuid,
      variableResolvedType: "COLOR",
      variableDataValues: {
        entries: [{ modeID: modeId, variableData: { value: { colorValue: c }, dataType: "COLOR", resolvedDataType: "COLOR" } }],
      },
      variableScopes: ["ALL_SCOPES"],
    });
  }

  for (var sp of tokens.spacing) {
    doc.message.nodeChanges.push({
      guid: guid(1, ctx.nextId++), type: "VARIABLE", name: "Space/" + sp,
      phase: "CREATED",
      parentIndex: { guid: canvasGuid, position: zOrderChar(posIdx++) },
      strokeAlign: "CENTER", strokeJoin: "BEVEL",
      variableSetID: varSetGuid,
      variableResolvedType: "FLOAT",
      variableDataValues: {
        entries: [{ modeID: modeId, variableData: { value: { floatValue: sp }, dataType: "FLOAT", resolvedDataType: "FLOAT" } }],
      },
      variableScopes: ["ALL_SCOPES"],
    });
  }

  for (var r of tokens.radius) {
    doc.message.nodeChanges.push({
      guid: guid(1, ctx.nextId++), type: "VARIABLE", name: "Radius/" + r,
      phase: "CREATED",
      parentIndex: { guid: canvasGuid, position: zOrderChar(posIdx++) },
      strokeAlign: "CENTER", strokeJoin: "BEVEL",
      variableSetID: varSetGuid,
      variableResolvedType: "FLOAT",
      variableDataValues: {
        entries: [{ modeID: modeId, variableData: { value: { floatValue: r }, dataType: "FLOAT", resolvedDataType: "FLOAT" } }],
      },
      variableScopes: ["ALL_SCOPES"],
    });
  }

  for (var font of tokens.fonts) {
    doc.message.nodeChanges.push({
      guid: guid(1, ctx.nextId++), type: "VARIABLE", name: "Font/" + font.substring(0, 30),
      phase: "CREATED",
      parentIndex: { guid: canvasGuid, position: zOrderChar(posIdx++) },
      strokeAlign: "CENTER", strokeJoin: "BEVEL",
      variableSetID: varSetGuid,
      variableResolvedType: "STRING",
      variableDataValues: {
        entries: [{ modeID: modeId, variableData: { value: { stringValue: font }, dataType: "STRING", resolvedDataType: "STRING" } }],
      },
      variableScopes: ["ALL_SCOPES"],
    });
  }
}

function buildDocument(domTree, pageWidth, pageHeight, pageName, assetManager, rasterizedSvgs) {
  var ctx = {
    nextId: 500,
    pageGuid: null,
    pendingImages: [],
  };

  var doc = createEmptyFigDoc();
  for (var n of doc.message.nodeChanges) {
    if (n.guid && n.guid.localID >= ctx.nextId) ctx.nextId = n.guid.localID + 1;
  }

  var canvasGuid = doc.message.nodeChanges.find(function(n) { return n.type === "CANVAS"; }).guid;

  buildDesignTokens(doc, canvasGuid, domTree, ctx);

  ctx.pageGuid = guid(1, ctx.nextId++);
  doc.message.nodeChanges.push({
    guid: ctx.pageGuid, type: "FRAME", name: pageName,
    phase: "CREATED",
    parentIndex: { guid: canvasGuid, position: "!" },
    visible: true, opacity: 1,
    size: { x: pageWidth, y: pageHeight },
    transform: { m00: 1, m01: 0, m02: 0, m10: 0, m11: 1, m12: 0 },
    frameMaskDisabled: false,
    pluginData: pluginData(false),
  });

  var allNodes = buildNodes(domTree, ctx.pageGuid, 0, 0, 0, assetManager, doc, false, undefined, ctx);
  doc.message.nodeChanges.push(...allNodes);

  injectPendingImages(doc, ctx.pendingImages, assetManager, rasterizedSvgs);

  var removedCount = flattenTree(doc);

  return doc;
}

module.exports = { buildDocument };
