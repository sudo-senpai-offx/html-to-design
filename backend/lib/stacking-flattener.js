/**
 * Stacking Context Flattener.
 *
 * Browsers scope z-index to the nearest stacking context (a parent with its
 * own z-index/opacity/transform), while Figma orders every layer inside its
 * direct frame. A deeply-nested child with a very high z-index therefore
 * cannot be ordered against its grandparent's siblings unless we promote it.
 *
 * Rule: any child whose stacking context exceeds its parent's context by more
 * than 1 is "promoted" up one level (reattached to the grandparent), so the
 * flat layer order can reflect its true stacking weight without colliding
 * with sibling contexts.
 */
function getZIndex(node) {
  if (node && node.zIndex !== undefined && node.zIndex !== null && node.zIndex !== "auto") {
    var n = parseInt(node.zIndex, 10);
    if (!isNaN(n)) return n;
  }
  if (node && node.element && node.element.props) {
    var zi = node.element.props["z-index"];
    if (zi !== undefined && zi !== null && zi !== "auto") {
      var m = parseInt(zi, 10);
      if (!isNaN(m)) return m;
    }
  }
  return null;
}

function flattenStackingContexts(node, parentZIndex, parentNode, promoted) {
  if (!node) return { node: node, promoted: promoted || [] };
  if (parentZIndex === undefined) parentZIndex = 0;
  if (promoted === undefined) promoted = [];

  var own = getZIndex(node);
  var context = own !== null ? own : parentZIndex;
  node._stackingContext = context;

  if (node.children && node.children.length > 0) {
    for (var i = 0; i < node.children.length; i++) {
      flattenStackingContexts(node.children[i], context, node, promoted);
    }

    if (parentNode) {
      var remaining = [];
      var changed = false;
      for (var j = 0; j < node.children.length; j++) {
        var child = node.children[j];
        if (child._stackingContext > context + 1) {
          promoted.push(child);
          if (!parentNode.children) parentNode.children = [];
          parentNode.children.push(child);
          changed = true;
        } else {
          remaining.push(child);
        }
      }
      if (changed) node.children = remaining;
    }
  }

  return { node: node, promoted: promoted };
}

module.exports = { flattenStackingContexts };
