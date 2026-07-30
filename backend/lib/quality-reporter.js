var { validateTree, validateInlinedHtml, validateClipboard, crossValidate } = require("./output-validator");
var { fixTree, fixInlinedHtml } = require("./output-fixer");

/* Full quality pipeline: validate → fix → score → report */
function assessTierOutput(tierId, output, sourceHtml, elements, options) {
  var start = Date.now();
  var report = {
    tierId: tierId,
    qualityScore: 0,
    issues: [],
    fixes: null,
    coverage: {},
    timing: 0,
    verdict: ""
  };

  if (tierId === "fig-file" || tierId === "mcp") {
    if (output && output.tree) {
      var v = validateTree(output.tree, output.pageWidth, output.pageHeight);
      var f = fixTree(output.tree, options);
      report.issues = v.issues;
      report.coverage = { nodes: v.stats.totalNodes, fills: v.stats.withFills, zeroSize: v.stats.zeroSize, noFill: v.stats.noFill };
      report.fixes = f;

      if (sourceHtml && elements) {
        var cv = crossValidate(sourceHtml, elements, output.tree);
        report.coverage.elementRatio = cv.stats.ratio;
        report.issues = report.issues.concat(cv.issues);
      }

      report.qualityScore = _computeScore(report.issues, v.completeness);
      output.tree = f.tree || output.tree;
    } else {
      report.issues.push({ severity: "error", message: "No tree structure in output" });
      report.qualityScore = 0;
    }
  }

  if (tierId === "clipboard") {
    var payloadStr = typeof output === "string" ? output : (output && output.payload ? output.payload : "");
    if (payloadStr) {
      var v2 = validateClipboard(payloadStr);
      report.issues = v2.issues;

      if (sourceHtml) {
        var styleCount = (payloadStr.match(/style="/g) || []).length;
        var tagCount = (payloadStr.match(/<\w+/g) || []).length;
        report.coverage = { styles: styleCount, tags: tagCount };
      }

      var fi = fixInlinedHtml(payloadStr);
      if (fi.fixes.applied > 0) {
        if (typeof output === "string") {
          output.fixed = fi.fixed;
        } else if (output) {
          output.fixedHtml = fi.fixed;
        }
        report.fixes = fi.fixes;
      }

      report.qualityScore = v2.valid ? 85 : 30;
    } else {
      report.issues.push({ severity: "error", message: "Empty clipboard payload" });
      report.qualityScore = 0;
    }
  }

  if (tierId === "html-to-design" || tierId === "code-api") {
    if (output && output.html) {
      var v3 = validateInlinedHtml(output.html);
      report.issues = v3.issues;
      report.coverage = v3.stats;

      var fi2 = fixInlinedHtml(output.html);
      if (fi2.fixes.applied > 0) {
        output.html = fi2.fixed;
        report.fixes = fi2.fixes;
      }

      report.qualityScore = v3.issues.some(function(i) { return i.severity === "error"; }) ? 40 : 90;
    } else {
      report.issues.push({ severity: "error", message: "No HTML content in output" });
      report.qualityScore = 0;
    }
  }

  report.timing = Date.now() - start;

  if (report.qualityScore >= 90) report.verdict = "excellent";
  else if (report.qualityScore >= 70) report.verdict = "good";
  else if (report.qualityScore >= 40) report.verdict = "fair";
  else report.verdict = "poor";

  return report;
}

function _computeScore(issues, baseCompleteness) {
  var score = baseCompleteness;
  for (var i = 0; i < issues.length; i++) {
    if (issues[i].severity === "error") score -= 15;
    else if (issues[i].severity === "warning") score -= 5;
    else score -= 1;
  }
  return Math.max(0, Math.min(100, score));
}

/* Choose the best tier based on quality reports */
function pickBestTier(tierResults) {
  if (!tierResults || Object.keys(tierResults).length === 0) return null;
  var bestId = null, bestScore = -1;
  var tierPriority = ["html-to-design", "clipboard", "fig-file", "code-api", "mcp"];

  for (var i = 0; i < tierPriority.length; i++) {
    var tid = tierPriority[i];
    var tr = tierResults[tid];
    if (tr && tr.qualityScore > bestScore && tr.qualityScore >= 30) {
      bestScore = tr.qualityScore;
      bestId = tid;
    }
  }

  if (!bestId) {
    for (var tid2 in tierResults) {
      if (tierResults[tid2].qualityScore > bestScore) {
        bestScore = tierResults[tid2].qualityScore;
        bestId = tid2;
      }
    }
  }

  return bestId ? { tierId: bestId, score: bestScore } : { tierId: "fig-file", score: 50 };
}

/* Generate a human-readable quality summary from per-tier reports */
function generateSummary(reports) {
  var lines = [];

  for (var tid in reports) {
    var r = reports[tid];
    if (!r) continue;
    var line = "  [" + r.verdict.toUpperCase() + "] " + tid + " — score " + r.qualityScore + "/100";
    if (r.issues && r.issues.length > 0) {
      var critical = r.issues.filter(function(i) { return i.severity === "error"; }).length;
      var warnings = r.issues.filter(function(i) { return i.severity === "warning"; }).length;
      if (critical > 0) line += " (" + critical + " errors, " + warnings + " warnings)";
      else if (warnings > 0) line += " (" + warnings + " warnings)";
    }
    lines.push(line);
  }

  return lines.join("\n");
}

module.exports = { assessTierOutput, pickBestTier, generateSummary };
