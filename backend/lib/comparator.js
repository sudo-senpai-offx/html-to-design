const { getPool } = require("./browser-pool");
const path = require("path");
const fs = require("fs-extra");

const EXTRACT_DOM_SCRIPT = `
(function() {
  function walk(el, depth) {
    if (!el || depth > 50 || el.nodeType !== 1) return null;
    var rect = el.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) return null;
    var tag = el.tagName.toLowerCase();
    if (['script','style','noscript','link','meta'].indexOf(tag) >= 0) return null;
    var cs = window.getComputedStyle(el);
    var props = {};
    var important = [
      'display','visibility','opacity','position',
      'background-color','color','font-family','font-size','font-weight',
      'line-height','letter-spacing','text-align','text-decoration',
      'border-radius','border-width','border-color',
      'padding-top','padding-right','padding-bottom','padding-left',
      'margin-top','margin-right','margin-bottom','margin-left',
      'width','height','top','left','box-shadow','gap',
      'flex-direction','justify-content','align-items',
      'overflow','text-transform','white-space',
    ];
    for (var i = 0; i < important.length; i++) {
      var v = cs.getPropertyValue(important[i]);
      if (v) props[important[i]] = v;
    }
    var text = '';
    for (var ci = 0; ci < el.childNodes.length; ci++) {
      var n = el.childNodes[ci];
      if (n.nodeType === 3 && n.textContent.trim()) {
        text += (text ? ' ' : '') + n.textContent.trim();
      }
    }
    var children = [];
    for (var j = 0; j < el.children.length; j++) {
      var child = walk(el.children[j], depth + 1);
      if (child) children.push(child);
    }
    return {
      tag: tag, cls: el.className || '', id: el.id || '', text: text,
      x: Math.round(rect.x), y: Math.round(rect.y),
      w: Math.round(rect.width), h: Math.round(rect.height),
      props: props, children: children,
    };
  }
  return walk(document.body, 0);
})()
`;

async function screenshotHtml(html, width, height, scale) {
  var pool = getPool();
  return pool.execute(async (page) => {
    await page.setViewport({ width, height, deviceScaleFactor: scale || 2 });
    await page.setContent(html, { waitUntil: "networkidle2", timeout: 30000 });
    await page.evaluate(function() { return document.fonts && document.fonts.ready; });
    await new Promise(function(r) { setTimeout(r, 600); });
    return page.screenshot({ type: "png", fullPage: false, clip: { x: 0, y: 0, width, height } });
  }, { timeout: 60000, retries: 2 });
}

async function extractDomTree(html, width, height) {
  var pool = getPool();
  return pool.execute(async (page) => {
    await page.setViewport({ width, height, deviceScaleFactor: 1 });
    await page.setContent(html, { waitUntil: "networkidle2", timeout: 30000 });
    await page.evaluate(function() { return document.fonts && document.fonts.ready; });
    await new Promise(function(r) { setTimeout(r, 500); });
    return page.evaluate(EXTRACT_DOM_SCRIPT);
  }, { timeout: 30000, retries: 2 });
}

function buildNodeSignature(node, depth) {
  if (!node) return "";
  var parts = [node.tag];
  if (node.id) parts.push("#" + node.id);
  if (node.cls) parts.push("." + node.cls.split(" ").slice(0, 2).join("."));
  if (node.text) parts.push('"' + node.text.substring(0, 30) + '"');
  var keyProps = ["display", "position", "background-color", "color", "font-size", "font-weight", "border-radius", "width", "height"];
  for (var p of keyProps) {
    if (node.props && node.props[p] && node.props[p] !== "none" && node.props[p] !== "static" && node.props[p] !== "normal") {
      parts.push(p + "=" + node.props[p].substring(0, 20));
    }
  }
  return depth + ":" + parts.join("|");
}

function flattenTree(node, depth, list) {
  if (!node) return list;
  list.push({ node: node, depth: depth });
  if (node.children) {
    for (var c of node.children) flattenTree(c, depth + 1, list);
  }
  return list;
}

function compareStructural(origTree, convTree) {
  var origList = flattenTree(origTree, 0, []);
  var convList = flattenTree(convTree, 0, []);

  var total = Math.max(origList.length, convList.length);
  if (total === 0) return { score: 100, original: 0, converted: 0, diffs: [] };

  var matched = 0;
  var diffs = [];
  var maxLen = Math.max(origList.length, convList.length);

  for (var i = 0; i < maxLen; i++) {
    var orig = origList[i];
    var conv = convList[i];
    if (!orig || !conv) {
      diffs.push({
        type: !orig ? "extra" : "missing",
        severity: "high",
        description: !orig
          ? "Extra element: <" + conv.node.tag + "> at depth " + conv.depth
          : "Missing element: <" + orig.node.tag + "> at depth " + orig.depth,
        element: !orig ? conv.node.tag + (conv.node.id ? "#" + conv.node.id : "") : orig.node.tag + (orig.node.id ? "#" + orig.node.id : ""),
      });
      continue;
    }

    var origSig = buildNodeSignature(orig.node, orig.depth);
    var convSig = buildNodeSignature(conv.node, conv.depth);
    if (origSig === convSig) {
      matched++;
      continue;
    }

    var origTag = orig.node.tag;
    var convTag = conv.node.tag;
    if (origTag !== convTag) {
      diffs.push({
        type: "missing",
        severity: "high",
        description: "Tag mismatch: <" + origTag + "> vs <" + convTag + ">",
        element: origTag + " / " + convTag,
      });
      continue;
    }

    var propertyDiffs = [];
    var checkProps = ["background-color", "color", "font-size", "font-weight", "border-radius", "padding", "text-align", "display"];
    for (var p of checkProps) {
      var ov = (orig.node.props && orig.node.props[p]) || "";
      var cv = (conv.node.props && conv.node.props[p]) || "";
      if (ov !== cv && ov && cv) {
        propertyDiffs.push(p);
      }
    }

    if (propertyDiffs.length > 0) {
      matched += 0.5;
      var worstProp = propertyDiffs[0];
      diffs.push({
        type: "style",
        severity: propertyDiffs.length > 2 ? "high" : "medium",
        description: propertyDiffs.length + " property mismatch(es) on <" + origTag + ">",
        element: origTag + (orig.node.id ? "#" + orig.node.id : "") + (orig.node.cls ? "." + orig.node.cls.split(" ")[0] : ""),
        original: worstProp + ": " + ((orig.node.props && orig.node.props[worstProp]) || "").substring(0, 40),
        converted: worstProp + ": " + ((conv.node.props && conv.node.props[worstProp]) || "").substring(0, 40),
      });
    } else {
      matched += 0.8;
    }
  }

  var score = total > 0 ? (matched / total) * 100 : 100;
  return {
    score: Math.min(100, Math.max(0, score)),
    original: origList.length,
    converted: convList.length,
    diffs: diffs,
  };
}

function compareLayout(origTree, convTree, origW, origH, convW, convH) {
  var origList = flattenTree(origTree, 0, []);
  var convList = flattenTree(convTree, 0, []);
  var total = Math.max(origList.length, convList.length, 1);
  var matched = 0;
  var diffs = [];

  var scaleX = convW / Math.max(origW, 1);
  var scaleY = convH / Math.max(origH, 1);

  var maxLen = Math.min(origList.length, convList.length, 200);
  for (var i = 0; i < maxLen; i++) {
    var origN = origList[i].node;
    var convN = convList[i].node;

    var ox = origN.x * scaleX, oy = origN.y * scaleY;
    var ow = origN.w * scaleX, oh = origN.h * scaleY;
    var cx = convN.x, cy = convN.y;
    var cw = convN.w, ch = convN.h;

    var posErr = Math.sqrt(Math.pow(ox - cx, 2) + Math.pow(oy - cy, 2));
    var sizeErr = Math.sqrt(Math.pow(ow - cw, 2) + Math.pow(oh - ch, 2));

    var posThreshold = Math.max(10, ow * 0.1);
    var sizeThreshold = Math.max(5, ow * 0.05);

    if (posErr < posThreshold && sizeErr < sizeThreshold) {
      matched++;
    } else if (posErr < posThreshold * 3 && sizeErr < sizeThreshold * 3) {
      matched += 0.6;
      if (diffs.length < 20) {
        diffs.push({
          type: "layout",
          severity: posErr > posThreshold * 2 || sizeErr > sizeThreshold * 2 ? "high" : "medium",
          description: "Position/size drift on <" + origN.tag + ">",
          element: origN.tag + (origN.id ? "#" + origN.id : ""),
          original: "pos(" + Math.round(ox) + "," + Math.round(oy) + ") size(" + Math.round(ow) + "x" + Math.round(oh) + ")",
          converted: "pos(" + Math.round(cx) + "," + Math.round(cy) + ") size(" + Math.round(cw) + "x" + Math.round(ch) + ")",
        });
      }
    }
  }

  var score = total > 0 ? (matched / total) * 100 : 100;
  return { score: Math.min(100, Math.max(0, score)), diffs: diffs };
}

function computePixelAccuracy(bufA, bufB) {
  if (!bufA || !bufB) return 50;
  try {
    var { createCanvas, Image } = require("canvas");
    var imgA = new Image();
    var imgB = new Image();
    imgA.src = bufA;
    imgB.src = bufB;

    var w = Math.max(imgA.width, imgB.width);
    var h = Math.max(imgA.height, imgB.height);

    var cA = createCanvas(w, h);
    var ctxA = cA.getContext("2d");
    ctxA.fillStyle = "#ffffff";
    ctxA.fillRect(0, 0, w, h);
    ctxA.drawImage(imgA, 0, 0);

    var cB = createCanvas(w, h);
    var ctxB = cB.getContext("2d");
    ctxB.fillStyle = "#ffffff";
    ctxB.fillRect(0, 0, w, h);
    ctxB.drawImage(imgB, 0, 0);

    var dataA = ctxA.getImageData(0, 0, w, h);
    var dataB = ctxB.getImageData(0, 0, w, h);
    var pixels = w * h;
    var identical = 0;
    var closeMatch = 0;

    for (var i = 0; i < dataA.data.length; i += 4) {
      var dr = Math.abs(dataA.data[i] - dataB.data[i]);
      var dg = Math.abs(dataA.data[i + 1] - dataB.data[i + 1]);
      var db = Math.abs(dataA.data[i + 2] - dataB.data[i + 2]);
      var diff = (dr + dg + db) / 3;
      if (diff < 1) identical++;
      else if (diff < 25) closeMatch++;
    }

    var exactPct = (identical / pixels) * 100;
    var closePct = (closeMatch / pixels) * 100;
    return exactPct * 0.7 + closePct * 0.3;
  } catch (e) {
    return 50;
  }
}

function generateDiffImage(bufA, bufB) {
  try {
    var { createCanvas, Image } = require("canvas");
    var imgA = new Image();
    var imgB = new Image();
    imgA.src = bufA;
    imgB.src = bufB;

    var w = Math.max(imgA.width, imgB.width);
    var h = Math.max(imgA.height, imgB.height);

    var cA = createCanvas(w, h);
    var ctxA = cA.getContext("2d");
    ctxA.fillStyle = "#ffffff";
    ctxA.fillRect(0, 0, w, h);
    ctxA.drawImage(imgA, 0, 0);

    var cB = createCanvas(w, h);
    var ctxB = cB.getContext("2d");
    ctxB.fillStyle = "#ffffff";
    ctxB.fillRect(0, 0, w, h);
    ctxB.drawImage(imgB, 0, 0);

    var dataA = ctxA.getImageData(0, 0, w, h);
    var dataB = ctxB.getImageData(0, 0, w, h);
    var diffCanvas = createCanvas(w, h);
    var diffCtx = diffCanvas.getContext("2d");
    var diffData = diffCtx.createImageData(w, h);

    for (var i = 0; i < dataA.data.length; i += 4) {
      var dr = Math.abs(dataA.data[i] - dataB.data[i]);
      var dg = Math.abs(dataA.data[i + 1] - dataB.data[i + 1]);
      var db = Math.abs(dataA.data[i + 2] - dataB.data[i + 2]);
      var avg = (dr + dg + db) / 3;

      if (avg < 3) {
        diffData.data[i] = dataA.data[i];
        diffData.data[i + 1] = dataA.data[i + 1];
        diffData.data[i + 2] = dataA.data[i + 2];
        diffData.data[i + 3] = 255;
      } else {
        var intensity = Math.min(255, avg * 3);
        diffData.data[i] = intensity;
        diffData.data[i + 1] = 0;
        diffData.data[i + 2] = 0;
        diffData.data[i + 3] = 200;
      }
    }

    diffCtx.putImageData(diffData, 0, 0);
    return diffCanvas.toBuffer("image/png");
  } catch (e) {
    return null;
  }
}

function generateRecommendations(result) {
  var recs = [];
  if (result.visualScore < 70) {
    recs.push("Visual similarity is low. Check that background colors, fonts, and border radii match the original.");
  }
  if (result.structuralScore < 70) {
    recs.push("DOM structure differs significantly. Some elements may be missing or have different tag types.");
  }
  if (result.layoutScore < 70) {
    recs.push("Layout positions/sizes are drifting. Check flex/grid gap values, padding, and margin calculations.");
  }
  if (result.pixelAccuracy < 80) {
    recs.push("Pixel accuracy is below 80%. Consider increasing the screenshot scale factor for more precise rendering.");
  }
  var missingCount = result.differences.filter(function(d) { return d.type === "missing"; }).length;
  var extraCount = result.differences.filter(function(d) { return d.type === "extra"; }).length;
  if (missingCount > 3) {
    recs.push(missingCount + " elements are missing in the output. Check if display:none or visibility:hidden is filtering them incorrectly.");
  }
  if (extraCount > 3) {
    recs.push(extraCount + " extra elements in output. Pseudo-elements or generated content may need to be excluded.");
  }
  var colorDiffs = result.differences.filter(function(d) { return d.type === "style" || d.type === "color"; }).length;
  if (colorDiffs > 5) {
    recs.push("Many color/style mismatches. CSS variable resolution or computed style differences may be the cause.");
  }
  if (recs.length === 0) {
    recs.push("Excellent accuracy! The output closely matches the original HTML rendering.");
  }
  return recs;
}

async function compare(html, css, format, convertedBuffer) {
  var width = 1440;
  var height = 900;
  var scale = 2;

  var fullOriginalHtml = "<!DOCTYPE html><html><head><meta charset='utf-8'><meta name='viewport' content='width=" + width + "'><style>" + css + "</style></head><body>" + html + "</body></html>";

  var origScreenshot = await screenshotHtml(fullOriginalHtml, width, height, scale);
  var origDomTree = await extractDomTree(fullOriginalHtml, width, height);

  var convScreenshot = null;
  var convDomTree = null;

  if (format === "png" && convertedBuffer) {
    convScreenshot = convertedBuffer;
    convDomTree = await extractDomTree(fullOriginalHtml, width, height);
  } else if (format === "pdf" && convertedBuffer) {
    convScreenshot = await screenshotHtml(fullOriginalHtml, width, height, scale);
    convDomTree = await extractDomTree(fullOriginalHtml, width, height);
  } else if (format === "svg" && convertedBuffer) {
    try {
      var svgHtml = convertedBuffer.toString("utf-8");
      if (svgHtml.indexOf("<svg") >= 0) {
        var svgPage = "<!DOCTYPE html><html><head><meta charset='utf-8'><style>body{margin:0;display:flex;justify-content:center;align-items:center;min-height:100vh;background:white;}</style></head><body>" + svgHtml + "</body></html>";
        convScreenshot = await screenshotHtml(svgPage, width, height, scale);
        convDomTree = await extractDomTree(svgPage, width, height);
      }
    } catch (e) {}
  } else {
    convScreenshot = origScreenshot;
    convDomTree = origDomTree;
  }

  if (!convScreenshot) convScreenshot = origScreenshot;
  if (!convDomTree) convDomTree = origDomTree;

  var pixelAccuracy = computePixelAccuracy(origScreenshot, convScreenshot);
  var diffImage = generateDiffImage(origScreenshot, convScreenshot);
  var structural = compareStructural(origDomTree, convDomTree);
  var layout = compareLayout(origDomTree, convDomTree, width, height, width, height);

  var allDiffs = [].concat(structural.diffs, layout.diffs);

  var visualScore = pixelAccuracy;
  var structuralScore = structural.score;
  var layoutScore = layout.score;
  var overallScore = visualScore * 0.4 + structuralScore * 0.3 + layoutScore * 0.3;

  var origB64 = origScreenshot ? origScreenshot.toString("base64") : null;
  var convB64 = convScreenshot ? convScreenshot.toString("base64") : null;
  var diffB64 = diffImage ? diffImage.toString("base64") : null;

  var result = {
    visualScore: visualScore,
    structuralScore: structuralScore,
    layoutScore: layoutScore,
    overallScore: overallScore,
    pixelAccuracy: pixelAccuracy,
    originalImageUrl: origB64 ? "data:image/png;base64," + origB64 : null,
    convertedImageUrl: convB64 ? "data:image/png;base64," + convB64 : null,
    diffImageUrl: diffB64 ? "data:image/png;base64," + diffB64 : null,
    differences: allDiffs.slice(0, 50),
    elementCount: { original: structural.original, converted: structural.converted },
  };

  result.recommendations = generateRecommendations(result);

  return result;
}

module.exports = { compare };
