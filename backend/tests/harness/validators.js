function checkMagic(buffer, magic) {
  if (!buffer || buffer.length === 0) return false;
  const m = Buffer.isBuffer(magic) ? magic : Buffer.from(magic, "utf-8");
  return buffer.slice(0, m.length).equals(m);
}

const VALIDATORS = {
  png: (buf) => ({
    ok: checkMagic(buf, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    detail: "PNG magic bytes",
  }),
  pdf: (buf) => {
    const ascii = buf.slice(0, 5).toString("latin1");
    return { ok: ascii === "%PDF-", detail: "PDF header" };
  },
  svg: (buf) => {
    const s = buf.toString("utf-8");
    return {
      ok: /<svg[\s>]/.test(s),
      detail: "<svg root found (len " + s.length + ")",
    };
  },
  figma: (buf) => {
    // .fig format is a zip archive
    return { ok: checkMagic(buf, [0x50, 0x4b, 0x03, 0x04]), detail: "ZIP magic (fig is zip-based)" };
  },
  psd: (buf) => ({ ok: checkMagic(buf, "8BPS"), detail: "8BPS magic" }),
  xd: (buf) => {
    const isZip = checkMagic(buf, [0x50, 0x4b, 0x03, 0x04]);
    return { ok: isZip, detail: "ZIP magic (.xd sketch container)" };
  },
  clipboard: (buf) => {
    const s = buf.toString("utf-8");
    return {
      ok: /<[a-z]/.test(s) && /figma|html|svg|rect|frame/i.test(s),
      detail: "HTML-ish payload (len " + s.length + ")",
    };
  },
  inline: (buf) => {
    const s = buf.toString("utf-8");
    let parsed = null;
    try {
      parsed = JSON.parse(s);
    } catch (e) {}
    if (parsed) {
      const batches = parsed.batches || parsed.chunks || [];
      return {
        ok: batches.length > 0 || !!parsed.html,
        detail: "inline JSON with " + batches.length + " chunk(s)",
        extra: { chunkCount: batches.length, hasCombinedHtml: !!parsed.html },
      };
    }
    return { ok: /<[a-z]/.test(s), detail: "inline HTML (len " + s.length + ")" };
  },
  "figma-all": (buf) => {
    try {
      const parsed = JSON.parse(buf.toString("utf-8"));
      const methods = parsed.methods || {};
      const ready = Object.keys(methods).filter((k) => methods[k] && methods[k].status === "ready");
      const failed = Object.keys(methods).filter((k) => methods[k] && methods[k].status === "failed");
      return {
        ok: ready.length > 0,
        detail: "figma-all methods ready=" + ready.join(",") + " failed=" + failed.join(","),
        extra: {
          elementCount: parsed.metadata && parsed.metadata.elementCount,
          readyMethods: ready,
          failedMethods: failed,
          qualitySummary: parsed.qualitySummary,
        },
      };
    } catch (e) {
      return { ok: false, detail: "JSON parse failed: " + e.message };
    }
  },
  "figma-mcp": (buf) => {
    try {
      const parsed = JSON.parse(buf.toString("utf-8"));
      return {
        ok: !!parsed.script || !!parsed.mcp,
        detail: "MCP JSON with script len " + ((parsed.script || "").length),
      };
    } catch (e) {
      return { ok: false, detail: "JSON parse failed: " + e.message };
    }
  },
  "figma-plugin": (buf) => {
    try {
      const parsed = JSON.parse(buf.toString("utf-8"));
      return {
        ok: !!parsed.inlinedHtml || !!parsed.script || !!parsed.mcp,
        detail: "plugin JSON (inlinedHtml len " + ((parsed.inlinedHtml || "").length) + ")",
      };
    } catch (e) {
      return { ok: false, detail: "JSON parse failed: " + e.message };
    }
  },
};

const FORMAT_ORDER = ["png", "svg", "pdf", "psd", "xd", "figma", "clipboard", "inline", "figma-mcp", "figma-plugin", "figma-all"];

function validateFormat(format, buffer) {
  const validator = VALIDATORS[format];
  if (!validator) return { ok: true, detail: "no validator for " + format };
  try {
    return validator(buffer);
  } catch (e) {
    return { ok: false, detail: "validator threw: " + e.message };
  }
}

module.exports = { validateFormat, FORMAT_ORDER };
