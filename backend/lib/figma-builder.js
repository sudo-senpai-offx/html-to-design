const { createEmptyFigDoc, nodeId } = require("openfig-core");
const {
  solidFill, resolveFills, resolveImageFill, parseShadow,
  getStroke, getRadius, fontFamily, fontWeight,
  makePos, zOrderChar, guid, pluginData, readableName,
  parseColor, computeSHA1, computeSHA1Bytes,
} = require("./utils");
const { extractStyles } = require("./style-extractor");
const { detectAutoLayout } = require("./layout");

function mapJustifyContent(jc) {
  if (jc === "center") return "CENTER";
  if (jc === "flex-end" || jc === "end") return "MAX";
  if (jc === "space-between") return "SPACE_BETWEEN";
  if (jc === "space-around" || jc === "space-evenly") return "SPACE_EVENLY";
  return "MIN";
}

function mapAlignItems(ai) {
  if (ai === "center") return "CENTER";
  if (ai === "flex-end" || ai === "end") return "MAX";
  if (ai === "stretch") return "STRETCH";
  if (ai === "baseline") return "BASELINE";
  return "MIN";
}

function mapTextDecoration(td) {
  if (!td) return undefined;
  if (td.includes("underline")) return "UNDERLINE";
  if (td.includes("line-through")) return "STRIKETHROUGH";
  return undefined;
}

function createFrameNode(guidVal, name, parentGuid, position, size, transform, extra) {
  var node = {
    guid: guidVal, type: "FRAME", name: name,
    phase: "CREATED", parentIndex: { guid: parentGuid, position: position },
    visible: true, opacity: 1,
    size: { x: Math.max(size.x, 1), y: Math.max(size.y, 1) },
    transform: transform,
    fillPaints: [],
    strokeWeight: 0, strokeAlign: "OUTSIDE",
    cornerRadius: 0,
    frameMaskDisabled: true,
    pluginData: pluginData(false),
  };
  if (extra) {
    for (var k in extra) { node[k] = extra[k]; }
  }
  return node;
}

function createRectNode(guidVal, name, parentGuid, position, size, transform, fills, extra) {
  var node = {
    guid: guidVal, type: "RECTANGLE", name: name,
    phase: "CREATED", parentIndex: { guid: parentGuid, position: position },
    visible: true, opacity: 1,
    size: { x: Math.max(size.x, 1), y: Math.max(size.y, 1) },
    transform: transform,
    fillPaints: fills || [],
    strokeWeight: 0, strokeAlign: "OUTSIDE",
    cornerRadius: 0,
    frameMaskDisabled: true,
    pluginData: pluginData(false),
  };
  if (extra) {
    for (var k in extra) { node[k] = extra[k]; }
  }
  return node;
}

function createTextNode(guidVal, name, parentGuid, position, size, transform, textContent, fontProps, fillProps, extra) {
  var node = {
    guid: guidVal, type: "TEXT", name: name,
    phase: "CREATED", parentIndex: { guid: parentGuid, position: position },
    visible: true, opacity: 1,
    size: { x: Math.max(size.x, 1), y: Math.max(size.y, 1) },
    transform: transform,
    textData: { characters: textContent },
    fontName: { family: fontProps.family || "Inter", style: fontProps.style || "Regular", postscript: "" },
    fontSize: fontProps.size || 16,
    lineHeight: { value: fontProps.lineHeight || 24, units: "PIXELS" },
    letterSpacing: { value: fontProps.letterSpacing || 0, units: "PIXELS" },
    textAutoResize: "WIDTH_AND_HEIGHT",
    textAlignHorizontal: fontProps.align || "LEFT",
    textAlignVertical: "TOP",
    fillPaints: fillProps || [{ type: "SOLID", color: { r: 0.1, g: 0.1, b: 0.1, a: 1 }, opacity: 1, visible: true, blendMode: "NORMAL" }],
    strokeWeight: 0, strokeAlign: "OUTSIDE",
    pluginData: pluginData(true),
  };
  if (extra) {
    for (var k in extra) { node[k] = extra[k]; }
  }
  return node;
}

async function convertNode(treeNode, parentGuid, parentElement, childIndex, assetManager, doc, ctx, parentAutoLayout) {
  if (!treeNode || !treeNode.element) return [];
  var nodes = [];
  var el = treeNode.element;
  var tag = el.tag;
  var cls = el.cls || "";
  var props = el.props || {};
  var vpX = el.x, vpY = el.y, w = el.w, h = el.h;

  var display = props["display"] || "block";
  var visibility = props["visibility"] || "visible";
  var opacityVal = parseFloat(props["opacity"]);
  if (display === "none" || visibility === "hidden") return [];
  if (!isNaN(opacityVal) && opacityVal < 0.01) return [];

  var isSvg = ["svg","path","circle","rect","line","polyline","polygon","ellipse"].indexOf(tag) >= 0;
  var isPseudo = tag === "pseudo-before" || tag === "pseudo-after";
  var isTextInput = tag === "input" || tag === "textarea" || tag === "select";
  var isButton = tag === "button" || cls.includes("btn") || cls.includes("button");
  var isImage = tag === "img";
  var hasText = el.text && el.text.length > 0;
  var childCount = treeNode.children.length;

  var s = extractStyles(props, w, h);

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

  var relX = parentElement ? vpX - parentElement.x : 0;
  var relY = parentElement ? vpY - parentElement.y : 0;

  if (parentAutoLayout) {
    relX = 0;
    relY = 0;
  }

  var layout = detectAutoLayout(el, childCount);
  var useAutoLayout = layout.isAutoLayout;

  if (w > 0 && h > 0) {
    containerGuid = guid(1, ctx.nextId++);
    var isContainer = !isSvg && !isImage && (childCount > 0 || hasText);
    var nodeType = "RECTANGLE";
    if (tag === "circle" || tag === "ellipse") nodeType = "ELLIPSE";
    if (isContainer) nodeType = "FRAME";

    var extra = {
      cornerRadius: isSvg ? 0 : s.radius,
      effects: s.effects,
      frameMaskDisabled: clipsContent ? false : true,
    };

    var node;
    if (nodeType === "FRAME") {
      var autoLayoutProps = {};
      if (useAutoLayout) {
        autoLayoutProps.stackMode = layout.stackMode;
        autoLayoutProps.stackSpacing = layout.stackSpacing;
        autoLayoutProps.stackJustify = layout.stackJustify;
        autoLayoutProps.stackCounterAlign = layout.stackCounterAlign;
        if (layout.stackWrapEnabled) {
          autoLayoutProps.stackWrap = "WRAP";
        }
        if (layout.stackPaddingTop > 0 || layout.stackPaddingRight > 0 ||
            layout.stackPaddingBottom > 0 || layout.stackPaddingLeft > 0) {
          autoLayoutProps.stackPaddingTop = layout.stackPaddingTop;
          autoLayoutProps.stackPaddingRight = layout.stackPaddingRight;
          autoLayoutProps.stackPaddingBottom = layout.stackPaddingBottom;
          autoLayoutProps.stackPaddingLeft = layout.stackPaddingLeft;
        }
        autoLayoutProps.stackPrimarySizing = layout.stackPrimarySizing;
        autoLayoutProps.stackCounterSizing = layout.stackCounterSizing;
        if (layout.isGrid) autoLayoutProps.name = name + " [Grid]";
      }

      var allExtra = {};
      for (var k in extra) allExtra[k] = extra[k];
      for (var k2 in autoLayoutProps) allExtra[k2] = autoLayoutProps[k2];
      node = createFrameNode(containerGuid, name, parentGuid, zPos,
        { x: Math.max(w, 1), y: Math.max(h, 1) }, makePos(relX, relY), allExtra);
      node.fillPaints = fill;
      node.strokeWeight = s.stroke.weight;
      node.strokeAlign = s.stroke.weight > 0 ? "INSIDE" : "OUTSIDE";
      node.strokePaints = s.stroke.paints;
    } else if (nodeType === "ELLIPSE") {
      node = {
        guid: containerGuid, type: "ELLIPSE", name: name,
        phase: "CREATED", parentIndex: { guid: parentGuid, position: zPos },
        visible: true, opacity: s.opacity,
        size: { x: Math.max(w, 1), y: Math.max(h, 1) },
        transform: makePos(relX, relY),
        fillPaints: fill, strokeWeight: s.stroke.weight,
        strokeAlign: s.stroke.weight > 0 ? "INSIDE" : "OUTSIDE",
        strokePaints: s.stroke.paints,
        effects: s.effects,
        frameMaskDisabled: true,
        pluginData: pluginData(false),
      };
    } else {
      node = createRectNode(containerGuid, name, parentGuid, zPos,
        { x: Math.max(w, 1), y: Math.max(h, 1) }, makePos(relX, relY), fill, extra);
      node.opacity = s.opacity;
      node.strokeWeight = s.stroke.weight;
      node.strokeAlign = s.stroke.weight > 0 ? "INSIDE" : "OUTSIDE";
      node.strokePaints = s.stroke.paints;
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
    else if (objFit === "none") imgScaleMode = "NONE";

    if (!containerGuid) {
      containerGuid = guid(1, ctx.nextId++);
      nodes.push(createRectNode(containerGuid, (el.alt || "Image").substring(0, 50),
        parentGuid, zPos, { x: Math.max(w, 1), y: Math.max(h, 1) }, makePos(relX, relY),
        solidFill("#f3f4f6"), { cornerRadius: s.radius }));
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
      nodes.push(createRectNode(containerGuid, (el.figmaName || "SVG Icon").substring(0, 50),
        parentGuid, zPos, { x: Math.max(w, 1), y: Math.max(h, 1) }, makePos(relX, relY),
        solidFill("#f3f4f6")));
    }
    ctx.pendingImages.push({ svgRasterId: el.svgRasterId, nodeGuid: containerGuid, scaleMode: "FIT" });
  } else if (isSvg && el.svgPaths && el.svgPaths.length > 0 && !containerGuid) {
    containerGuid = guid(1, ctx.nextId++);
    var svgFill2 = parseColor(el.attrs && el.attrs.fill);
    nodes.push(createRectNode(containerGuid, "SVG Icon",
      parentGuid, zPos, { x: Math.max(w, 1), y: Math.max(h, 1) }, makePos(relX, relY),
      svgFill2 ? [{ type: "SOLID", color: svgFill2, opacity: 1, visible: true, blendMode: "NORMAL" }] : fill,
      { effects: s.effects }));
  }

  if (isTextInput) {
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
      if (parentAutoLayout && !containerGuid) { inputX = 0; inputY = 0; }
      nodes.push(createTextNode(guid(1, ctx.nextId++),
        ("Input: " + displayVal).substring(0, 50),
        containerGuid || parentGuid, zOrderChar(0),
        { x: Math.max(w - 32, 10), y: Math.max(h - 28, 10) }, makePos(inputX, inputY),
        displayVal, inputFontProps,
        solidFill(s.textProps ? s.textProps.color : "#1A1A1A")));
    }
  }

  if (isButton && hasText) {
    var btnFontProps = {
      family: fontFamily(props["font-family"]) || "Inter",
      style: fontWeight(props["font-weight"] || "600"),
      size: parseFloat(props["font-size"]) || 16,
      lineHeight: (parseFloat(props["font-size"]) || 16) * 1.4,
      align: "CENTER",
    };
    var btnX = 0, btnY = 0;
    if (!containerGuid && !parentAutoLayout) { btnX = relX; btnY = relY; }
    nodes.push(createTextNode(guid(1, ctx.nextId++),
      el.text.substring(0, 50),
      containerGuid || parentGuid, zOrderChar(0),
      { x: Math.max(w, 10), y: Math.max(h, 10) }, makePos(btnX, btnY),
      el.text, btnFontProps,
      solidFill(props["color"] || "#FFFFFF")));
  }

  if (hasText && !isTextInput && !isButton) {
    var ff = fontFamily(props["font-family"]);
    var textFill = solidFill(props["color"] || "#1A1A1A");
    if (s.textProps && s.textProps.color) {
      var tc = parseColor(s.textProps.color);
      if (tc && tc.a > 0.01) textFill = solidFill(s.textProps.color);
    }

    var textAutoResize = "HEIGHT";
    var textTruncation = undefined;
    var whiteSpace = props["white-space"] || "normal";
    var textOverflow = props["text-overflow"] || "clip";
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
    var textDecoration = s.textProps ? mapTextDecoration(props["text-decoration"]) : undefined;

    var textX = 0, textY = 0;
    if (!containerGuid && !parentAutoLayout) {
      textX = relX;
      textY = relY;
    }

    var fontWeightVal = fontWeight(props["font-weight"] || "400");
    var fontStyleVal = props["font-style"] === "italic" ? " Italic" : "";
    var fullStyle = fontWeightVal + fontStyleVal;

    var textNode = createTextNode(guid(1, ctx.nextId++),
      displayText.substring(0, 60),
      containerGuid || parentGuid, zOrderChar(childCount > 0 ? 99 : 0),
      { x: Math.max(w, 1), y: Math.max(h, 1) }, makePos(textX, textY),
      displayText,
      {
        family: ff, style: fullStyle, size: fontSize,
        lineHeight: lineHeightVal, letterSpacing: letterSpacing,
        align: s.textProps ? s.textProps.align : "LEFT",
      }, textFill);

    if (textDecoration) textNode.textDecoration = textDecoration;
    if (textTruncation) textNode.textTruncation = textTruncation;
    if (allEffects.length > 0) textNode.effects = allEffects;
    textNode.opacity = s.opacity;
    if (textAutoResize !== "WIDTH_AND_HEIGHT") textNode.textAutoResize = textAutoResize;
    nodes.push(textNode);
  }

  for (var i = 0; i < treeNode.children.length; i++) {
    var childNodes = await convertNode(treeNode.children[i], containerGuid || parentGuid, el, i, assetManager, doc, ctx, useAutoLayout);
    nodes.push(...childNodes);
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

function generateThumbnail(tree, pageWidth, pageHeight, doc) {
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

    function drawNode(treeNode, offsetX, offsetY) {
      if (!treeNode || !treeNode.element) return;
      var el = treeNode.element;
      var nodeProps = el.props || {};
      var x = (el.x || 0) + offsetX;
      var y = (el.y || 0) + offsetY;
      var nw = el.w || 0;
      var nh = el.h || 0;
      if (nw < 1 || nh < 1) return;

      var nDisplay = nodeProps["display"] || "block";
      var nVisibility = nodeProps["visibility"] || "visible";
      var nOpacity = parseFloat(nodeProps["opacity"]);
      if (nDisplay === "none" || nVisibility === "hidden") return;
      if (!isNaN(nOpacity) && nOpacity < 0.01) return;

      var bgColor = nodeProps["background-color"];
      if (bgColor && bgColor !== "transparent") {
        var m = bgColor.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
        if (m) {
          ctx.save();
          ctx.globalAlpha = nOpacity || 1;
          ctx.fillStyle = "rgb(" + m[1] + "," + m[2] + "," + m[3] + ")";
          var radius = parseFloat(nodeProps["border-radius"]) || 0;
          if (radius > 0) {
            ctx.beginPath();
            ctx.roundRect(x, y, nw, nh, radius);
            ctx.fill();
          } else {
            ctx.fillRect(x, y, nw, nh);
          }
          ctx.restore();
        }
      }

      var text = el.text || "";
      if (text && text.length > 0) {
        var fontSize = parseFloat(nodeProps["font-size"]) || 14;
        var color = nodeProps["color"] || "#000000";
        ctx.save();
        ctx.fillStyle = color;
        ctx.font = fontSize + "px sans-serif";
        ctx.textBaseline = "top";
        var maxW = nw - 8;
        var displayText = text.length > 40 ? text.substring(0, 37) + "..." : text;
        ctx.fillText(displayText, x + 4, y + 4, maxW);
        ctx.restore();
      }

      if (treeNode.children) {
        for (var ci = 0; ci < treeNode.children.length; ci++) {
          drawNode(treeNode.children[ci], offsetX, offsetY);
        }
      }
    }

    if (tree) drawNode(tree, 0, 0);
    ctx.restore();

    var buf = canvas.toBuffer("image/png");
    doc.thumbnail = new Uint8Array(buf);
  } catch (e) {
    // keep default thumbnail on error
  }
}

async function buildDocument(tree, pageWidth, pageHeight, pageName, assetManager, rasterizedSvgs) {
  var ctx = { nextId: 500, pageGuid: null, pendingImages: [] };
  var doc = createEmptyFigDoc();

  for (var n of doc.message.nodeChanges) {
    if (n.guid && n.guid.localID >= ctx.nextId) ctx.nextId = n.guid.localID + 1;
  }
  var canvasGuid = doc.message.nodeChanges.find(function(n) { return n.type === "CANVAS"; }).guid;

  ctx.pageGuid = guid(1, ctx.nextId++);
  doc.message.nodeChanges.push({
    guid: ctx.pageGuid, type: "FRAME", name: pageName || "HTML Export",
    phase: "CREATED", parentIndex: { guid: canvasGuid, position: "!" },
    visible: true, opacity: 1,
    size: { x: pageWidth, y: pageHeight },
    transform: { m00: 1, m01: 0, m02: 0, m10: 0, m11: 1, m12: 0 },
    frameMaskDisabled: false,
    pluginData: pluginData(false),
  });

  var pageElement = tree.element;
  var allNodes = [];
  for (var i = 0; i < tree.children.length; i++) {
    var childNodes = await convertNode(tree.children[i], ctx.pageGuid, pageElement, i, assetManager, doc, ctx, false);
    allNodes.push(...childNodes);
  }
  doc.message.nodeChanges.push(...allNodes);
  injectPendingImages(doc, ctx.pendingImages, assetManager, rasterizedSvgs);

  generateThumbnail(tree, pageWidth, pageHeight, doc);
  doc.meta = {
    name: pageName || "HTML Export",
    file_name: pageName || "HTML Export",
    version: 1,
    canvasBackground: { r: 0.1176, g: 0.1176, b: 0.1176, a: 1 },
  };

  return doc;
}

module.exports = { buildDocument };
