var { spawn } = require("child_process");
var fs = require("fs");
var path = require("path");
var os = require("os");

function isWindows() {
  return process.platform === "win32";
}

function isMacOS() {
  return process.platform === "darwin";
}

var CLIPBOARD_MAX = 10 * 1024 * 1024;

async function writeHtmlToClipboard(htmlContent) {
  if (!htmlContent || htmlContent.length === 0) {
    throw new Error("No content to write to clipboard");
  }
  if (htmlContent.length > CLIPBOARD_MAX) {
    console.log("  [ClipboardSystem] Payload large (" + (htmlContent.length / 1024 / 1024).toFixed(1) + "MB) — may take a moment");
  }

  if (isWindows()) {
    return await _writeWindowsHtml(htmlContent);
  } else if (isMacOS()) {
    return await _writeMacHtml(htmlContent);
  } else {
    console.log("  [ClipboardSystem] Platform not supported for automatic clipboard write (" + process.platform + ")");
    console.log("  [ClipboardSystem] Manual: copy output and paste in Figma (Ctrl+V)");
    return false;
  }
}

async function _writeWindowsHtml(html) {
  var tempFile = path.join(os.tmpdir(), "clipboard-" + Date.now() + ".html");
  fs.writeFileSync(tempFile, html, "utf-8");

  var script = 'try { $c = Get-Content -Path "' + tempFile.replace(/\\/g, "\\\\") + '" -Raw -Encoding UTF8; Set-Clipboard -Value $c -AsHtml; Write-Host \"OK\"; } catch { Write-Host \"ERR:\" + $_.Exception.Message; }';

  return new Promise(function(resolve, reject) {
    var child = spawn("powershell", [
      "-NoProfile", "-NonInteractive", "-Command", script,
    ], {
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
      timeout: 30000,
    });

    var stdout = "";
    var stderr = "";

    child.stdout.on("data", function(chunk) { stdout += chunk.toString(); });
    child.stderr.on("data", function(chunk) { stderr += chunk.toString(); });

    child.on("close", function(code) {
      try { fs.unlinkSync(tempFile); } catch(e) {}
      if (code === 0 && stdout.trim() === "OK") {
        console.log("  [ClipboardSystem] Written to system clipboard — paste in Figma (Ctrl+V)");
        console.log("  [ClipboardSystem] TIP: Create a frame first in Figma (F key), select it, then paste.");
        console.log("  [ClipboardSystem] TIP: For best results use Figma Desktop app (browser version may not paste external HTML).");
        resolve(true);
      } else {
        var errMsg = (stderr || stdout || "exit code " + code).trim();
        console.log("  [ClipboardSystem] PowerShell Set-Clipboard failed: " + errMsg);
        resolve(false);
      }
    });

    child.on("error", function(err) {
      try { fs.unlinkSync(tempFile); } catch(e) {}
      console.log("  [ClipboardSystem] PowerShell unavailable: " + err.message);
      resolve(false);
    });
  });
}

async function _writeMacHtml(html) {
  return new Promise(function(resolve, reject) {
    var child = spawn("pbcopy", [], {
      stdio: ["pipe", "ignore", "ignore"],
      timeout: 10000,
    });

    child.on("error", function(err) {
      console.log("  [ClipboardSystem] pbcopy unavailable: " + err.message);
      resolve(false);
    });

    child.on("close", function(code) {
      if (code === 0) {
        console.log("  [ClipboardSystem] Written to system clipboard — paste in Figma (Cmd+V)");
        console.log("  [ClipboardSystem] TIP: Create a frame first in Figma (F key), select it, then paste.");
        console.log("  [ClipboardSystem] TIP: For best results use Figma Desktop app (browser version may not paste external HTML).");
        resolve(true);
      } else {
        console.log("  [ClipboardSystem] pbcopy failed (exit " + code + ")");
        resolve(false);
      }
    });

    child.stdin.end(html);
  });
}

module.exports = { writeHtmlToClipboard };
