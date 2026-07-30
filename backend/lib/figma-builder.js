let _SceneGraph = null;

async function loadSceneGraph() {
  if (!_SceneGraph) {
    var sg = await import("@open-pencil/core/scene-graph");
    _SceneGraph = sg.SceneGraph;
  }
  return _SceneGraph;
}

var {
  solidFill, resolveFills, resolveImageFill, parseShadow,
  getStroke, getRadius, fontFamily, fontWeight,
  parseColor, computeSHA1, readableName,
} = require("./utils");
var { extractStyles } = require("./style-extractor");
var { detectAutoLayout } = require("./layout");

function mapTextDecoration(td) {
  if (!td) return undefined;
  if (td.includes("underline")) return "UNDERLINE";
  if (td.includes("line-through")) return "STRIKETHROUGH";
  return "NONE";
}

var DEFAULT_COLOR = { r: 0, g: 0, b: 0, a: 1 };
var _debugNodeCount = 0;
var _debugEnabled = false;
var GEOMETRY_TOLERANCE = 3.0;

function safeFill(fill) {
  if (!fill.color) fill.color = DEFAULT_COLOR;
  return fill;
}

function toStrokes(stroke) {
  if (!stroke || !stroke.paints || stroke.paints.length === 0 || stroke.weight === 0) return [];
  var p = stroke.paints[0];
  return [{
    color: p.color,
    weight: stroke.weight,
    opacity: 1,
    visible: true,
    align: "INSIDE",
  }];
}

function resolveNodeStyle(nodeType, props, w, h) {
  var tag = nodeType;
  if (tag === "circle" || tag === "ellipse") return "ELLIPSE";
  return "FRAME";
}

function verifyAutoLayout(children, layoutInfo, containerW, containerH) {
  if (!layoutInfo || layoutInfo.mode === "NONE") return false;
  if (!children || children.length < 2) return false;

  var mode = layoutInfo.mode;
  var spacing = layoutInfo.spacing;
  var padding = layoutInfo.padding;
  var justify = layoutInfo.justify;
  var align = layoutInfo.align;
  var wrap = layoutInfo.wrap;

  var paddingStart = (mode === "HORIZONTAL") ? padding.left : padding.top;
  var paddingEnd = (mode === "HORIZONTAL") ? padding.right : padding.bottom;
  var paddingCounterStart = (mode === "HORIZONTAL") ? padding.top : padding.left;
  var paddingCounterEnd = (mode === "HORIZONTAL") ? padding.bottom : padding.right;

  var primarySize = (mode === "HORIZONTAL") ? containerW : containerH;
  var counterSize = (mode === "HORIZONTAL") ? containerH : containerW;
  var availablePrimary = primarySize - paddingStart - paddingEnd;

  var totalChildPrimary = 0;
  var maxChildCounter = 0;
  for (var i = 0; i < children.length; i++) {
    var c = children[i].element;
    if (!c) continue;
    var cPrimary = (mode === "HORIZONTAL") ? c.w : c.h;
    var cCounter = (mode === "HORIZONTAL") ? c.h : c.w;
    totalChildPrimary += cPrimary;
    if (cCounter > maxChildCounter) maxChildCounter = cCounter;
  }

  var totalWithSpacing = totalChildPrimary + spacing * (children.length - 1);
  var numRows = 1;
  if (wrap && availablePrimary > 0) {
    var rowAccum = 0;
    for (var ri = 0; ri < children.length; ri++) {
      var rc = children[ri].element;
      if (!rc) continue;
      var rcp = (mode === "HORIZONTAL") ? rc.w : rc.h;
      if (rowAccum + rcp > availablePrimary && rowAccum > 0) { numRows++; rowAccum = rcp; }
      else { rowAccum += rcp + spacing; }
    }
    totalWithSpacing = totalChildPrimary + spacing * (children.length - numRows);
  }

  var primaryGrowthRatio = totalWithSpacing / Math.max(availablePrimary, 1);
  var fillsSpace = Math.abs(primaryGrowthRatio - 1) < 0.15;

  var startX = paddingStart;
  if (justify === "CENTER") {
    startX = paddingStart + (availablePrimary - totalWithSpacing) / 2;
  } else if (justify === "MAX") {
    startX = paddingStart + availablePrimary - totalWithSpacing;
  } else if (justify === "SPACE_BETWEEN" && children.length > 1) {
    startX = paddingStart;
  }

  var verifiedCount = 0;
  var currentPrimary = startX;
  var currentRowStartPrimary = startX;
  var rowItems = [];

  for (var i = 0; i < children.length; i++) {
    var c = children[i].element;
    if (!c) continue;
    var cPrimary = (mode === "HORIZONTAL") ? c.w : c.h;
    var cCounter = (mode === "HORIZONTAL") ? c.h : c.w;

    if (wrap && availablePrimary > 0 && (currentPrimary + cPrimary > paddingStart + availablePrimary) && rowItems.length > 0) {
      currentPrimary = paddingStart;
      currentRowStartPrimary = paddingStart;
      rowItems = [];
    }

    var expectedPrimary = currentPrimary;
    var expectedCounter = paddingCounterStart;

    if (justify === "SPACE_BETWEEN" && rowItems.length > 0 && !wrap) {
      var gap = (availablePrimary - totalChildPrimary) / (children.length - 1);
      expectedPrimary = currentRowStartPrimary + gap * rowItems.length;
      currentPrimary = expectedPrimary;
    }

    var expectedX, expectedY;
    if (mode === "HORIZONTAL") { expectedX = expectedPrimary; expectedY = expectedCounter; }
    else { expectedX = expectedCounter; expectedY = expectedPrimary; }

    var actualPrimary = (mode === "HORIZONTAL") ? c.x : c.y;
    var actualCounter = (mode === "HORIZONTAL") ? c.y : c.x;

    var primaryErr = Math.abs(actualPrimary - expectedPrimary);
    var counterErr = Math.abs(actualCounter - expectedCounter);

    if (primaryErr < GEOMETRY_TOLERANCE && counterErr < GEOMETRY_TOLERANCE * 2) {
      verifiedCount++;
    }

    currentPrimary += cPrimary + spacing;
    rowItems.push(c);
  }

  var verificationRate = children.length > 0 ? verifiedCount / children.length : 0;
  return verificationRate > 0.7;
}

async function convertNode(treeNode, parentId, parentElement, childIndex, assetManager, graph, ctx, parentAutoLayout) {
  if (!treeNode || !treeNode.element) return;
  var el = treeNode.element;
  var tag = el.tag;
  var cls = el.cls || "";
  var props = el.props || {};
  var vpX = el.x, vpY = el.y, w = el.w, h = el.h;

  var display = props["display"] || "block";
  var visibility = props["visibility"] || "visible";
  var opacityVal = parseFloat(props["opacity"]);

  if (el.isVisible === false) return;
  if (display === "none" || visibility === "hidden") return;
  if (!isNaN(opacityVal) && opacityVal < 0.01) return;

  var isSvg = ["svg","path","circle","rect","line","polyline","polygon","ellipse"].indexOf(tag) >= 0;
  var isPseudo = tag === "pseudo-before" || tag === "pseudo-after";
  var isTextInput = tag === "input" || tag === "textarea" || tag === "select";
  var isButton = tag === "button" || cls.includes("btn") || cls.includes("button");
  var isImage = tag === "img";
  var hasText = el.text && el.text.length > 0;
  var childCount = treeNode.children.length;

  var s = extractStyles(props, w, h);

  var fill = s.fills.slice().map(safeFill);
  if (isButton && fill.length === 0) fill = solidFill(props["background-color"] || "#3B82F6");
  if (isSvg && el.attrs && el.attrs.fill && el.attrs.fill !== "none") {
    var svgFill = parseColor(el.attrs.fill);
    if (svgFill) fill = [{ type: "SOLID", color: svgFill, opacity: parseFloat(el.attrs.opacity) || 1, visible: true, blendMode: "NORMAL" }];
  }

  var blendMode = "NORMAL";
  var mb = props["mix-blend-mode"] || "normal";
  var blendMap = { "multiply": "MULTIPLY", "screen": "SCREEN", "overlay": "OVERLAY", "darken": "DARKEN", "lighten": "LIGHTEN", "color-dodge": "COLOR_DODGE", "color-burn": "COLOR_BURN", "hard-light": "HARD_LIGHT", "soft-light": "SOFT_LIGHT", "difference": "DIFFERENCE", "exclusion": "EXCLUSION", "hue": "HUE", "saturation": "SATURATION", "color": "COLOR", "luminosity": "LUMINOSITY" };
  if (blendMap[mb]) blendMode = blendMap[mb];

  var aspectRatio = props["aspect-ratio"];
  if (aspectRatio && aspectRatio !== "auto") {
    var arParts = aspectRatio.split("/");
    if (arParts.length === 2) {
      var ar = parseFloat(arParts[0]) / Math.max(parseFloat(arParts[1]), 0.01);
      if (ar > 0 && (w <= 0 || h <= 0)) {
        if (w > 0) h = Math.round(w / ar);
        else if (h > 0) w = Math.round(h * ar);
      }
    }
  }

  var name = readableName(tag, cls, hasText ? el.text : "");
  if (isPseudo) name = (tag === "pseudo-before" ? "::before " : "::after ") + (el.text || "").substring(0, 20);
  if (cls) name = cls.split(/\s+/)[0].replace(/^[.#]/, "") + " [" + tag + "]";
  name = name.substring(0, 50);

  var overflow = props["overflow"] || "visible";
  var clipsContent = overflow === "hidden" || overflow === "scroll" || overflow === "auto";

  if (w < 2 || h < 2) return;

  var relX = parentElement ? vpX - parentElement.x : 0;
  var relY = parentElement ? vpY - parentElement.y : 0;

  var isContainer = !isSvg && !isImage && (childCount > 0 || hasText);

  var useAutoLayout = false;
  var layout = { mode: "NONE", spacing: 0, justify: "MIN", align: "MIN", wrap: false, padding: { top: 0, right: 0, bottom: 0, left: 0 } };

  if (isContainer && childCount >= 2 && !isSvg) {
    var detected = detectAutoLayout(el, childCount);
    if (detected && detected.isAutoLayout) {
      layout = {
        mode: detected.stackMode,
        spacing: detected.stackSpacing,
        justify: detected.stackJustify,
        align: detected.stackCounterAlign,
        wrap: detected.stackWrapEnabled,
        padding: {
          top: detected.stackPaddingTop,
          right: detected.stackPaddingRight,
          bottom: detected.stackPaddingBottom,
          left: detected.stackPaddingLeft,
        },
      };

      var verified = verifyAutoLayout(treeNode.children, layout, w, h);
      if (verified) {
        useAutoLayout = true;
        if (_debugEnabled && _debugNodeCount <= 5) {
          console.log("    [AL #" + _debugNodeCount + "] " + name.substring(0, 25) + " mode=" + layout.mode + " spacing=" + layout.spacing + " justify=" + layout.justify + " align=" + layout.align + " VERIFIED");
        }
      } else {
        if (_debugEnabled && _debugNodeCount <= 5) {
          console.log("    [AL #" + _debugNodeCount + "] " + name.substring(0, 25) + " mode=" + layout.mode + " FAILED VERIFICATION -> absolute");
        }
        layout = { mode: "NONE", spacing: 0, justify: "MIN", align: "MIN", wrap: false, padding: { top: 0, right: 0, bottom: 0, left: 0 } };
      }
    }
  }

  var nodeType = "RECTANGLE";
  if (tag === "circle" || tag === "ellipse") nodeType = "ELLIPSE";
  if (isContainer) nodeType = "FRAME";

  var nodeId = null;

  if (w > 0 && h > 0) {
    _debugNodeCount++;
    if (_debugEnabled && _debugNodeCount <= 3) {
      console.log("    [NODE #" + _debugNodeCount + "] " + name.substring(0, 30) + " vp=(" + Math.round(vpX) + "," + Math.round(vpY) + "," + Math.round(w) + "," + Math.round(h) + ")");
    }

    var isAbsolute = props["position"] === "absolute" || props["position"] === "fixed";
    if (isAbsolute && parentAutoLayout) {
      relX = Math.round(vpX - (parentElement ? parentElement.x : 0));
      relY = Math.round(vpY - (parentElement ? parentElement.y : 0));
    }

    var overrides = {
      name: name,
      x: Math.round(relX),
      y: Math.round(relY),
      width: Math.max(Math.round(w), 1),
      height: Math.max(Math.round(h), 1),
      opacity: s.opacity,
      fills: fill,
      clipsContent: clipsContent,
      cornerRadius: isSvg ? 0 : s.radius,
      blendMode: blendMode,
    };

    if (s.stroke.weight > 0) {
      overrides.strokes = toStrokes(s.stroke);
    }

    if (s.effects && s.effects.length > 0) {
      overrides.effects = s.effects.slice();
    }
    if (s.blurAmount > 0) {
      if (!overrides.effects) overrides.effects = [];
      overrides.effects.push({ type: "BACKGROUND_BLUR", color: DEFAULT_COLOR, offset: { x: 0, y: 0 }, radius: s.blurAmount, spread: 0, visible: true, opacity: 0.5, blendMode: "NORMAL" });
    }

    if (s.outline) {
      overrides.strokes = [{
        color: s.outline.color,
        weight: s.outline.weight,
        opacity: 1,
        visible: true,
        align: "OUTSIDE",
      }];
    }

    if (nodeType === "FRAME" && useAutoLayout) {
      overrides.layoutMode = layout.mode;
      overrides.itemSpacing = layout.spacing;
      overrides.primaryAxisAlign = layout.justify;
      overrides.counterAxisAlign = layout.align;
      if (layout.wrap) overrides.layoutWrap = "WRAP";
      overrides.paddingTop = layout.padding.top;
      overrides.paddingRight = layout.padding.right;
      overrides.paddingBottom = layout.padding.bottom;
      overrides.paddingLeft = layout.padding.left;
      overrides.primaryAxisSizing = "FIXED";
      overrides.counterAxisSizing = "FIXED";

      if (layout.gridInfo && layout.gridInfo.colCount > 1) {
        overrides.layoutGrids = [{
          pattern: "COLUMNS",
          sectionSize: Math.max(Math.round(w / layout.gridInfo.colCount), 1),
          visible: false,
          color: { r: 0, g: 0, b: 1, a: 0.05 },
        }];
      }

      if (_debugEnabled && _debugNodeCount <= 5) {
        console.log("    [APPLY #" + _debugNodeCount + "] " + name.substring(0, 25) + " layout=" + layout.mode + " grid=" + (layout.gridInfo ? layout.gridInfo.colCount + "c" : "none") + " children=" + treeNode.children.length);
      }
    }

    var node = graph.createNode(nodeType, parentId, overrides);
    nodeId = node.id;

    if (s.bgImageUrl && assetManager) {
      try {
        var imgResult = await assetManager.download(s.bgImageUrl);
        if (imgResult && imgResult.buffer) {
          var imgHash = computeSHA1(imgResult.buffer);
          graph.images.set(imgHash, imgResult.buffer);
          var bgScaleMode = "FILL";
          var bgSize = props["background-size"] || "";
          if (bgSize === "contain") bgScaleMode = "FIT";
          else if (bgSize === "auto") bgScaleMode = "TILE";
          graph.updateNode(nodeId, {
            fills: [{
              type: "IMAGE", color: DEFAULT_COLOR, opacity: 1, visible: true, blendMode: "NORMAL",
              imageHash: imgHash,
              imageScaleMode: bgScaleMode,
            }],
          });
        }
      } catch (e) {}
    }
  }

  if (isImage && el.src && w > 0 && h > 0) {
    var imgScaleMode = "FILL";
    var objFit = props["object-fit"] || "fill";
    if (objFit === "contain") imgScaleMode = "FIT";
    else if (objFit === "none") imgScaleMode = "NONE";

    if (!nodeId) {
      var imgNode = graph.createNode("RECTANGLE", parentId, {
        name: (el.alt || "Image").substring(0, 50),
        x: Math.round(relX), y: Math.round(relY),
        width: Math.max(Math.round(w), 1), height: Math.max(Math.round(h), 1),
        fills: solidFill("#f3f4f6"),
        cornerRadius: s.radius,
      });
      nodeId = imgNode.id;
    }
    try {
      var imgResult2 = await assetManager.download(el.src);
      if (imgResult2 && imgResult2.buffer) {
        var imgHash2 = computeSHA1(imgResult2.buffer);
        graph.images.set(imgHash2, imgResult2.buffer);
        graph.updateNode(nodeId, {
          fills: [{
            type: "IMAGE", color: DEFAULT_COLOR, opacity: 1, visible: true, blendMode: "NORMAL",
            imageHash: imgHash2,
            imageScaleMode: imgScaleMode,
          }],
        });
      }
    } catch (e) {}
  }

  if (isSvg && el.svgRasterId !== undefined && el.svgRasterId >= 0 && w > 0 && h > 0) {
    if (!nodeId) {
      var svgNode = graph.createNode("RECTANGLE", parentId, {
        name: (el.figmaName || "SVG Icon").substring(0, 50),
        x: Math.round(relX), y: Math.round(relY),
        width: Math.max(Math.round(w), 1), height: Math.max(Math.round(h), 1),
        fills: solidFill("#f3f4f6"),
      });
      nodeId = svgNode.id;
    }
    ctx.pendingImages.push({ svgRasterId: el.svgRasterId, nodeId: nodeId, scaleMode: "FIT" });
  } else if (isSvg && el.svgPaths && el.svgPaths.length > 0 && !nodeId) {
    var svgFill2 = parseColor(el.attrs && el.attrs.fill);
    var svgRect = graph.createNode("RECTANGLE", parentId, {
      name: "SVG Icon",
      x: Math.round(relX), y: Math.round(relY),
      width: Math.max(Math.round(w), 1), height: Math.max(Math.round(h), 1),
      fills: svgFill2 ? [{ type: "SOLID", color: svgFill2, opacity: 1, visible: true, blendMode: "NORMAL" }] : fill,
      effects: s.effects && s.effects.length > 0 ? s.effects : undefined,
    });
    nodeId = svgRect.id;
  }

  if (isTextInput && w > 0 && h > 0) {
    var displayVal = el.value || el.placeholder || "";
    if (displayVal) {
      var inputFontProps = {
        family: fontFamily(props["font-family"]),
        style: fontWeight(props["font-weight"]),
        size: parseFloat(props["font-size"]) || 16,
        lineHeight: (parseFloat(props["font-size"]) || 16) * 1.4,
        align: s.textProps ? s.textProps.align : "LEFT",
      };
      var inputX = 16, inputY = 14;
      if (parentAutoLayout) { inputX = 0; inputY = 0; }
      graph.createNode("TEXT", nodeId || parentId, {
        name: ("Input: " + displayVal).substring(0, 50),
        x: inputX, y: inputY,
        width: Math.max(w - 32, 10), height: Math.max(h - 28, 10),
        text: displayVal,
        fontFamily: inputFontProps.family,
        fontWeight: fontWeightNumeric(props["font-weight"] || "400"),
        fontSize: inputFontProps.size,
        lineHeight: inputFontProps.lineHeight,
        textAlignHorizontal: inputFontProps.align === "CENTER" ? "CENTER" : inputFontProps.align === "RIGHT" ? "RIGHT" : "LEFT",
        fills: solidFill(s.textProps ? s.textProps.color : "#1A1A1A"),
        textAutoResize: "WIDTH_AND_HEIGHT",
      });
    }
  }

  if (isButton && hasText && w > 0 && h > 0) {
    var btnX = 0, btnY = 0;
    if (!nodeId && !parentAutoLayout) { btnX = relX; btnY = relY; }
    else if (!nodeId && parentAutoLayout) { btnX = 4; btnY = 4; }
    graph.createNode("TEXT", nodeId || parentId, {
      name: el.text.substring(0, 50),
      x: btnX, y: btnY,
      width: Math.max(w, 10), height: Math.max(h, 10),
      text: el.text,
      fontFamily: fontFamily(props["font-family"]) || "Inter",
      fontWeight: fontWeightNumeric(props["font-weight"] || "600"),
      fontSize: parseFloat(props["font-size"]) || 16,
      lineHeight: (parseFloat(props["font-size"]) || 16) * 1.4,
      textAlignHorizontal: "CENTER",
      textAlignVertical: "CENTER",
      fills: solidFill(props["color"] || "#FFFFFF"),
      textAutoResize: "WIDTH_AND_HEIGHT",
    });
  }

  if (hasText && !isTextInput && !isButton && w > 0 && h > 0) {
    var ff = fontFamily(props["font-family"]);
    var textFill = solidFill(props["color"] || "#1A1A1A");
    if (s.textProps && s.textProps.color) {
      var tc = parseColor(s.textProps.color);
      if (tc && tc.a > 0.01) textFill = solidFill(s.textProps.color);
    }

    var textAutoResize = "HEIGHT";
    var whiteSpace = props["white-space"] || "normal";
    var textOverflow = props["text-overflow"] || "clip";
    if (whiteSpace === "nowrap" || textOverflow === "ellipsis") {
      textAutoResize = "WIDTH_AND_HEIGHT";
    }

    var allEffects = [];
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

    var textDecorationVal = undefined;
    if (props["text-decoration"]) {
      textDecorationVal = mapTextDecoration(props["text-decoration"]);
    }

    var textX = 0, textY = 0;
    if (!nodeId && !parentAutoLayout) {
      textX = relX;
      textY = relY;
    } else if (!nodeId && parentAutoLayout) {
      var padT = parseFloat(props["padding-top"]) || 0;
      var padL = parseFloat(props["padding-left"]) || 0;
      textX = padL;
      textY = padT;
    }

    var fontWeightVal = fontWeightNumeric(props["font-weight"] || "400");
    var fontStyleVal = props["font-style"] === "italic";

    var textAlignH = "LEFT";
    if (s.textProps && s.textProps.align) {
      textAlignH = s.textProps.align;
    }

    var textOverrides = {
      name: displayText.substring(0, 60),
      x: textX, y: textY,
      width: Math.max(w, 1), height: Math.max(h, 1),
      text: displayText,
      fontFamily: ff,
      fontWeight: fontWeightVal,
      italic: fontStyleVal,
      fontSize: fontSize,
      lineHeight: lineHeightVal,
      letterSpacing: letterSpacing,
      textAlignHorizontal: textAlignH,
      textAutoResize: textAutoResize,
      fills: textFill,
    };

    if (textDecorationVal && textDecorationVal !== "NONE") {
      textOverrides.textDecoration = textDecorationVal;
    }
    if (allEffects.length > 0) {
      textOverrides.effects = allEffects;
    }
    textOverrides.opacity = s.opacity;

    graph.createNode("TEXT", nodeId || parentId, textOverrides);
  }

  for (var i = 0; i < treeNode.children.length; i++) {
    await convertNode(treeNode.children[i], nodeId || parentId, el, i, assetManager, graph, ctx, useAutoLayout);
  }
}

function fontWeightNumeric(w) {
  var n = parseInt(w) || 400;
  return Math.min(Math.max(n, 100), 900);
}

function injectPendingImages(pendingImages, assetManager, rasterizedSvgs, graph) {
  for (var pending of pendingImages) {
    var hash = null, buffer = null;
    if (pending.svgRasterId !== undefined && rasterizedSvgs && rasterizedSvgs[pending.svgRasterId]) {
      buffer = Buffer.from(rasterizedSvgs[pending.svgRasterId], "base64");
      hash = computeSHA1(buffer);
      graph.images.set(hash, buffer);
    } else if (pending.url && assetManager && assetManager.cache.has(pending.url)) {
      var cached = assetManager.cache.get(pending.url);
      buffer = cached.buffer; hash = cached.hash;
      graph.images.set(hash, cached.buffer);
    } else { continue; }
    graph.updateNode(pending.nodeId, {
      fills: [{
        type: "IMAGE", color: DEFAULT_COLOR, opacity: 1, visible: true, blendMode: "NORMAL",
        imageHash: hash,
        imageScaleMode: pending.scaleMode,
      }],
    });
  }
}

async function buildDocument(tree, pageWidth, pageHeight, pageName, assetManager, rasterizedSvgs) {
  _debugNodeCount = 0;
  var SceneGraph = await loadSceneGraph();
  var graph = new SceneGraph();

  var pages = graph.getPages();
  var page = pages[0];

  var rootFrame = graph.createNode("FRAME", page.id, {
    name: pageName || "HTML Export",
    width: Math.round(pageWidth),
    height: Math.round(pageHeight),
    clipsContent: true,
  });

  var ctx = { pendingImages: [] };

  for (var i = 0; i < tree.children.length; i++) {
    await convertNode(tree.children[i], rootFrame.id, tree.element, i, assetManager, graph, ctx, false);
  }
  injectPendingImages(ctx.pendingImages, assetManager, rasterizedSvgs, graph);

  return graph;
}

module.exports = { buildDocument };
