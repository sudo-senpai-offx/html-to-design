const {
  parseColor, solidFill, parseGradient, resolveFills, resolveImageFill,
  parseShadow, parseTextShadow, getStroke, getRadius, fontFamily, fontWeight,
} = require("./utils");

function extractStyles(props, width, height) {
  var fills = resolveFills(props);
  var stroke = getStroke(props);
  var effects = parseShadow(props["box-shadow"]);
  var textShadowEffects = parseTextShadow(props["text-shadow"]);
  var radius = getRadius(props, width, height);
  var opacity = parseFloat(props["opacity"]) || 1;
  var bgImageUrl = resolveImageFill(props);

  var textProps = null;
  if (props["font-size"] || props["font-family"] || props["font-weight"]) {
    var color = props["color"] || "#1A1A1A";
    var c = parseColor(color);
    if (c && c.a < 0.01) color = "#1A1A1A";

    textProps = {
      family: fontFamily(props["font-family"]),
      style: fontWeight(props["font-weight"]),
      size: parseFloat(props["font-size"]) || 16,
      lineHeight: parseFloat(props["line-height"]) || (parseFloat(props["font-size"]) || 16) * 1.6,
      letterSpacing: parseFloat(props["letter-spacing"]) || 0,
      align: (props["text-align"] || "left").toUpperCase().replace("START", "LEFT").replace("END", "RIGHT"),
      decoration: props["text-decoration"] === "underline" ? "UNDERLINE" : undefined,
      color: color,
      transform: props["text-transform"] || "none",
      fontStyle: props["font-style"] || "normal",
      wordSpacing: parseFloat(props["word-spacing"]) || 0,
      textIndent: parseFloat(props["text-indent"]) || 0,
    };

    if (props["text-decoration"] && props["text-decoration"].includes("line-through")) {
      textProps.decoration = "STRIKETHROUGH";
    }
    if (props["text-decoration"] && props["text-decoration"].includes("underline")) {
      textProps.decoration = "UNDERLINE";
    }
  }

  var display = props["display"] || "block";
  var flexDir = props["flex-direction"] || "row";
  var justifyContent = props["justify-content"] || "flex-start";
  var alignItems = props["align-items"] || "stretch";
  var alignSelf = props["align-self"] || "auto";
  var flexWrap = props["flex-wrap"] || "nowrap";
  var gap = parseFloat(props["gap"]) || parseFloat(props["column-gap"]) || parseFloat(props["row-gap"]) || 0;
  var padding = {
    top: parseFloat(props["padding-top"]) || 0,
    right: parseFloat(props["padding-right"]) || 0,
    bottom: parseFloat(props["padding-bottom"]) || 0,
    left: parseFloat(props["padding-left"]) || 0,
  };

  var overflow = props["overflow"] || "visible";
  var visibility = props["visibility"] !== "hidden";
  var position = props["position"] || "static";
  var zIndex = parseInt(props["z-index"]) || 0;

  var outline = null;
  if (props["outline-width"] && props["outline-width"] !== "0px" && props["outline-style"] && props["outline-style"] !== "none") {
    var ow = parseFloat(props["outline-width"]) || 0;
    var oc = parseColor(props["outline-color"]) || { r: 0, g: 0, b: 0, a: 1 };
    var oo = parseFloat(props["outline-offset"]) || 0;
    outline = { weight: ow, color: oc, offset: oo };
  }

  var filter = props["filter"] || "none";
  var blurAmount = 0;
  var brightnessAmount = 1;
  var contrastAmount = 1;
  var saturateAmount = 1;
  var grayscaleAmount = 0;
  var sepiaAmount = 0;
  var hueRotateAmount = 0;

  if (filter !== "none") {
    var bm = filter.match(/blur\(([\d.]+)px\)/);
    if (bm) blurAmount = parseFloat(bm[1]);

    var brm = filter.match(/brightness\(([\d.]+)\)/);
    if (brm) brightnessAmount = parseFloat(brm[1]);

    var cm = filter.match(/contrast\(([\d.]+)\)/);
    if (cm) contrastAmount = parseFloat(cm[1]);

    var sm = filter.match(/saturate\(([\d.]+)\)/);
    if (sm) saturateAmount = parseFloat(sm[1]);

    var gsm = filter.match(/grayscale\(([\d.]+)\)/);
    if (gsm) grayscaleAmount = parseFloat(gsm[1]);

    var stm = filter.match(/sepia\(([\d.]+)\)/);
    if (stm) sepiaAmount = parseFloat(stm[1]);

    var hrm = filter.match(/hue-rotate\(([\d.-]+)deg\)/);
    if (hrm) hueRotateAmount = parseFloat(hrm[1]);
  }

  var translate = null;
  var rotate = null;
  var scaleVal = null;
  var transformMatrix = null;

  if (props["translate"]) {
    var tm = props["translate"].match(/([\d.]+)px\s*([\d.]+)px/);
    if (tm) translate = { x: parseFloat(tm[1]), y: parseFloat(tm[2]) };
  }
  if (props["rotate"]) {
    var rm = props["rotate"].match(/([\d.-]+)deg/);
    if (rm) rotate = parseFloat(rm[1]);
  }
  if (props["scale"]) {
    var sm2 = props["scale"].match(/([\d.]+)\s*([\d.]+)/);
    if (sm2) scaleVal = { x: parseFloat(sm2[1]), y: parseFloat(sm2[2]) };
  }

  var transformStr = props["transform"];
  if (transformStr && transformStr !== "none") {
    var matrixMatch = transformStr.match(/matrix\(([\d.,\s]+)\)/);
    if (matrixMatch) {
      var vals = matrixMatch[1].split(/[\s,]+/).map(Number);
      if (vals.length === 6) {
        transformMatrix = {
          a: vals[0], b: vals[1], c: vals[2],
          d: vals[3], e: vals[4], f: vals[5],
        };
        if (!rotate && vals[0] !== undefined) {
          rotate = Math.atan2(vals[1], vals[0]) * 180 / Math.PI;
        }
      }
    }

    var translateMatch = transformStr.match(/translate\(([\d.]+)px?\s*,?\s*([\d.]+)px?\)/);
    if (translateMatch && !translate) {
      translate = { x: parseFloat(translateMatch[1]), y: parseFloat(translateMatch[2]) };
    }

    var rotateMatch = transformStr.match(/rotate\(([\d.-]+)deg\)/);
    if (rotateMatch && !rotate) {
      rotate = parseFloat(rotateMatch[1]);
    }

    var scaleMatch = transformStr.match(/scale\(([\d.]+)(?:\s*,\s*([\d.]+))?\)/);
    if (scaleMatch && !scaleVal) {
      scaleVal = { x: parseFloat(scaleMatch[1]), y: parseFloat(scaleMatch[2] || scaleMatch[1]) };
    }
  }

  return {
    fills, stroke, effects, textShadowEffects, radius, opacity, bgImageUrl,
    textProps, display, flexDir, justifyContent, alignItems, alignSelf,
    flexWrap, gap, padding, overflow, visibility, position, zIndex,
    outline, blurAmount, translate, rotate, scale: scaleVal, transformMatrix,
    brightnessAmount, contrastAmount, saturateAmount, grayscaleAmount,
    sepiaAmount, hueRotateAmount,
  };
}

module.exports = { extractStyles };
