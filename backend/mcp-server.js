/*
 * MCP (Model Context Protocol) server for HTML-to-Figma conversion.
 * Exposes a `convert_html_to_figma` tool that accepts HTML+CSS and returns a .fig file as base64.
 * Runs as stdio JSON-RPC 2.0 server — compatible with Claude, Cursor, and other MCP clients.
 *
 * Usage:
 *   node mcp-server.js                    # stdio mode (for MCP clients)
 *   node mcp-server.js --port 3100        # HTTP mode (for testing)
 */
var fs = require("fs-extra");
var path = require("path");
var { convertTo } = require("./converters");

/* ---- MCP Protocol helpers ---- */

function mcpError(code, message, data) {
  return { code: code, message: message, data: data || null };
}

var MCP_ERRORS = {
  PARSE_ERROR: mcpError(-32700, "Parse error"),
  INVALID_REQUEST: mcpError(-32600, "Invalid request"),
  METHOD_NOT_FOUND: mcpError(-32601, "Method not found"),
  INVALID_PARAMS: mcpError(-32602, "Invalid params"),
  INTERNAL_ERROR: mcpError(-32603, "Internal error"),
  TOOL_NOT_FOUND: mcpError(-32001, "Tool not found"),
  TOOL_EXECUTION_ERROR: mcpError(-32002, "Tool execution error"),
};

function jsonRpcResponse(id, result) {
  return JSON.stringify({ jsonrpc: "2.0", id: id, result: result }) + "\n";
}

function jsonRpcError(id, error) {
  return JSON.stringify({ jsonrpc: "2.0", id: id, error: error }) + "\n";
}

function jsonRpcNotification(method, params) {
  return JSON.stringify({ jsonrpc: "2.0", method: method, params: params }) + "\n";
}

/* ---- Tool definitions ---- */

var TOOLS = [
  {
    name: "convert_html_to_figma",
    description: "Convert HTML+CSS to a Figma (.fig) design file with native layers and auto-layout. Returns the .fig file as base64.",
    inputSchema: {
      type: "object",
      properties: {
        html: {
          type: "string",
          description: "HTML content to convert (body content or full document)",
        },
        css: {
          type: "string",
          description: "CSS styles to apply to the HTML (optional)",
        },
        width: {
          type: "number",
          description: "Viewport width in pixels (default: 1440)",
          default: 1440,
        },
        height: {
          type: "number",
          description: "Viewport height in pixels (default: 900)",
          default: 900,
        },
        scale: {
          type: "number",
          description: "Device scale factor (default: 2)",
          default: 2,
        },
        pageName: {
          type: "string",
          description: "Name for the Figma page (default: 'HTML Export')",
          default: "HTML Export",
        },
      },
      required: ["html"],
    },
  },
  {
    name: "convert_html_to_inline",
    description: "Convert HTML+CSS to inlined HTML chunks with all CSS styles inlined into element style attributes. Returns JSON with chunk metadata.",
    inputSchema: {
      type: "object",
      properties: {
        html: {
          type: "string",
          description: "HTML content to convert",
        },
        css: {
          type: "string",
          description: "CSS styles to inline",
        },
        pageName: {
          type: "string",
          description: "Name for the page",
          default: "HTML Export",
        },
      },
      required: ["html"],
    },
  },
];

/* ---- Tool handlers ---- */

async function handleConvertHtmlToFigma(params) {
  var html = params.html;
  var css = params.css || "";
  var width = params.width || 1440;
  var height = params.height || 900;
  var scale = params.scale || 2;
  var pageName = params.pageName || "HTML Export";

  if (!html) {
    throw Object.assign(new Error("html is required"), { mcpCode: -32602 });
  }

  /* Build full document */
  var fullHtml = buildHtmlDocument(html, css);

  /* Convert to figma (.fig) format */
  var result = await convertTo("figma", fullHtml, {
    width: width,
    height: height,
    scale: scale,
    css: css,
    pageName: pageName,
    timeout: 180000,
  });

  /* result is a Buffer containing the .fig file */
  var base64 = result.toString("base64");
  var size = result.length;

  return {
    content: [
      {
        type: "text",
        text: JSON.stringify({
          format: "figma",
          encoding: "base64",
          data: base64,
          size: size,
          pageName: pageName,
          instructions: [
            "Download the .fig file (decode from base64)",
            "Open Figma → File → Open → select the .fig file",
            "The design appears as native Figma layers with auto-layout",
          ],
        }),
      },
    ],
    isError: false,
  };
}

async function handleConvertHtmlToInline(params) {
  var html = params.html;
  var css = params.css || "";
  var pageName = params.pageName || "HTML Export";

  if (!html) {
    throw Object.assign(new Error("html is required"), { mcpCode: -32602 });
  }

  var fullHtml = buildHtmlDocument(html, css);

  var result = await convertTo("inline", fullHtml, {
    css: css,
    pageName: pageName,
    timeout: 60000,
  });

  /* result is a Buffer containing JSON */
  var parsed;
  try {
    parsed = JSON.parse(result.toString("utf-8"));
  } catch (e) {
    /* Fallback: return raw inlined HTML */
    return {
      content: [{ type: "text", text: result.toString("utf-8") }],
      isError: false,
    };
  }

  return {
    content: [
      {
        type: "text",
        text: JSON.stringify({
          chunkCount: parsed.metadata.chunkCount,
          totalSizeKB: parsed.metadata.totalSizeKB,
          source: parsed.metadata.source,
          pageName: parsed.metadata.pageName,
          chunks: parsed.batches.map(function(b) { return { label: b.label, index: b.index, size: b.size, filename: b.filename }; }),
          manifest: parsed.batchManifest,
          combinedHtmlBase64: parsed.html,
        }),
      },
    ],
    isError: false,
  };
}

var HANDLERS = {
  "convert_html_to_figma": handleConvertHtmlToFigma,
  "convert_html_to_inline": handleConvertHtmlToInline,
};

/* ---- JSON-RPC request handler ---- */

async function handleRequest(body) {
  if (!body || typeof body !== "object") {
    return jsonRpcError(null, MCP_ERRORS.PARSE_ERROR);
  }

  var id = body.id !== undefined ? body.id : null;
  var method = body.method;
  var params = body.params || {};

  /* Handle initialize */
  if (method === "initialize") {
    return jsonRpcResponse(id, {
      protocolVersion: "2024-11-05",
      capabilities: {
        tools: {},
      },
      serverInfo: {
        name: "html-to-design-mcp",
        version: "1.0.0",
      },
    });
  }

  /* Handle notifications */
  if (method === "notifications/initialized" || method === "notifications/cancelled") {
    /* No response needed for notifications */
    return null;
  }

  /* Handle tools/list */
  if (method === "tools/list") {
    return jsonRpcResponse(id, { tools: TOOLS });
  }

  /* Handle tools/call */
  if (method === "tools/call") {
    var toolName = params.name;
    var toolParams = params.arguments || {};

    if (!toolName) {
      return jsonRpcError(id, MCP_ERRORS.INVALID_PARAMS);
    }

    var handler = HANDLERS[toolName];
    if (!handler) {
      return jsonRpcError(id, MCP_ERRORS.TOOL_NOT_FOUND);
    }

    try {
      var result = await handler(toolParams);
      return jsonRpcResponse(id, result);
    } catch (e) {
      var code = e.mcpCode || -32002;
      return jsonRpcError(id, mcpError(code, e.message));
    }
  }

  /* Unknown method */
  return jsonRpcError(id, MCP_ERRORS.METHOD_NOT_FOUND);
}

/* ---- Helpers ---- */

function buildHtmlDocument(html, css) {
  if (html.indexOf("<!DOCTYPE") >= 0 || html.indexOf("<html") >= 0) {
    if (css) {
      return html.replace("</head>", "<style>" + css + "</style></head>");
    }
    return html;
  }
  return "<!DOCTYPE html>\n<html lang=\"en\">\n<head>\n  <meta charset=\"UTF-8\">\n  <meta name=\"viewport\" content=\"width=device-width, initial-scale=1.0\">\n  <style>" + (css || "") + "</style>\n</head>\n<body>" + html + "\n</body>\n</html>";
}

/* ---- Stdio mode (MCP transport) ---- */

function startStdioServer() {
  var buffer = "";
  process.stdin.setEncoding("utf-8");
  process.stdin.on("data", function(chunk) {
    buffer += chunk;
    var lines = buffer.split("\n");
    buffer = lines.pop() || "";

    for (var i = 0; i < lines.length; i++) {
      var line = lines[i].trim();
      if (!line) continue;

      var body;
      try {
        body = JSON.parse(line);
      } catch (e) {
        process.stdout.write(JSON.stringify(jsonRpcError(null, MCP_ERRORS.PARSE_ERROR)) + "\n");
        continue;
      }

      /* Handle asynchronously but don't block stdin */
      handleRequest(body).then(function(response) {
        if (response) {
          process.stdout.write(response);
        }
      }).catch(function(e) {
        process.stdout.write(jsonRpcError(body ? body.id : null, MCP_ERRORS.INTERNAL_ERROR));
      });
    }
  });

  process.stdin.on("end", function() {
    process.exit(0);
  });

  process.on("SIGINT", function() { process.exit(0); });
  process.on("SIGTERM", function() { process.exit(0); });

  /* Send initialized notification */
  console.error("[MCP] HTML-to-Design MCP server started in stdio mode");
  console.error("[MCP] Tools available: " + TOOLS.map(function(t) { return t.name; }).join(", "));
}

/* ---- HTTP mode (for testing) ---- */

function startHttpServer(port) {
  var http = require("http");

  var server = http.createServer(async function(req, res) {
    if (req.method !== "POST") {
      res.writeHead(405, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Method not allowed" }));
      return;
    }

    var body = "";
    req.on("data", function(chunk) { body += chunk; });
    req.on("end", async function() {
      var parsed;
      try {
        parsed = JSON.parse(body);
      } catch (e) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify(jsonRpcError(null, MCP_ERRORS.PARSE_ERROR)));
        return;
      }

      var response = await handleRequest(parsed);
      if (response) {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(response.trim());
      } else {
        res.writeHead(202);
        res.end();
      }
    });
  });

  server.listen(port, function() {
    console.error("[MCP] HTTP server listening on http://localhost:" + port);
    console.error("[MCP] Endpoint: POST / with JSON-RPC 2.0 body");
  });
}

/* ---- Entry point ---- */

var args = process.argv.slice(2);
var portIndex = args.indexOf("--port");
if (portIndex >= 0 && portIndex + 1 < args.length) {
  startHttpServer(parseInt(args[portIndex + 1]));
} else {
  startStdioServer();
}
