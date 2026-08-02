const { createCanvas, Image } = require("canvas");

function loadPng(buffer) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      try {
        const canvas = createCanvas(img.width, img.height);
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0);
        resolve({ canvas, ctx, width: img.width, height: img.height });
      } catch (e) {
        reject(e);
      }
    };
    img.onerror = (e) => reject(new Error("Failed to decode PNG: " + (e && e.message ? e.message : "unknown")));
    img.src = buffer;
  });
}

function compareBuffers(refBuffer, outBuffer, options) {
  const opts = options || {};
  const colorThreshold = opts.colorThreshold != null ? opts.colorThreshold : 20;
  const coverageThreshold = opts.coverageThreshold != null ? opts.coverageThreshold : 0.05;

  return Promise.all([loadPng(refBuffer), loadPng(outBuffer)]).then(([ref, out]) => {
    const w = Math.min(ref.width, out.width);
    const h = Math.min(ref.height, out.height);
    const refCtx = ref.ctx;
    const outCtx = out.ctx;
    const refData = refCtx.getImageData(0, 0, w, h).data;
    const outData = outCtx.getImageData(0, 0, w, h).data;

    let sumAbs = 0;
    let sumSq = 0;
    let changedPixels = 0;
    const total = w * h;

    for (let i = 0; i < total; i++) {
      const r = refData[i * 4];
      const g = refData[i * 4 + 1];
      const b = refData[i * 4 + 2];
      const r2 = outData[i * 4];
      const g2 = outData[i * 4 + 1];
      const b2 = outData[i * 4 + 2];
      const dr = Math.abs(r - r2);
      const dg = Math.abs(g - g2);
      const db = Math.abs(b - b2);
      const diff = (dr + dg + db) / 3;
      sumAbs += diff;
      sumSq += diff * diff;
      if (diff > colorThreshold) changedPixels++;
    }

    const meanAbs = sumAbs / total;
    const rmse = Math.sqrt(sumSq / total);
    const coverage = changedPixels / total;
    const maxPossible = 255;
    const similarity = Math.max(0, Math.min(100, (1 - meanAbs / maxPossible) * 100));
    const coverageScore = coverage <= coverageThreshold ? 100 : Math.max(0, 100 - (coverage / coverageThreshold) * 100);
    const accuracy = (similarity * 0.6 + coverageScore * 0.4);

    return {
      width: w,
      height: h,
      refDimensions: { width: ref.width, height: ref.height },
      outDimensions: { width: out.width, height: out.height },
      totalPixels: total,
      changedPixels,
      coverage,
      meanAbsDiff: Math.round(meanAbs * 1000) / 1000,
      rmse: Math.round(rmse * 1000) / 1000,
      pixelSimilarity: Math.round(similarity * 100) / 100,
      coverageScore: Math.round(coverageScore * 100) / 100,
      accuracyScore: Math.round(accuracy * 100) / 100,
      verdict: accuracy >= 90 ? "pass" : accuracy >= 75 ? "warn" : "fail",
    };
  });
}

function findDiffRect(refBuffer, outBuffer, options) {
  const opts = options || {};
  const colorThreshold = opts.colorThreshold != null ? opts.colorThreshold : 20;
  return Promise.all([loadPng(refBuffer), loadPng(outBuffer)]).then(([ref, out]) => {
    const w = Math.min(ref.width, out.width);
    const h = Math.min(ref.height, out.height);
    const refData = ref.ctx.getImageData(0, 0, w, h).data;
    const outData = out.ctx.getImageData(0, 0, w, h).data;
    let minX = Infinity, minY = Infinity, maxX = -1, maxY = -1;
    let count = 0;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        const diff = (Math.abs(refData[i] - outData[i]) + Math.abs(refData[i + 1] - outData[i + 1]) + Math.abs(refData[i + 2] - outData[i + 2])) / 3;
        if (diff > colorThreshold) {
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
          count++;
        }
      }
    }
    if (count === 0) return null;
    return { minX, minY, maxX, maxY, width: maxX - minX + 1, height: maxY - minY + 1, count };
  });
}

module.exports = { loadPng, compareBuffers, findDiffRect };
