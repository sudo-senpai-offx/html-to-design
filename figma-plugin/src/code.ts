/* =======================================================
   HTM to Design — Open-Source HTML to Figma Converter
   Figma Plugin Main Entry
   ======================================================= */

/* ---------- TYPES ---------- */

interface ParsedElement {
  id: string;
  tag: string;
  text: string;
  x: number;
  y: number;
  w: number;
  h: number;
  style: Record<string, string>;
  children: ParsedElement[];
  src?: string;
  isPage?: boolean;
}

interface PluginOptions {
  autoLayout: boolean;
  images: boolean;
  shadows: boolean;
  naming: boolean;
}

interface ImportResult {
  success: boolean;
  elementCount: number;
  nodeCount: number;
  elapsed: number;
  warnings: string[];
  error?: string;
}

/* ---------- MAIN ENTRY ---------- */

figma.showUI(__html__, { width: 560, height: 620, title: "HTM to Design" });

figma.ui.onmessage = async (msg: { type: string; html: string; options: PluginOptions }) => {
  if (msg.type !== "import-html") return;

  const start = Date.now();
  const warnings: string[] = [];

  try {
    sendProgress(5, "Parsing HTML...");

    if (!msg.html || msg.html.length < 10) {
      throw new Error("HTML content is too short — paste valid inlined HTML");
    }

    const root = parseHtml(msg.html);
    const flatCount = countElements(root);
    sendProgress(15, `Parsed ${flatCount} elements, creating Figma nodes...`);

    const selection = figma.currentPage.selection;
    let parentFrame: FrameNode;

    if (selection.length === 1 && selection[0].type === "FRAME") {
      parentFrame = selection[0] as FrameNode;
      warnings.push("Using selected frame as container");
    } else {
      parentFrame = figma.createFrame();
      parentFrame.name = "HTM Import " + new Date().toLocaleTimeString();
      parentFrame.x = figma.viewport.center.x - (root.w || 1200) / 2;
      parentFrame.y = figma.viewport.center.y - (root.h || 800) / 2;
      parentFrame.resize(root.w || 1200, root.h || 800);
      parentFrame.fills = [{ type: "SOLID", color: { r: 1, g: 1, b: 1 } }] as Paint[];
      figma.currentPage.appendChild(parentFrame);
      figma.viewport.scrollAndZoomIntoView([parentFrame]);
    }

    const context: BuildContext = {
      parent: parentFrame,
      options: msg.options,
      warnings,
      imageMap: new Map(),
    };

    if (root.isPage && root.children.length > 0) {
      for (const child of root.children) {
        await buildNode(child, context);
      }
    } else {
      await buildNode(root, context);
    }

    sendProgress(95, "Applying final adjustments...");

    if (context.options.naming) {
      parentFrame.name = "HTM Import (" + flatCount + " elements)";
    }

    const elapsed = Date.now() - start;
    const totalNodes = countChildNodes(parentFrame);

    const result: ImportResult = {
      success: true,
      elementCount: flatCount,
      nodeCount: totalNodes,
      elapsed,
      warnings,
    };

    figma.ui.postMessage({ type: "result", ...result });
    sendProgress(100, "Done");

  } catch (e: any) {
    const elapsed = Date.now() - start;
    figma.ui.postMessage({
      type: "result",
      success: false,
      elementCount: 0,
      nodeCount: 0,
      elapsed,
      warnings,
      error: e.message || String(e),
    });
  }
};

function sendProgress(percent: number, message?: string) {
  figma.ui.postMessage({ type: "progress", percent, message });
}

/* ---------- HTML PARSER ---------- */

function parseHtml(html: string): ParsedElement {
  let doc: Document;

  if (typeof DOMParser !== "undefined") {
    doc = new DOMParser().parseFromString(html, "text/html");
  } else {
    const iframe = figma.createNodeFromHTML?.(html);
    if (iframe) {
      const imported = importNode(iframe as unknown as Element);
      iframe.remove?.();
      return imported;
    }
    throw new Error("DOMParser not available in this environment");
  }

  const body = doc.body || doc.documentElement;
  const result = parseDOMNode(body);

  if (result.tag === "body" || result.tag === "html") {
    result.isPage = true;
  }
  return result;
}

function parseDOMNode(node: Element, depth = 0): ParsedElement {
  const el: ParsedElement = {
    id: node.getAttribute("data-el-id") || "",
    tag: node.tagName ? node.tagName.toLowerCase() : "div",
    text: "",
    x: 0, y: 0, w: 0, h: 0,
    style: {},
    children: [],
    isPage: false,
  };

  const rectAttr = node.getAttribute("data-rect");
  if (rectAttr) {
    const parts = rectAttr.split(",").map(Number);
    if (parts.length === 4) {
      el.x = parts[0] || 0;
      el.y = parts[1] || 0;
      el.w = parts[2] || 0;
      el.h = parts[3] || 0;
    }
  }

  const styleAttr = node.getAttribute("style");
  if (styleAttr) {
    el.style = parseInlineStyle(styleAttr);
  }

  if (el.tag === "img") {
    el.src = node.getAttribute("src") || "";
  }

  const textContent = getTextContent(node);
  if (textContent) {
    el.text = textContent;
  }

  for (let i = 0; i < node.children.length; i++) {
    const child = node.children[i] as Element;
    if (child.tagName && child.tagName !== "SCRIPT" && child.tagName !== "STYLE" && child.tagName !== "META" && child.tagName !== "LINK") {
      el.children.push(parseDOMNode(child, depth + 1));
    }
  }

  return el;
}

function getTextContent(node: Element): string {
  let text = "";
  for (let i = 0; i < node.childNodes.length; i++) {
    const child = node.childNodes[i];
    if (child.nodeType === 3) {
      const t = (child.textContent || "").trim();
      if (t) text += (text ? " " : "") + t;
    }
  }
  return text;
}

function parseInlineStyle(styleStr: string): Record<string, string> {
  const result: Record<string, string> = {};
  const parts = styleStr.split(";");
  for (const part of parts) {
    const colonIdx = part.indexOf(":");
    if (colonIdx > 0) {
      const key = part.substring(0, colonIdx).trim();
      const val = part.substring(colonIdx + 1).trim();
      if (key && val) {
        result[key] = val;
      }
    }
  }
  return result;
}

function importNode(el: Element): ParsedElement {
  const result: ParsedElement = {
    id: "",
    tag: "div",
    text: "",
    x: 0, y: 0, w: 100, h: 100,
    style: {},
    children: [],
  };
  return result;
}

/* ---------- NODE BUILDER ---------- */

interface BuildContext {
  parent: BaseNode | FrameNode;
  options: PluginOptions;
  warnings: string[];
  imageMap: Map<string, Uint8Array>;
}

async function buildNode(el: ParsedElement, ctx: BuildContext, depth = 0): Promise<SceneNode | null> {
  if (!el || (el.w <= 0 && el.h <= 0 && !el.text && el.children.length === 0)) {
    return null;
  }

  const isFlex = ctx.options.autoLayout && (el.style["display"] === "flex" || el.style["display"] === "inline-flex" || el.style["display"] === "grid");
  const isContainer = (isFlex || el.children.length > 0) && !el.text;
  const isImage = el.tag === "img" && !!el.src;
  const hasText = !!el.text;
  const isAbsolute = el.style["position"] === "absolute" || el.style["position"] === "fixed";

  let node: SceneNode;

  if (isContainer && el.w > 0 && el.h > 0) {
    node = figma.createFrame();
    await buildFrameNode(node as FrameNode, el, ctx);
  } else if (isImage) {
    node = figma.createRectangle();
    await buildImageNode(node as RectangleNode, el, ctx);
  } else if (hasText) {
    node = figma.createText();
    await buildTextNode(node as TextNode, el, ctx);
  } else {
    node = figma.createRectangle();
    await buildRectNode(node as RectangleNode, el, ctx);
  }

  if (!node) return null;

  if (isAbsolute && ctx.parent.type === "FRAME") {
    const frameParent = ctx.parent as FrameNode;
    if (frameParent.layoutMode !== "NONE") {
      node.layoutPositioning = "ABSOLUTE";
    }
  }

  node.x = Math.round(el.x);
  node.y = Math.round(el.y);

  if (ctx.parent && "appendChild" in ctx.parent) {
    (ctx.parent as FrameNode).appendChild(node);
  }

  for (const child of el.children) {
    const childCtx: BuildContext = {
      parent: node,
      options: ctx.options,
      warnings: ctx.warnings,
      imageMap: ctx.imageMap,
    };
    await buildNode(child, childCtx, depth + 1);
  }

  return node;
}

async function buildFrameNode(frame: FrameNode, el: ParsedElement, ctx: BuildContext) {
  const s = el.style;

  frame.name = nameFrom(el);
  frame.resize(el.w, el.h);

  applyBaseStyles(frame, el, ctx);

  if (ctx.options.autoLayout) {
    applyAutoLayout(frame, el, ctx);
  }
}

async function buildRectNode(rect: RectangleNode, el: ParsedElement, ctx: BuildContext) {
  rect.name = nameFrom(el);
  rect.resize(Math.max(el.w, 1), Math.max(el.h, 1));
  applyBaseStyles(rect, el, ctx);
}

async function buildTextNode(text: TextNode, el: ParsedElement, ctx: BuildContext) {
  const s = el.style;

  text.name = nameFrom(el) + " (text)";
  text.resize(el.w || 100, el.h || 16);
  text.textAutoResize = "HEIGHT";
  text.fills = [{ type: "SOLID", color: parseColor(s["color"] || "#000000") }] as Paint[];

  try {
    const fontSize = parseFloat(s["font-size"] || "16");
    const fontFamily = s["font-family"] || "Inter";
    const fontWeight = mapFontWeight(s["font-weight"] || "400");
    const fontStyle = s["font-style"] === "italic" ? "Italic" : "Regular";

    const resolvedFont: FontName = { family: fontFamily, style: fontWeight + (fontWeight === "Regular" ? "" : "") };

    try {
      await figma.loadFontAsync({ family: fontFamily, style: fontStyle });
    } catch {
      try {
        await figma.loadFontAsync({ family: fontFamily, style: "Regular" });
      } catch {
        await figma.loadFontAsync({ family: "Inter", style: "Regular" });
        resolvedFont.family = "Inter";
      }
    }

    text.fontName = { family: resolvedFont.family, style: fontStyle } as FontName;
    text.fontSize = fontSize;

    const lh = s["line-height"];
    text.lineHeight = lh ? { value: parseFloat(lh), unit: parseFloat(lh) >= 4 ? "PIXELS" : "PERCENT" } as LineHeight : { value: fontSize * 1.4, unit: "PIXELS" };

    const ls = s["letter-spacing"];
    if (ls) text.letterSpacing = { value: parseFloat(ls), unit: "PIXELS" };

    const ta = s["text-align"];
    if (ta) text.textAlignHorizontal = mapTextAlign(ta);

    const td = s["text-decoration"];
    if (td === "underline") text.textDecoration = "UNDERLINE";
    if (td === "line-through") text.textDecoration = "STRIKETHROUGH";

    text.characters = el.text;

  } catch (e: any) {
    ctx.warnings.push("Text: " + (e.message || "font error"));
  }
}

async function buildImageNode(rect: RectangleNode, el: ParsedElement, ctx: BuildContext) {
  rect.name = nameFrom(el) + " (img)";
  rect.resize(el.w || 100, el.h || 100);

  applyBaseStyles(rect, el, ctx);

  if (!ctx.options.images || !el.src) return;

  try {
    let data: Uint8Array | null = null;

    if (el.src.startsWith("data:")) {
      const base64 = el.src.split(",")[1];
      if (base64) {
        data = new Uint8Array(atob(base64).split("").map(c => c.charCodeAt(0)));
      }
    }

    if (data && data.length > 0) {
      const hash = await figma.createImage(data);
      rect.fills = [
        {
          type: "IMAGE",
          scaleMode: "FILL",
          imageHash: hash.hash,
        } as Paint,
      ];
    }
  } catch {
    ctx.warnings.push("Image load failed: " + el.src.substring(0, 40));
  }
}

/* ---------- STYLE APPLIER ---------- */

function applyBaseStyles(node: BaseNode & BlendMixin & GeometryMixin & MinimalStrokesMixin & CornerMixin, el: ParsedElement, ctx: BuildContext) {
  const s = el.style;

  const bg = s["background-color"] || s["background"] || "";
  const bgImg = s["background-image"] || "";
  const isGradient = bgImg && (bgImg.includes("gradient"));

  if (bg && bg !== "transparent" && bg !== "rgba(0,0,0,0)") {
    if (isGradient) {
      try {
        node.fills = [parseGradient(bgImg, parseColor(bg))];
      } catch {
        node.fills = [{ type: "SOLID", color: parseColor(bg) }] as Paint[];
      }
    } else {
      node.fills = [{ type: "SOLID", color: parseColor(bg) }] as Paint[];
    }
  } else if (isGradient) {
    try {
      node.fills = [parseGradient(bgImg, { r: 1, g: 1, b: 1 })];
    } catch { /* no fill */ }
  }

  const opacity = parseFloat(s["opacity"] || "1");
  if (opacity >= 0 && opacity < 1) node.opacity = opacity;

  const br = parseFloat(s["border-radius"] || "0");
  if (br > 0) {
    const maxBr = Math.min(el.w || 9999, el.h || 9999) / 2;
    node.cornerRadius = Math.min(br, maxBr);
  }

  const brTL = parseFloat(s["border-top-left-radius"] || "0");
  const brTR = parseFloat(s["border-top-right-radius"] || "0");
  const brBL = parseFloat(s["border-bottom-left-radius"] || "0");
  const brBR = parseFloat(s["border-bottom-right-radius"] || "0");
  if (brTL > 0 || brTR > 0 || brBL > 0 || brBR > 0) {
    node.cornerRadius = [
      Math.min(brTL, (el.h || 9999) / 2),
      Math.min(brTR, (el.h || 9999) / 2),
      Math.min(brBR, (el.h || 9999) / 2),
      Math.min(brBL, (el.h || 9999) / 2),
    ];
  }

  const borderW = parseFloat(s["border-width"] || "0") || parseFloat(s["border-top-width"] || "0");
  const borderC = s["border-color"] || s["border-top-color"] || "";
  if (borderW > 0 && borderC && borderC !== "transparent") {
    node.strokeWeight = borderW;
    node.strokes = [{ type: "SOLID", color: parseColor(borderC) }] as Paint[];
  }

  const perSideTop = parseFloat(s["border-top-width"] || "0");
  const perSideRight = parseFloat(s["border-right-width"] || "0");
  const perSideBottom = parseFloat(s["border-bottom-width"] || "0");
  const perSideLeft = parseFloat(s["border-left-width"] || "0");
  const hasPerSide = perSideTop > 0 || perSideRight > 0 || perSideBottom > 0 || perSideLeft > 0;

  if (hasPerSide && (perSideTop !== borderW || perSideRight !== borderW || perSideBottom !== borderW || perSideLeft !== borderW)) {
    const cTop = s["border-top-color"] || borderC;
    const cRight = s["border-right-color"] || borderC;
    const cBottom = s["border-bottom-color"] || borderC;
    const cLeft = s["border-left-color"] || borderC;

    node.strokeTopWeight = perSideTop;
    node.strokeRightWeight = perSideRight;
    node.strokeBottomWeight = perSideBottom;
    node.strokeLeftWeight = perSideLeft;

    const allSame = cTop === cRight && cTop === cBottom && cTop === cLeft;
    if (!allSame) {
      ctx.warnings.push("Per-side border colors not fully supported — using top color");
    }
  }

  if (ctx.options.shadows) {
    applyShadows(node, s, ctx);
  }

  const blendMode = s["mix-blend-mode"] || "";
  if (blendMode) node.blendMode = mapBlendMode(blendMode);

  if (s["overflow"] === "hidden") {
    node.clipsContent = true;
  }
}

function applyShadows(node: BlendMixin & GeometryMixin, s: Record<string, string>, ctx: BuildContext) {
  const shadowVal = s["box-shadow"];
  if (!shadowVal || shadowVal === "none") return;

  const effects: Effect[] = [];

  const shadows = shadowVal.split(",").map(sh => sh.trim());
  for (const sh of shadows) {
    const parts = sh.split(" ").filter(p => p.length > 0);
    if (parts.length < 3) continue;

    let inset = false;
    let offsetX = 0, offsetY = 0, blur = 0, spread = 0;
    let col: RGB = { r: 0, g: 0, b: 0 };
    let alpha = 0.5;
    let idx = 0;

    if (parts[0] === "inset") { inset = true; idx = 1; }

    const parseLen = (s: string): number => {
      if (s.endsWith("px")) return parseFloat(s) || 0;
      if (s.endsWith("rem")) return (parseFloat(s) || 0) * 16;
      if (s.endsWith("em")) return (parseFloat(s) || 0) * 16;
      return parseFloat(s) || 0;
    };

    offsetX = parseLen(parts[idx] || "0");
    offsetY = parseLen(parts[idx + 1] || "0");
    blur = parseLen(parts[idx + 2] || "0");
    if (parts.length > idx + 3 && !parts[idx + 3].startsWith("#") && !parts[idx + 3].startsWith("rgb")) {
      spread = parseLen(parts[idx + 3]);
      idx++;
    }

    const colorStr = parts.slice(idx + 3).join(" ");
    if (colorStr) {
      const parsed = parseColorWithAlpha(colorStr);
      col = parsed.color;
      alpha = parsed.alpha;
    }

    if (inset) {
      effects.push({
        type: "INNER_SHADOW",
        color: { ...col, a: alpha },
        offset: { x: offsetX, y: offsetY },
        radius: blur,
        spread,
        visible: true,
        blendMode: "NORMAL",
      } as Effect);
    } else {
      effects.push({
        type: "DROP_SHADOW",
        color: { ...col, a: alpha },
        offset: { x: offsetX, y: offsetY },
        radius: blur,
        spread,
        visible: true,
        blendMode: "NORMAL",
      } as Effect);
    }
  }

  if (effects.length > 0) {
    const existing = node.effects || [];
    node.effects = [...existing, ...effects];
  }
}

/* ---------- AUTO-LAYOUT ---------- */

function applyAutoLayout(frame: FrameNode, el: ParsedElement, ctx: BuildContext) {
  const s = el.style;
  const display = s["display"] || "block";

  if (display === "grid") {
    frame.layoutMode = "VERTICAL";

    const cols = parseGridTemplate(s["grid-template-columns"] || "");
    if (cols > 0) {
      frame.layoutGrids = [
        {
          pattern: "COLUMNS",
          sectionSize: Math.round((el.w || 800) / cols),
          gutterSize: parseFloat(s["column-gap"] || "0"),
          count: cols,
          color: { r: 0.4, g: 0.2, b: 0.9, a: 0.1 },
          visible: true,
        },
      ];
    }
  } else if (display === "flex" || display === "inline-flex") {
    const flexDir = s["flex-direction"] || "row";
    const isRow = flexDir === "row" || flexDir === "row-reverse";
    frame.layoutMode = isRow ? "HORIZONTAL" : "VERTICAL";
  } else if (el.children.length >= 2) {
    frame.layoutMode = "VERTICAL";
  } else {
    return;
  }

  const padTop = parseFloat(s["padding-top"] || s["padding"] || "0");
  const padRight = parseFloat(s["padding-right"] || s["padding"] || "0");
  const padBottom = parseFloat(s["padding-bottom"] || s["padding"] || "0");
  const padLeft = parseFloat(s["padding-left"] || s["padding"] || "0");

  frame.paddingTop = padTop;
  frame.paddingRight = padRight;
  frame.paddingBottom = padBottom;
  frame.paddingLeft = padLeft;

  const gap = parseFloat(s["gap"] || s["column-gap"] || "0") || parseFloat(s["row-gap"] || "0");
  if (gap > 0) frame.itemSpacing = gap;

  const jc = s["justify-content"] || "";
  if (jc) frame.primaryAxisAlignItems = mapJustifyContent(jc);

  const ai = s["align-items"] || "";
  if (ai) frame.counterAxisAlignItems = mapAlignItems(ai);

  const flexWrap = s["flex-wrap"] || "";
  if (flexWrap === "wrap") {
    frame.layoutWrap = "WRAP";
  }

  frame.layoutSizingHorizontal = (el.w && el.w > 0) ? "FIXED" : "HUG";
  frame.layoutSizingVertical = (el.h && el.h > 0) ? "FIXED" : "HUG";
}

function parseGridTemplate(tpl: string): number {
  if (!tpl) return 0;
  const parts = tpl.split(/\s+/).filter(p => p.length > 0);
  return parts.filter(p => !p.startsWith("min") && !p.startsWith("max") && p !== "auto" && p !== "fit-content").length;
}

/* ---------- COLOR PARSER ---------- */

interface RGB { r: number; g: number; b: number; }

function parseColor(hexOrRgba: string): RGB {
  if (!hexOrRgba) return { r: 0, g: 0, b: 0 };
  const s = hexOrRgba.trim();

  if (s.startsWith("#")) {
    const h = s.replace("#", "");
    if (h.length === 3) return {
      r: parseInt(h[0] + h[0], 16) / 255,
      g: parseInt(h[1] + h[1], 16) / 255,
      b: parseInt(h[2] + h[2], 16) / 255,
    };
    if (h.length === 6) return {
      r: parseInt(h.substring(0, 2), 16) / 255,
      g: parseInt(h.substring(2, 4), 16) / 255,
      b: parseInt(h.substring(4, 6), 16) / 255,
    };
    if (h.length === 8) return {
      r: parseInt(h.substring(0, 2), 16) / 255,
      g: parseInt(h.substring(2, 4), 16) / 255,
      b: parseInt(h.substring(4, 6), 16) / 255,
    };
  }

  if (s.startsWith("rgb(") || s.startsWith("rgba(")) {
    const m = s.match(/[\d.]+/g);
    if (m && m.length >= 3) return {
      r: parseFloat(m[0]) / 255,
      g: parseFloat(m[1]) / 255,
      b: parseFloat(m[2]) / 255,
    };
  }

  const named: Record<string, string> = {
    black: "#000000", white: "#ffffff", red: "#ff0000", green: "#008000", blue: "#0000ff",
    yellow: "#ffff00", orange: "#ffa500", purple: "#800080", pink: "#ffc0cb",
    brown: "#a52a2a", gray: "#808080", navy: "#000080", teal: "#008080",
    maroon: "#800000", lime: "#00ff00", aqua: "#00ffff", fuchsia: "#ff00ff",
    silver: "#c0c0c0", transparent: "#ffffff",
  };
  if (named[s.toLowerCase()]) return parseColor(named[s.toLowerCase()]);

  return { r: 1, g: 1, b: 1 };
}

function parseColorWithAlpha(str: string): { color: RGB; alpha: number } {
  if (!str) return { color: { r: 0, g: 0, b: 0 }, alpha: 1 };

  if (str.startsWith("rgba(")) {
    const m = str.match(/[\d.]+/g);
    if (m && m.length >= 4) return {
      color: { r: parseFloat(m[0]) / 255, g: parseFloat(m[1]) / 255, b: parseFloat(m[2]) / 255 },
      alpha: parseFloat(m[3]),
    };
  }

  if (str.startsWith("rgb(")) {
    const m = str.match(/[\d.]+/g);
    if (m && m.length >= 3) return {
      color: { r: parseFloat(m[0]) / 255, g: parseFloat(m[1]) / 255, b: parseFloat(m[2]) / 255 },
      alpha: 1,
    };
  }

  const c = parseColor(str);
  return { color: c, alpha: 1 };
}

function parseGradient(gradientStr: string, fallback: RGB): Paint {
  const g = gradientStr.toLowerCase();

  if (g.includes("linear-gradient")) {
    const m = g.match(/linear-gradient\s*\(([^)]+)\)/);
    if (m) {
      const parts = m[1].split(",").map(p => p.trim());
      let angle = 0;
      const stops: { pos: number; color: RGB; alpha: number }[] = [];
      let offset = 0;

      if (parts[0].includes("deg")) {
        angle = parseFloat(parts[0]) || 0;
        offset = 1;
      } else if (parts[0].includes("turn")) {
        angle = (parseFloat(parts[0]) || 0) * 360;
        offset = 1;
      } else if (parts[0] === "to top") { angle = 270; offset = 1; }
      else if (parts[0] === "to bottom") { angle = 90; offset = 1; }
      else if (parts[0] === "to left") { angle = 180; offset = 1; }
      else if (parts[0] === "to right") { angle = 0; offset = 1; }
      else if (parts[0] === "to top right") { angle = 315; offset = 1; }
      else if (parts[0] === "to top left") { angle = 225; offset = 1; }
      else if (parts[0] === "to bottom right") { angle = 45; offset = 1; }
      else if (parts[0] === "to bottom left") { angle = 135; offset = 1; }

      for (let i = offset; i < parts.length; i++) {
        const sp = parts[i];
        const spM = sp.match(/(#[a-f0-9]+|rgba?\([^)]+\)|[\w-]+)\s*([\d.]+%)?/i);
        if (spM) {
          const colorVal = spM[1].trim();
          const pos = spM[2] ? parseFloat(spM[2]) / 100 : (stops.length === 0 ? 0 : 1);
          const parsed = parseColorWithAlpha(colorVal);
          stops.push({ pos, color: parsed.color, alpha: parsed.alpha });
        }
      }

      if (stops.length >= 2) {
        const rad = (angle - 90) * Math.PI / 180;
        return {
          type: "GRADIENT_LINEAR",
          gradientTransform: [
            [Math.cos(rad), Math.sin(rad), 0.5 * (1 - Math.cos(rad) - Math.sin(rad))],
            [-Math.sin(rad), Math.cos(rad), 0.5 * (1 + Math.sin(rad) - Math.cos(rad))],
          ] as Transform,
          gradientStops: stops.map(s => ({
            position: s.pos,
            color: { ...s.color, a: s.alpha },
          })),
        } as Paint;
      }
    }
  }

  if (g.includes("radial-gradient")) {
    const m = g.match(/radial-gradient\s*\(([^)]+)\)/);
    if (m) {
      const parts = m[1].split(",").map(p => p.trim());
      const stops: { pos: number; color: RGB; alpha: number }[] = [];

      for (const sp of parts) {
        const spM = sp.match(/(#[a-f0-9]+|rgba?\([^)]+\)|[\w-]+)\s*([\d.]+%)?/i);
        if (spM) {
          const cv = spM[1].trim();
          const pos = spM[2] ? parseFloat(spM[2]) / 100 : (stops.length === 0 ? 0 : 1);
          const parsed = parseColorWithAlpha(cv);
          stops.push({ pos, color: parsed.color, alpha: parsed.alpha });
        }
      }

      if (stops.length >= 2) {
        return {
          type: "GRADIENT_RADIAL",
          gradientTransform: [
            [1, 0, 0],
            [0, 1, 0],
          ] as Transform,
          gradientStops: stops.map(s => ({
            position: s.pos,
            color: { ...s.color, a: s.alpha },
          })),
        } as Paint;
      }
    }
  }

  return { type: "SOLID", color: fallback } as Paint;
}

/* ---------- MAPPERS ---------- */

function mapTextAlign(ta: string): "LEFT" | "CENTER" | "RIGHT" | "JUSTIFIED" {
  switch (ta) {
    case "center": return "CENTER";
    case "right": return "RIGHT";
    case "justify": return "JUSTIFIED";
    default: return "LEFT";
  }
}

function mapJustifyContent(jc: string): "MIN" | "CENTER" | "MAX" | "SPACE_BETWEEN" {
  switch (jc) {
    case "center": return "CENTER";
    case "flex-end": case "end": return "MAX";
    case "space-between": return "SPACE_BETWEEN";
    case "space-around": return "SPACE_BETWEEN";
    case "space-evenly": return "SPACE_BETWEEN";
    default: return "MIN";
  }
}

function mapAlignItems(ai: string): "MIN" | "CENTER" | "MAX" {
  switch (ai) {
    case "center": return "CENTER";
    case "flex-end": case "end": return "MAX";
    default: return "MIN";
  }
}

function mapBlendMode(mode: string): BlendMode {
  const map: Record<string, BlendMode> = {
    multiply: "MULTIPLY", screen: "SCREEN", overlay: "OVERLAY",
    darken: "DARKEN", lighten: "LIGHTEN", "color-dodge": "COLOR_DODGE",
    "color-burn": "COLOR_BURN", "hard-light": "HARD_LIGHT",
    "soft-light": "SOFT_LIGHT", difference: "DIFFERENCE",
    exclusion: "EXCLUSION", hue: "HUE", saturation: "SATURATION",
    color: "COLOR", luminosity: "LUMINOSITY",
  };
  return map[mode] || "NORMAL";
}

function mapFontWeight(w: string): string {
  const num = parseInt(w);
  if (num <= 100) return "Thin";
  if (num <= 200) return "ExtraLight";
  if (num <= 300) return "Light";
  if (num <= 400) return "Regular";
  if (num <= 500) return "Medium";
  if (num <= 600) return "SemiBold";
  if (num <= 700) return "Bold";
  if (num <= 800) return "ExtraBold";
  return "Black";
}

function nameFrom(el: ParsedElement): string {
  if (el.isPage) return "Page";
  const tag = el.tag || "div";
  const text = el.text ? el.text.substring(0, 20).trim() : "";
  const id = el.id ? "#" + el.id : "";
  if (text) return tag + " - " + text + id;
  return tag + id;
}

/* ---------- HELPERS ---------- */

function countElements(el: ParsedElement): number {
  let count = 1;
  for (const c of el.children) count += countElements(c);
  return count;
}

function countChildNodes(node: SceneNode): number {
  let count = 1;
  if ("children" in node) {
    for (const c of node.children) {
      count += countChildNodes(c);
    }
  }
  return count;
}
