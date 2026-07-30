var fs = require("fs-extra");
var path = require("path");
var juice = require("juice").default || require("juice");

var JUICE_OPTS = {
  applyWidthAttributes: true,
  applyHeightAttributes: true,
  removeStyleTags: true,
  preserveImportant: true,
  resolveCSSVariables: true,
  preserveFontFaces: true,
  preserveMediaQueries: true,
  preserveKeyFrames: true,
  preservePseudos: true,
  inlinePseudoElements: true,
};

function inlineCssStyles(html) {
  if (!html || html.trim().length === 0) return html;
  try {
    var result = juice(html, JUICE_OPTS);
    return result;
  } catch (e) {
    console.error("[css-inliner] juice failed:", e.message);
    return html;
  }
}

/* Resolve <link rel="stylesheet"> tags to inline <style> tags and inject externally-provided CSS content */
function inlineExternalStylesheets(html, options) {
  var cssContent = (options && options.css) || "";
  var baseDir = (options && options.baseDir) || process.cwd();

  if (cssContent) {
    html = injectStyleTag(html, cssContent);
  }

  html = html.replace(
    /<link[^>]*rel=["']stylesheet["'][^>]*href=["']([^"']+)["'][^>]*\/?>/gi,
    function(match, href) {
      try {
        var resolvedPath = resolveCssPath(href, baseDir);
        if (resolvedPath && fs.existsSync(resolvedPath)) {
          var cssBody = fs.readFileSync(resolvedPath, "utf-8");
          return "<style>" + cssBody + "</style>";
        }
        return match;
      } catch (e) {
        return match;
      }
    }
  );

  html = html.replace(/<style[^>]*>([\s\S]*?)<\/style>/gi, function(match, cssBody) {
    var inlined = resolveImports(cssBody, baseDir);
    return match.replace(cssBody, inlined);
  });

  return html;
}

function injectStyleTag(html, css) {
  if (!css || !css.trim()) return html;
  var styleTag = "<style>\n" + css + "\n</style>";
  if (html.includes("</head>")) {
    return html.replace("</head>", styleTag + "\n</head>");
  }
  if (html.includes("<head")) {
    return html.replace("</head>", styleTag + "\n</head>");
  }
  return styleTag + "\n" + html;
}

function resolveCssPath(href, baseDir) {
  if (!href) return null;
  if (href.startsWith("http://") || href.startsWith("https://")) return null;
  if (href.startsWith("data:")) return null;
  if (href.startsWith("//")) return null;
  if (path.isAbsolute(href)) return href;
  return path.resolve(baseDir, href);
}

function resolveImports(cssBody, baseDir) {
  return cssBody.replace(/@import\s+(?:url\s*\(\s*["']?([^"'\s)]+)["']?\s*\)|["']([^"']+)["'])\s*[^;]*;/gi, function(match, url1, url2) {
    var importUrl = url1 || url2;
    if (!importUrl) return match;
    try {
      var resolvedPath = resolveCssPath(importUrl, baseDir);
      if (resolvedPath && fs.existsSync(resolvedPath)) {
        var importedCss = fs.readFileSync(resolvedPath, "utf-8");
        return resolveImports(importedCss, path.dirname(resolvedPath));
      }
      return "/* @import skipped: " + importUrl + " */";
    } catch (e) {
      return "/* @import error: " + importUrl + " */";
    }
  });
}

module.exports = { inlineExternalStylesheets: inlineExternalStylesheets, inlineCssStyles: inlineCssStyles };
