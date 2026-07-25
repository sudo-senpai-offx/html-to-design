function detectAutoLayout(el, childCount) {
  var props = el.props || {};
  var display = props["display"] || "block";
  var flexDir = props["flex-direction"] || "row";
  var justifyContent = props["justify-content"] || "flex-start";
  var alignItems = props["align-items"] || "stretch";
  var flexWrap = props["flex-wrap"] || "nowrap";
  var gap = parseFloat(props["gap"]) || parseFloat(props["column-gap"]) || parseFloat(props["row-gap"]) || parseFloat(props["grid-column-gap"]) || 0;
  var paddingTop = parseFloat(props["padding-top"]) || 0;
  var paddingRight = parseFloat(props["padding-right"]) || 0;
  var paddingBottom = parseFloat(props["padding-bottom"]) || 0;
  var paddingLeft = parseFloat(props["padding-left"]) || 0;

  var isFlex = display === "flex" || display === "inline-flex";
  var isGrid = display === "grid" || display === "inline-grid";
  var stackWrapEnabled = false;

  var stackMode = "NONE";
  if (isFlex) {
    stackMode = (flexDir === "column" || flexDir === "column-reverse") ? "VERTICAL" : "HORIZONTAL";
  } else if (isGrid) {
    var gridCols = props["grid-template-columns"] || "";
    var gridRows = props["grid-template-rows"] || "";
    var colCount = (gridCols.match(/repeat\(\s*(\d+)/) || [])[1];
    if (!colCount) colCount = (gridCols.match(/\d+/g) || []).length;
    var rowCount = (gridRows.match(/repeat\(\s*(\d+)/) || [])[1];
    if (!rowCount) rowCount = (gridRows.match(/\d+/g) || []).length;

    if (rowCount > colCount) {
      stackMode = "VERTICAL";
    } else {
      stackMode = "HORIZONTAL";
    }
    if (colCount > 1 || rowCount > 1) {
      stackWrapEnabled = true;
    }
  }

  if (flexWrap === "wrap" || flexWrap === "wrap-reverse") {
    stackWrapEnabled = true;
  }

  var stackJustify = "MIN";
  if (justifyContent === "center") stackJustify = "CENTER";
  else if (justifyContent === "flex-end" || justifyContent === "end") stackJustify = "MAX";
  else if (justifyContent === "space-between") stackJustify = "SPACE_BETWEEN";
  else if (justifyContent === "space-around" || justifyContent === "space-evenly") stackJustify = "SPACE_BETWEEN";

  var stackCounterAlign = "MIN";
  if (alignItems === "center") stackCounterAlign = "CENTER";
  else if (alignItems === "flex-end" || alignItems === "end") stackCounterAlign = "MAX";
  else if (alignItems === "stretch") stackCounterAlign = "Stretch";
  else if (alignItems === "baseline") stackCounterAlign = "BASELINE";

  var width = parseFloat(props["width"]) || 0;
  var height = parseFloat(props["height"]) || 0;
  var hasExplicitSize = (props["width"] && !props["width"].includes("auto")) ||
                         (props["height"] && !props["height"].includes("auto"));

  return {
    stackMode: stackMode,
    stackSpacing: gap,
    stackJustify: stackJustify,
    stackCounterAlign: stackCounterAlign,
    stackWrapEnabled: stackWrapEnabled,
    stackPrimarySizing: hasExplicitSize ? "FIXED" : "HUG",
    stackCounterSizing: "FIXED",
    stackPaddingTop: paddingTop,
    stackPaddingRight: paddingRight,
    stackPaddingBottom: paddingBottom,
    stackPaddingLeft: paddingLeft,
    isGrid: isGrid,
    gridCols: isGrid ? (props["grid-template-columns"] || "") : "",
    isFlex: isFlex,
    flexDirection: flexDir,
    flexWrap: flexWrap,
    gap: gap,
  };
}

module.exports = { detectAutoLayout };
