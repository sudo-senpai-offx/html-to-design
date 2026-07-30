var {
  solidFill, parseColor, fontFamily, fontWeight,
  getStroke, getRadius,
} = require("./utils");
var { extractStyles } = require("./style-extractor");

function mapJustifyContent(jc) {
  switch (jc) {
    case "center": return "CENTER";
    case "flex-end": case "end": return "MAX";
    case "space-between": return "SPACE_BETWEEN";
    case "space-around": case "space-evenly": return "SPACE_BETWEEN";
    default: return "MIN";
  }
}

function mapAlignItems(ai) {
  switch (ai) {
    case "center": return "CENTER";
    case "flex-end": case "end": return "MAX";
    case "stretch": return "STRETCH";
    default: return "MIN";
  }
}

function detectAutoLayoutForMCP(el) {
  var props = el.props || {};
  var display = props["display"] || "block";
  var isFlex = display === "flex" || display === "inline-flex";
  var isGrid = display === "grid" || display === "inline-grid";

  if (!isFlex && !isGrid) return null;

  var flexDir = props["flex-direction"] || "row";
  var justifyContent = props["justify-content"] || "flex-start";
  var alignItems = props["align-items"] || "stretch";
  var flexWrap = props["flex-wrap"] || "nowrap";
  var gap = parseFloat(props["gap"]) || parseFloat(props["column-gap"]) || parseFloat(props["row-gap"]) || 0;

  var mode = "NONE";
  if (isFlex) {
    mode = (flexDir === "column" || flexDir === "column-reverse") ? "VERTICAL" : "HORIZONTAL";
  } else if (isGrid) {
    var gridCols = props["grid-template-columns"] || "";
    var colCount = 0;
    var repeatMatch = gridCols.match(/repeat\(\s*(\d+)/);
    if (repeatMatch) colCount = parseInt(repeatMatch[1]);
    else {
      var cols = gridCols.match(/[\d.]+(?:fr|px|%|rem|em|vw)/g);
      colCount = cols ? cols.length : 0;
    }
    mode = colCount > 1 ? "HORIZONTAL" : "VERTICAL";
  }

  if (mode === "NONE") return null;

  return {
    mode: mode,
    spacing: gap,
    justifyContent: mapJustifyContent(justifyContent),
    alignItems: mapAlignItems(alignItems),
    wrap: (flexWrap === "wrap" || flexWrap === "wrap-reverse"),
    padding: {
      top: parseFloat(props["padding-top"]) || 0,
      right: parseFloat(props["padding-right"]) || 0,
      bottom: parseFloat(props["padding-bottom"]) || 0,
      left: parseFloat(props["padding-left"]) || 0,
    },
  };
}

function generatePluginCode(flatElements, tree, pageWidth, pageHeight, pageName) {
  function buildNodeData(treeNode) {
    if (!treeNode || !treeNode.element) return null;
    var el = treeNode.element;
    if (el.tag === "__page__") return null;

    var props = el.props || {};
    var display = props["display"] || "block";
    var visibility = props["visibility"] || "visible";
    var opacity = parseFloat(props["opacity"]);
    if (display === "none" || visibility === "hidden") return null;
    if (!isNaN(opacity) && opacity < 0.01) return null;
    if (el.w < 2 || el.h < 2) return null;

    var s = extractStyles(props, el.w, el.h);
    var isSvg = ["svg","path","circle","rect","line","polyline","polygon","ellipse"].indexOf(el.tag) >= 0;
    var isImage = el.tag === "img";
    var hasText = el.text && el.text.length > 0;
    var isButton = el.tag === "button" || (el.cls || "").includes("btn") || (el.cls || "").includes("button");
    var isTextInput = el.tag === "input" || el.tag === "textarea" || el.tag === "select";

    var childTreeNodes = [];
    for (var ci = 0; ci < treeNode.children.length; ci++) {
      var childData = buildNodeData(treeNode.children[ci]);
      if (childData) childTreeNodes.push(childData);
    }

    var isContainer = !isSvg && !isImage && (childTreeNodes.length > 0 || hasText);
    var nodeType = isContainer ? "frame" : "rectangle";
    if (el.tag === "circle" || el.tag === "ellipse") nodeType = "ellipse";

    var al = detectAutoLayoutForMCP(el);

    var node = {
      type: nodeType,
      name: (el.cls ? el.cls.split(" ")[0] : el.tag || "element").substring(0, 50),
      x: Math.round(el.x),
      y: Math.round(el.y),
      w: Math.round(el.w),
      h: Math.round(el.h),
      fills: [],
      opacity: s.opacity,
      cornerRadius: isSvg ? 0 : s.radius,
      children: childTreeNodes,
    };

    if (s.fills && s.fills.length > 0) {
      node.fills = s.fills.map(function(f) {
        if (f.type === "SOLID" && f.color) {
          return { r: f.color.r, g: f.color.g, b: f.color.b, a: f.color.a };
        }
        return null;
      }).filter(Boolean);
    }
    if (isButton && node.fills.length === 0) {
      var bc = parseColor(props["background-color"] || "#3B82F6");
      if (bc) node.fills = [{ r: bc.r, g: bc.g, b: bc.b, a: bc.a }];
    }

    if (s.stroke && s.stroke.weight > 0) {
      var strokeColor = s.stroke.paints[0] && s.stroke.paints[0].color;
      if (strokeColor) {
        node.stroke = { color: strokeColor, weight: s.stroke.weight };
      }
    }

    if (s.effects && s.effects.length > 0) {
      node.effects = s.effects;
    }

    if (al) {
      node.autoLayout = al;
    }

    if (hasText && !isTextInput) {
      var ff = fontFamily(props["font-family"]);
      var fw = fontWeight(props["font-weight"]);
      var fs = parseFloat(props["font-size"]) || 16;
      var lh = parseFloat(props["line-height"]);
      if (!lh || isNaN(lh)) lh = fs * 1.6;
      var ls = parseFloat(props["letter-spacing"]) || 0;
      var ta = (props["text-align"] || "left").toUpperCase();
      if (ta === "START") ta = "LEFT";
      if (ta === "END") ta = "RIGHT";

      var textFill = parseColor(props["color"] || "#1A1A1A");
      if (s.textProps && s.textProps.color) {
        var tc = parseColor(s.textProps.color);
        if (tc && tc.a > 0.01) textFill = tc;
      }

      node.text = {
        content: el.text,
        fontFamily: ff,
        fontWeight: fw,
        fontSize: fs,
        lineHeight: lh,
        letterSpacing: ls,
        textAlignHorizontal: ta,
        fills: textFill ? [{ r: textFill.r, g: textFill.g, b: textFill.b, a: textFill.a }] : [],
      };
    }

    if (isTextInput) {
      var displayVal = el.value || el.placeholder || "";
      if (displayVal) {
        node.text = {
          content: displayVal,
          fontFamily: fontFamily(props["font-family"]),
          fontWeight: fontWeight(props["font-weight"]),
          fontSize: parseFloat(props["font-size"]) || 16,
          lineHeight: (parseFloat(props["font-size"]) || 16) * 1.4,
          textAlignHorizontal: "LEFT",
          fills: [{ r: 0.1, g: 0.1, b: 0.1, a: 1 }],
        };
      }
    }

    return node;
  }

  var topLevelNodes = [];
  for (var i = 0; i < tree.children.length; i++) {
    var nd = buildNodeData(tree.children[i]);
    if (nd) topLevelNodes.push(nd);
  }

  var totalCount = 0;
  function countNodes(n) { totalCount++; for (var c of (n.children || [])) countNodes(c); }
  for (var n of topLevelNodes) countNodes(n);

  var script = buildFigmaPluginScript(topLevelNodes, pageWidth, pageHeight, pageName, totalCount);
  return script;
}

function buildFigmaPluginScript(nodes, pageWidth, pageHeight, pageName, totalCount) {
  var lines = [];
  lines.push('(async function() {');
  lines.push('  var page = figma.currentPage;');
  lines.push('  var root = figma.createFrame();');
  lines.push('  root.name = ' + JSON.stringify(pageName) + ';');
  lines.push('  root.resize(' + Math.round(pageWidth) + ', ' + Math.round(pageHeight) + ');');
  lines.push('  root.clipsContent = true;');
  lines.push('');

  var nodeMap = {};
  var nodeId = 0;

  function emitNode(n, parentVar) {
    var varName = "n" + (nodeId++);
    nodeMap[n.name + "_" + n.x + "_" + n.y] = varName;

    var isText = !!n.text;
    var createFn = isText ? "createText" : (n.type === "ellipse" ? "createEllipse" : "createFrame");

    lines.push('  var ' + varName + ' = ' + parentVar + '.' + createFn + '();');
    lines.push('  ' + varName + '.name = ' + JSON.stringify(n.name) + ';');
    lines.push('  ' + varName + '.x = ' + n.x + ';');
    lines.push('  ' + varName + '.y = ' + n.y + ';');
    lines.push('  ' + varName + '.resize(' + n.w + ', ' + n.h + ');');
    lines.push('  ' + varName + '.opacity = ' + n.opacity + ';');

    if (n.cornerRadius > 0) {
      lines.push('  ' + varName + '.cornerRadius = ' + n.cornerRadius + ';');
    }

    if (n.fills && n.fills.length > 0) {
      var f = n.fills[0];
      lines.push('  ' + varName + '.fills = [{ type: "SOLID", color: {r: ' + f.r + ', g: ' + f.g + ', b: ' + f.b + '}, opacity: ' + (f.a || 1) + ' }];');
    }

    if (n.stroke) {
      lines.push('  ' + varName + '.strokes = [{ type: "SOLID", color: {r: ' + n.stroke.color.r + ', g: ' + n.stroke.color.g + ', b: ' + n.stroke.color.b + '} }];');
      lines.push('  ' + varName + '.strokeWeight = ' + n.stroke.weight + ';');
    }

    if (n.autoLayout) {
      var al = n.autoLayout;
      lines.push('  ' + varName + '.layoutMode = ' + JSON.stringify(al.mode) + ';');
      lines.push('  ' + varName + '.itemSpacing = ' + al.spacing + ';');
      lines.push('  ' + varName + '.primaryAxisAlignItems = ' + JSON.stringify(al.justifyContent) + ';');
      lines.push('  ' + varName + '.counterAxisAlignItems = ' + JSON.stringify(al.alignItems) + ';');
      if (al.wrap) lines.push('  ' + varName + '.layoutWrap = "WRAP";');
      lines.push('  ' + varName + '.paddingTop = ' + al.padding.top + ';');
      lines.push('  ' + varName + '.paddingRight = ' + al.padding.right + ';');
      lines.push('  ' + varName + '.paddingBottom = ' + al.padding.bottom + ';');
      lines.push('  ' + varName + '.paddingLeft = ' + al.padding.left + ';');
    }

    if (isText) {
      var t = n.text;
      lines.push('  ' + varName + '.characters = ' + JSON.stringify(t.content) + ';');
      lines.push('  ' + varName + '.fontSize = ' + t.fontSize + ';');
      lines.push('  ' + varName + '.fontName = { family: ' + JSON.stringify(t.fontFamily) + ', style: ' + JSON.stringify(t.fontWeight) + ' };');
      lines.push('  ' + varName + '.lineHeight = { value: ' + t.lineHeight + ', unit: "PIXELS" };');
      if (t.letterSpacing) lines.push('  ' + varName + '.letterSpacing = { value: ' + t.letterSpacing + ', unit: "PIXELS" };');
      lines.push('  ' + varName + '.textAlignHorizontal = ' + JSON.stringify(t.textAlignHorizontal) + ';');
      if (t.fills && t.fills.length > 0) {
        var tf = t.fills[0];
        lines.push('  ' + varName + '.fills = [{ type: "SOLID", color: {r: ' + tf.r + ', g: ' + tf.g + ', b: ' + tf.b + '}, opacity: ' + (tf.a || 1) + ' }];');
      }
    }

    lines.push('');

    if (n.children) {
      for (var ci = 0; ci < n.children.length; ci++) {
        emitNode(n.children[ci], varName);
      }
    }
  }

  for (var i = 0; i < nodes.length; i++) {
    emitNode(nodes[i], "root");
  }

  lines.push('  figma.viewport.scrollAndZoomIntoView([root]);');
  lines.push('  figma.notify("Imported ' + pageName + ' (" + ' + totalCount + ' + " nodes)");');
  lines.push('  return { nodeCount: ' + totalCount + ' };');
  lines.push('})()');

  return lines.join("\n");
}

function convertToFigmaPluginCode(flatElements, tree, pageWidth, pageHeight, options) {
  var pageName = (options && options.pageName) || "HTML Export";
  var script = generatePluginCode(flatElements, tree, pageWidth, pageHeight, pageName);
  return {
    script: script,
    nodeCount: 0,
    description: "Figma Plugin API code — paste into Figma's console or use via MCP use_figma tool",
    usage: {
      directPaste: "Open Figma Dev Console (Ctrl+Shift+J) → paste script → Enter",
      mcpTool: "use_figma({ file_key: '<figma-file-key>', prompt: '<script>' })",
    },
  };
}

module.exports = { convertToFigmaPluginCode, generatePluginCode };
