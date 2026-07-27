function contains(outer, inner) {
  return outer.x <= inner.x &&
         outer.y <= inner.y &&
         outer.x + outer.w >= inner.x + inner.w &&
         outer.y + outer.h >= inner.y + inner.h;
}

function area(el) {
  return el.w * el.h;
}

function buildTree(flatElements, pageWidth, pageHeight) {
  var elements = flatElements.filter(function(el) {
    return el.w > 0 && el.h > 0;
  });

  elements.sort(function(a, b) {
    return area(a) - area(b);
  });

  var parentMap = {};
  for (var i = 0; i < elements.length; i++) {
    var el = elements[i];
    var bestParentId = null;
    var bestArea = Infinity;

    for (var j = i + 1; j < elements.length; j++) {
      var candidate = elements[j];
      if (contains(candidate, el)) {
        var candArea = area(candidate);
        if (candArea < bestArea) {
          bestArea = candArea;
          bestParentId = candidate.id;
        }
      }
    }

    if (bestParentId === null) {
      if (containsRect(0, 0, pageWidth, pageHeight, el)) {
        bestParentId = null;
      }
    }

    if (bestParentId !== null) {
      parentMap[el.id] = bestParentId;
    }
  }

  var nodeMap = {};
  for (var k = 0; k < elements.length; k++) {
    var elem = elements[k];
    nodeMap[elem.id] = {
      id: elem.id,
      element: elem,
      children: [],
    };
  }

  var roots = [];
  for (var m = 0; m < elements.length; m++) {
    var el2 = elements[m];
    var node = nodeMap[el2.id];
    var pid = parentMap[el2.id];
    if (pid !== undefined && nodeMap[pid]) {
      nodeMap[pid].children.push(node);
    } else {
      roots.push(node);
    }
  }

  return {
    id: -1,
    element: {
      tag: "__page__",
      x: 0,
      y: 0,
      w: pageWidth,
      h: pageHeight,
      props: {},
      cls: "",
      text: "",
      attrs: {},
      dataAttrs: {},
    },
    children: roots,
  };
}

function containsRect(ox, oy, ow, oh, inner) {
  return ox <= inner.x &&
         oy <= inner.y &&
         ox + ow >= inner.x + inner.w &&
         oy + oh >= inner.y + inner.h;
}

module.exports = { buildTree };
