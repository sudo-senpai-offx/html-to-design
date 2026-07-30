function shouldEnableAutoLayout(children, mode) {
  if (!children || children.length < 2) return true;
  var primaryAxis = mode === "HORIZONTAL" ? "w" : "h";
  var counterAxis = mode === "HORIZONTAL" ? "h" : "w";
  var primarySizes = [];
  var counterSizes = [];
  for (var i = 0; i < children.length; i++) {
    var el = children[i].element || children[i];
    if (!el) continue;
    primarySizes.push(el[primaryAxis] || 0);
    counterSizes.push(el[counterAxis] || 0);
  }
  if (primarySizes.length < 2) return true;

  function varianceCoeff(values) {
    var sum = 0, n = values.length;
    for (var i = 0; i < n; i++) sum += values[i];
    var mean = sum / n;
    var sqSum = 0;
    for (var i = 0; i < n; i++) sqSum += (values[i] - mean) * (values[i] - mean);
    var stdDev = Math.sqrt(sqSum / n);
    return mean > 0 ? stdDev / mean : 0;
  }

  var counterCV = varianceCoeff(counterSizes);
  if (counterCV > 0.5) return false;
  return true;
}

function detectAutoLayout(el, childCount) {
  var props = el.props || {};
  var display = props["display"] || "block";
  var flexDir = props["flex-direction"] || "row";
  var justifyContent = props["justify-content"] || "flex-start";
  var alignItems = props["align-items"] || "stretch";
  var flexWrap = props["flex-wrap"] || "nowrap";
  var gap = parseFloat(props["gap"]) || parseFloat(props["column-gap"]) || parseFloat(props["row-gap"]) || parseFloat(props["grid-column-gap"]) || parseFloat(props["grid-row-gap"]) || 0;
  var paddingTop = parseFloat(props["padding-top"]) || 0;
  var paddingRight = parseFloat(props["padding-right"]) || 0;
  var paddingBottom = parseFloat(props["padding-bottom"]) || 0;
  var paddingLeft = parseFloat(props["padding-left"]) || 0;

  var isFlex = display === "flex" || display === "inline-flex";
  var isGrid = display === "grid" || display === "inline-grid";

  if (!isFlex && !isGrid) {
    return {
      isAutoLayout: false,
      stackMode: "NONE",
      stackSpacing: 0,
      stackJustify: "MIN",
      stackCounterAlign: "MIN",
      stackWrapEnabled: false,
      stackPrimarySizing: "FIXED",
      stackCounterSizing: "FIXED",
      stackPaddingTop: 0,
      stackPaddingRight: 0,
      stackPaddingBottom: 0,
      stackPaddingLeft: 0,
      isGrid: false,
      isFlex: false,
      gridInfo: null,
      flexDirection: flexDir,
      flexWrap: flexWrap,
      gap: 0,
    };
  }

  if (!childCount || childCount <= 1) {
    return {
      isAutoLayout: false,
      stackMode: "NONE",
      stackSpacing: 0,
      stackJustify: "MIN",
      stackCounterAlign: "MIN",
      stackWrapEnabled: false,
      stackPrimarySizing: "FIXED",
      stackCounterSizing: "FIXED",
      stackPaddingTop: 0,
      stackPaddingRight: 0,
      stackPaddingBottom: 0,
      stackPaddingLeft: 0,
      isGrid: isGrid,
      isFlex: isFlex,
      gridInfo: null,
      flexDirection: flexDir,
      flexWrap: flexWrap,
      gap: 0,
    };
  }

  var stackWrapEnabled = false;

  var stackMode = "NONE";
  var gridInfo = null;

  if (isFlex) {
    stackMode = (flexDir === "column" || flexDir === "column-reverse") ? "VERTICAL" : "HORIZONTAL";
    if (flexWrap === "wrap" || flexWrap === "wrap-reverse") {
      stackWrapEnabled = true;
    }
  } else if (isGrid) {
    var gridCols = props["grid-template-columns"] || "";
    var gridRows = props["grid-template-rows"] || "";
    var gridAutoFlow = props["grid-auto-flow"] || "row";

    var colCount = 0;
    var rowCount = 0;

    var repeatMatch = gridCols.match(/repeat\(\s*(\d+)/);
    if (repeatMatch) {
      colCount = parseInt(repeatMatch[1]);
    } else {
      var cols = gridCols.match(/[\d.]+(?:fr|px|%|rem|em|vw)/g);
      colCount = cols ? cols.length : 0;
    }

    var rowRepeatMatch = gridRows.match(/repeat\(\s*(\d+)/);
    if (rowRepeatMatch) {
      rowCount = parseInt(rowRepeatMatch[1]);
    } else {
      var rows = gridRows.match(/[\d.]+(?:fr|px|%|rem|em|vh)/g);
      rowCount = rows ? rows.length : 0;
    }

    if (gridAutoFlow === "column") {
      stackMode = "HORIZONTAL";
      if (colCount > 1) stackWrapEnabled = true;
    } else {
      stackMode = colCount > 1 ? "HORIZONTAL" : "VERTICAL";
      if (colCount > 1 || rowCount > 1) stackWrapEnabled = true;
    }

    gridInfo = {
      colCount: colCount,
      rowCount: rowCount,
      gridCols: gridCols,
      gridRows: gridRows,
      gridAutoFlow: gridAutoFlow,
    };
  }

  if (flexWrap === "wrap" || flexWrap === "wrap-reverse") {
    stackWrapEnabled = true;
  }

  var stackJustify = "MIN";
  if (justifyContent === "center") stackJustify = "CENTER";
  else if (justifyContent === "flex-end" || justifyContent === "end") stackJustify = "MAX";
  else if (justifyContent === "space-between") stackJustify = "SPACE_BETWEEN";
  else if (justifyContent === "space-around" || justifyContent === "space-evenly") stackJustify = "SPACE_EVENLY";

  var stackCounterAlign = "MIN";
  if (alignItems === "center") stackCounterAlign = "CENTER";
  else if (alignItems === "flex-end" || alignItems === "end") stackCounterAlign = "MAX";
  else if (alignItems === "stretch") stackCounterAlign = "STRETCH";
  else if (alignItems === "baseline") stackCounterAlign = "BASELINE";

  var width = parseFloat(props["width"]) || 0;
  var height = parseFloat(props["height"]) || 0;
  var hasExplicitSize = (props["width"] && !props["width"].includes("auto")) ||
                         (props["height"] && !props["height"].includes("auto"));

  return {
    isAutoLayout: true,
    stackMode: stackMode,
    stackSpacing: gap,
    stackJustify: stackJustify,
    stackCounterAlign: stackCounterAlign,
    stackWrapEnabled: stackWrapEnabled,
    stackPrimarySizing: hasExplicitSize ? "FIXED" : "RESIZE_TO_FIT",
    stackCounterSizing: "FIXED",
    stackPaddingTop: paddingTop,
    stackPaddingRight: paddingRight,
    stackPaddingBottom: paddingBottom,
    stackPaddingLeft: paddingLeft,
    isGrid: isGrid,
    isFlex: isFlex,
    gridInfo: gridInfo,
    flexDirection: flexDir,
    flexWrap: flexWrap,
    gap: gap,
  };
}

module.exports = { detectAutoLayout, shouldEnableAutoLayout };
