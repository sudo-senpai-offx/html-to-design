/*
 * Generates a deliberately heavy, complex self-contained HTML+CSS fixture for
 * stress-testing every converter.
 *
 * Targets:
 *   - file length  >= ~1,000,000 lines (bulk from a huge generated stylesheet)
 *   - body height  <= ~22,000px  (PSD/XD full-page screenshots must stay bounded)
 *   - visible elements ~= maxElements cap (25k) so every converter is saturated
 *   - CSS: huge generated utility sheet + rich real-world rules (gradients,
 *     multi-layer shadows, transforms, clip-path, keyframes, media queries)
 *
 * Usage: node tests/stress/gen-heavy.js [output.html] [utilityClassCount]
 */
const fs = require("fs");
const path = require("path");

/* Deterministic PRNG so the fixture is reproducible. */
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function rnd(seed) {
  return mulberry32(seed);
}
function pick(r, arr) {
  return arr[Math.floor(r() * arr.length)];
}
function n(r, a, b) {
  return Math.floor(a + r() * (b - a + 1));
}
function hsl(r, s, l) {
  return "hsl(" + n(r, 0, 360) + "," + (s || n(r, 55, 90)) + "%," + (l || n(r, 40, 85)) + "%)";
}
function rgba(r, a) {
  return "rgba(" + n(r, 0, 255) + "," + n(r, 0, 255) + "," + n(r, 0, 255) + "," + (a == null ? 0.3 + r() * 0.6 : a).toFixed(2) + ")";
}

/* ---------------------------------------------------------------------------
 * CSS: large generated utility sheet + rich component sheet
 * ------------------------------------------------------------------------- */
function makeUtilityCss(count) {
  const r = rnd(7);
  const lines = [];
  for (let i = 0; i < count; i++) {
    const g = pick(r, [
      "linear-gradient(" + n(r, 0, 360) + "deg, " + hsl(r) + " 0%, " + hsl(r) + " 45%, " + hsl(r) + " 100%)",
      "linear-gradient(to " + pick(r, ["right", "bottom", "bottom right", "left top"]) + ", " + rgba(r) + " 0%, " + rgba(r, 0) + " 70%)",
      "radial-gradient(circle at " + n(r, 0, 100) + "% " + n(r, 0, 100) + "%, " + hsl(r) + ", " + hsl(r) + ")",
      "conic-gradient(from " + n(r, 0, 360) + "deg, " + hsl(r) + ", " + hsl(r) + ", " + hsl(r) + ")",
    ]);
    lines.push(
      ".u" + i + " {",
      "  background-image: " + g + ";",
      "  box-shadow: 0 " + n(r, 0, 4) + "px " + n(r, 4, 24) + "px " + rgba(r, 0.35) + ";",
      "  border-radius: " + n(r, 2, 20) + "px;",
      "  border: " + n(r, 0, 2) + "px solid " + rgba(r, 0.5) + ";",
      "  transform: rotate(" + n(r, -2, 2) + "deg) scale(" + (0.95 + r() * 0.12).toFixed(2) + ");",
      "  text-shadow: 0 1px 2px " + rgba(r, 0.4) + ";",
      "  filter: brightness(" + (0.92 + r() * 0.2).toFixed(2) + ");",
      "  transition: transform 0.2s ease;",
      "}",
      ".u" + i + ":hover { transform: translateY(-2px); }"
    );
  }
  return lines.join("\n");
}

function makeComponentCss() {
  return [
    "* { box-sizing: border-box; margin: 0; padding: 0; }",
    "body { font-family: 'Inter', 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background: #f4f5f7; color: #1a202c; }",
    ":root { --brand: #5b5bd6; --ink: #1a202c; --muted: #718096; --line: #e2e8f0; --radius: 14px; }",
    ".shell { max-width: 1440px; margin: 0 auto; padding: 0 24px; }",
    "header.site { position: sticky; top: 0; z-index: 50; display: flex; align-items: center; gap: 24px; height: 72px; padding: 0 32px; background: rgba(255,255,255,.92); backdrop-filter: blur(8px); border-bottom: 1px solid var(--line); }",
    ".logo { display: flex; align-items: center; gap: 12px; font-weight: 800; font-size: 20px; }",
    ".logo .mark { width: 36px; height: 36px; border-radius: 10px; background: linear-gradient(135deg, #5b5bd6, #22d3ee); box-shadow: 0 6px 18px rgba(91,91,214,.4); }",
    "nav.tabs { display: flex; gap: 4px; }",
    "nav.tabs a { padding: 8px 16px; border-radius: 999px; color: var(--muted); text-decoration: none; font-weight: 600; }",
    "nav.tabs a:hover { background: #edf2f7; color: var(--ink); }",
    "nav.tabs a.active { background: var(--brand); color: #fff; box-shadow: 0 4px 12px rgba(91,91,214,.35); }",
    ".btn { display: inline-flex; align-items: center; gap: 8px; padding: 10px 20px; border-radius: 10px; border: 0; font-weight: 700; cursor: pointer; }",
    ".btn.primary { background: linear-gradient(180deg, #6a6af0, #4f4fc8); color: #fff; box-shadow: 0 8px 24px rgba(91,91,214,.45); }",
    ".btn.ghost { background: transparent; color: var(--ink); border: 1px solid var(--line); }",
    ".hero { position: relative; padding: 96px 0 72px; background: radial-gradient(1200px 600px at 20% -10%, rgba(91,91,214,.25), transparent 60%), radial-gradient(900px 500px at 90% 10%, rgba(34,211,238,.22), transparent 55%), linear-gradient(180deg, #fff, #f7f8fc); }",
    ".hero h1 { font-size: 64px; line-height: 1.05; letter-spacing: -2px; max-width: 15ch; }",
    ".hero h1 span { background: linear-gradient(90deg, #5b5bd6, #22d3ee, #f472b6); -webkit-background-clip: text; color: transparent; }",
    ".hero p { margin-top: 24px; max-width: 52ch; color: var(--muted); font-size: 18px; line-height: 1.6; }",
    ".grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 24px; }",
    ".card { position: relative; background: #fff; border: 1px solid var(--line); border-radius: var(--radius); padding: 24px; box-shadow: 0 1px 2px rgba(16,24,40,.04), 0 8px 24px -8px rgba(16,24,40,.12); }",
    ".card .thumb { height: 140px; border-radius: 10px; margin-bottom: 16px; }",
    ".card h3 { font-size: 18px; margin-bottom: 8px; }",
    ".card p { color: var(--muted); font-size: 14px; line-height: 1.5; }",
    ".badge { display: inline-flex; align-items: center; gap: 6px; padding: 4px 10px; border-radius: 999px; font-size: 12px; font-weight: 700; }",
    ".badge.green { background: #d1fae5; color: #065f46; }",
    ".badge.red { background: #fee2e2; color: #991b1b; }",
    ".avatar { border-radius: 50%; display: inline-block; border: 3px solid #fff; box-shadow: 0 2px 8px rgba(16,24,40,.18); }",
    ".table { width: 100%; border-collapse: collapse; background: #fff; border-radius: 12px; overflow: hidden; box-shadow: 0 1px 3px rgba(16,24,40,.08); }",
    ".table th { text-align: left; padding: 14px 18px; background: #f9fafb; color: var(--muted); font-size: 12px; text-transform: uppercase; letter-spacing: .06em; }",
    ".table td { padding: 14px 18px; border-top: 1px solid var(--line); font-size: 14px; }",
    ".table tr:nth-child(even) { background: #fbfbfe; }",
    ".bar { height: 8px; border-radius: 999px; background: #edf2f7; overflow: hidden; }",
    ".bar > i { display: block; height: 100%; border-radius: 999px; background: linear-gradient(90deg, #5b5bd6, #22d3ee); }",
    ".field { display: grid; gap: 6px; margin-bottom: 16px; }",
    ".field label { font-weight: 700; font-size: 13px; color: var(--ink); }",
    ".field input, .field select, .field textarea { padding: 12px 14px; border: 1px solid var(--line); border-radius: 10px; font-size: 14px; outline: none; }",
    ".field input:focus { border-color: var(--brand); box-shadow: 0 0 0 3px rgba(91,91,214,.2); }",
    ".timeline { position: relative; padding-left: 28px; }",
    ".timeline::before { content: \"\"; position: absolute; left: 8px; top: 0; bottom: 0; width: 2px; background: linear-gradient(180deg, var(--brand), transparent); }",
    ".timeline .step { position: relative; margin-bottom: 24px; }",
    ".timeline .step::before { content: \"\"; position: absolute; left: -24px; top: 4px; width: 12px; height: 12px; border-radius: 50%; background: var(--brand); box-shadow: 0 0 0 4px rgba(91,91,214,.2); }",
    ".chip { display: inline-block; padding: 4px 10px; border-radius: 8px; background: #edf2f7; font-size: 12px; font-weight: 600; }",
    ".sparkline { display: flex; align-items: flex-end; gap: 2px; height: 40px; }",
    ".sparkline i { flex: 1; border-radius: 2px; background: linear-gradient(180deg, #6a6af0, #b3b3f7); }",
    ".kbd { padding: 2px 6px; border: 1px solid var(--line); border-bottom-width: 2px; border-radius: 6px; background: #fff; font-family: ui-monospace, monospace; font-size: 12px; }",
    ".tooltip { position: relative; }",
    ".tooltip::after { content: attr(data-tip); position: absolute; bottom: 120%; left: 50%; transform: translateX(-50%); padding: 6px 10px; border-radius: 8px; background: #1a202c; color: #fff; font-size: 12px; white-space: nowrap; opacity: 0; pointer-events: none; transition: opacity .15s ease; }",
    ".tooltip:hover::after { opacity: 1; }",
    "@media (max-width: 1024px) { .grid { grid-template-columns: repeat(2, 1fr); } }",
    "@media (max-width: 768px) { .grid { grid-template-columns: 1fr; } }",
    "@keyframes spin { to { transform: rotate(360deg); } }",
    "@keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: .5; } }",
    ".spin { animation: spin 1.2s linear infinite; }",
    ".pulse { animation: pulse 2s ease-in-out infinite; }",
    ".loading { width: 40px; height: 40px; border-radius: 50%; border: 4px solid #e2e8f0; border-top-color: var(--brand); }",
    "footer.site { margin-top: 48px; padding: 48px 0; border-top: 1px solid var(--line); background: #fff; }",
    "footer.site .cols { display: grid; grid-template-columns: repeat(4, 1fr); gap: 32px; }",
    "footer.site h4 { font-size: 13px; text-transform: uppercase; letter-spacing: .08em; color: var(--muted); margin-bottom: 12px; }",
    "footer.site a { display: block; color: var(--ink); text-decoration: none; padding: 4px 0; font-size: 14px; }",
    "footer.site a:hover { color: var(--brand); }",
  ].join("\n");
}

/* ---------------------------------------------------------------------------
 * HTML building blocks
 * ------------------------------------------------------------------------- */
function widgetHtml(r, id) {
  return [
    '<div class="widget" style="position:relative;width:96px;height:64px;overflow:hidden;">',
    '  <div class="thumb" style="width:100%;height:30px;background:' + hsl(r) + ';"></div>',
    '  <div style="padding:4px 8px;font-size:10px;font-weight:700;">W' + id + "</div>",
    '  <span class="badge ' + pick(r, ["green", "red"]) + '" style="position:absolute;top:3px;right:3px;font-size:9px;">' + n(r, 1, 999) + "</span>",
    "</div>",
  ].join("\n");
}

function chipHtml(r, id) {
  return [
    '<span class="chip u' + n(r, 0, 70000) + '" style="display:inline-flex;align-items:center;gap:4px;padding:2px 8px;font-size:10px;white-space:nowrap;overflow:hidden;">' +
    '<i style="display:inline-block;width:6px;height:6px;border-radius:50%;background:' + hsl(r) + ';"></i>C' + id + "</span>",
  ].join("\n");
}

function cardHtml(r, id) {
  const g = pick(r, [
    "linear-gradient(135deg,#5b5bd6,#22d3ee)",
    "linear-gradient(120deg,#f472b6,#fbbf24)",
    "radial-gradient(circle at 30% 20%,#34d399,#0ea5e9)",
    "linear-gradient(90deg,#f97316,#ef4444)",
    "conic-gradient(from 40deg,#22d3ee,#a78bfa,#f472b6,#22d3ee)",
  ]);
  return [
    '<div class="card">',
    '  <div class="thumb u' + n(r, 0, 70000) + '" style="background:' + g + ';"></div>',
    '  <h3>Card ' + id + " — " + pick(r, ["Analytics", "Billing", "Reports", "Audience", "Automation", "Search"]) + "</h3>",
    '  <p>' + pick(r, ["Track every metric with real-time dashboards.", "Automate your workflow with powerful rules.", "Segment customers by behavior and cohorts.", "Export pixel-perfect reports in one click."]) + "</p>",
    '  <div style="display:flex;align-items:center;gap:8px;margin-top:16px;">',
    '    <span class="avatar" style="width:28px;height:28px;background:' + hsl(r) + ';"></span>',
    '    <span class="chip">' + pick(r, ["v2.1", "beta", "pro", "team"]) + "</span>",
    '    <span class="badge green">● live</span>',
    "  </div>",
    "</div>",
  ].join("\n");
}

function tableRows(r, count) {
  const rows = [];
  for (let i = 0; i < count; i++) {
    rows.push(
      "<tr><td><div style=\"display:flex;align-items:center;gap:10px;\"><span class=\"avatar\" style=\"width:24px;height:24px;background:" + hsl(r) + ";\"></span>" +
        "User " + n(r, 10000, 99999) + "</div></td>" +
        "<td>user" + i + "@example.com</td>" +
        "<td><span class=\"badge " + pick(r, ["green", "red"]) + "\">" + pick(r, ["Active", "Paused", "Trial"]) + "</span></td>" +
        "<td>" + n(r, 1, 90) + " d</td>" +
        "<td><div class=\"bar\" style=\"width:120px;\"><i style=\"width:" + n(r, 10, 95) + "%;\"></i></div></td>" +
        "</tr>"
    );
  }
  return rows.join("\n");
}

function formHtml(r) {
  return [
    '<form class="card" style="display:grid;grid-template-columns:1fr 1fr;gap:0 24px;">',
    '  <div class="field"><label>Full name</label><input type="text" placeholder="Ada Lovelace"></div>',
    '  <div class="field"><label>Email</label><input type="email" placeholder="ada@example.com"></div>',
    '  <div class="field"><label>Plan</label><select><option>Free</option><option>Pro</option><option>Enterprise</option></select></div>',
    '  <div class="field"><label>Role</label><select><option>Owner</option><option>Admin</option><option>Member</option></select></div>',
    '  <div class="field" style="grid-column:1/-1;"><label>Notes</label><textarea rows="3"></textarea></div>',
    '  <div style="grid-column:1/-1;display:flex;gap:12px;justify-content:flex-end;">',
    '    <button class="btn ghost">Cancel</button>',
    '    <button class="btn primary">Save changes</button>',
    "  </div>",
    "</form>",
  ].join("\n");
}

function timelineHtml(r, steps) {
  const out = ['<div class="timeline" style="padding:24px;">'];
  for (let i = 0; i < steps; i++) {
    out.push(
      '<div class="step"><strong>' + pick(r, ["Deploy", "Review", "Build", "Release", "Sync"]) + " " + i + "</strong>" +
      '<div style="color:var(--muted);font-size:13px;">' + n(r, 1, 30) + "m ago by " + pick(r, ["Ava", "Noah", "Liam", "Mia"]) + "</div></div>"
    );
  }
  out.push("</div>");
  return out.join("\n");
}

function sparkBand(r, id, cols) {
  const out = [];
  for (let i = 0; i < cols; i++) {
    const vals = [];
    for (let k = 0; k < 12; k++) vals.push(n(r, 10, 100));
    out.push(
      '<div style="flex:1;padding:12px;background:#fff;border:1px solid var(--line);border-radius:12px;">' +
      '<div style="display:flex;justify-content:space-between;font-size:12px;color:var(--muted);">S' + id + "-" + i + "<b>" + n(r, 100, 9999) + "</b></div>" +
      '<div class="sparkline">' + vals.map(function (v) { return "<i style=\"height:" + v + "%;\"></i>"; }).join("") + "</div>" +
      '<div class="bar" style="margin-top:8px;"><i style="width:' + n(r, 20, 95) + '%;"></i></div>' +
      "</div>"
    );
  }
  return '<div style="display:flex;gap:12px;padding:16px 0;">' + out.join("") + "</div>";
}

/* ---------------------------------------------------------------------------
 * Assembly
 * ------------------------------------------------------------------------- */
function build(k, cssCount, chips, miniWidgets) {
  const r = rnd(4242);
  const chunks = [];
  const push = (s) => chunks.push(s);

  push("<!doctype html>\n<html lang=\"en\">\n<head>\n<meta charset=\"utf-8\">\n<title>Heavy Stress Fixture</title>\n<style>");
  push(makeComponentCss());
  push("\n/* ---- generated utility sheet ---- */\n");
  push(makeUtilityCss(cssCount));
  push("</style>\n</head>\n<body>\n");

  push('<header class="site"><div class="logo"><div class="mark"></div>HeavyOS</div><nav class="tabs"><a class="active">Overview</a><a>Analytics</a><a>Reports</a><a>Settings</a></nav><button class="btn ghost">Docs</button><button class="btn primary">Upgrade</button></header>');
  push('<section class="hero"><h1>Ship <span>complex</span> pages.</h1><p>This fixture deliberately packs gradients, shadows, transforms, tables, forms, sparklines and thousands of widgets into one bounded document.</p><div style="display:flex;gap:12px;margin-top:32px;"><button class="btn primary">Get started</button><button class="btn ghost">View demo</button></div></section>');

  for (let i = 0; i < k; i++) {
    push('<section class="shell" style="padding-top:32px;"><div class="grid">');
    for (let c = 0; c < 6; c++) push(cardHtml(r, i * 6 + c));
    push("</div></section>");

    push('<section class="shell"><h2 style="margin:24px 0 12px;">Band ' + i + "</h2>");
    push(sparkBand(r, i, 8));
    push("</section>");

    push('<section class="shell"><div class="card" style="padding:0;overflow:hidden;"><table class="table"><thead><tr><th>User</th><th>Email</th><th>Status</th><th>Usage</th><th>Progress</th></tr></thead><tbody>');
    push(tableRows(r, 12));
    push("</tbody></table></div></section>");

    push('<section class="shell" style="display:grid;grid-template-columns:1fr 1fr;gap:24px;padding-top:32px;">');
    push(formHtml(r));
    push(timelineHtml(r, 10));
    push("</section>");
  }

  push('<section class="shell"><h2 style="margin:32px 0 12px;">Widget farm</h2><div style="display:flex;flex-wrap:wrap;gap:12px;">');
  for (let i = 0; i < miniWidgets; i++) push(widgetHtml(r, i));
  push("</div></section>");

  push('<section class="shell"><h2 style="margin:32px 0 12px;">Chip farm</h2><div style="display:flex;flex-wrap:wrap;gap:6px;">');
  for (let i = 0; i < chips; i++) push(chipHtml(r, i));
  push("</div></section>");

  push('<footer class="site"><div class="shell cols"><div><h4>Product</h4><a>Overview</a><a>Features</a><a>Pricing</a><a>Changelog</a></div><div><h4>Company</h4><a>About</a><a>Blog</a><a>Careers</a><a>Contact</a></div><div><h4>Resources</h4><a>Docs</a><a>API</a><a>Community</a><a>Status</a></div><div><h4>Legal</h4><a>Privacy</a><a>Terms</a><a>Security</a></div></div></footer>');
  push("</body>\n</html>\n");

  return chunks.join("\n");
}

function stats(html) {
  const lines = html.split("\n").length;
  const divs = (html.match(/<div\b/g) || []).length;
  const spans = (html.match(/<span\b/g) || []).length;
  const svgs = (html.match(/<svg\b/g) || []).length;
  const rules = (html.match(/\{/g) || []).length;
  return { lines, divs, spans, svgs, rules, estNodes: divs + spans + svgs };
}

const outPath = process.argv[2] || path.join(__dirname, "fixtures", "heavy.html");
const cssCount = parseInt(process.argv[3], 10) || 92000;
const chips = parseInt(process.argv[4], 10) || 5000;
const miniWidgets = parseInt(process.argv[5], 10) || 300;
fs.mkdirSync(path.dirname(outPath), { recursive: true });
const html = build(3, cssCount, chips, miniWidgets);
const s = stats(html);
fs.writeFileSync(outPath, html, "utf-8");
console.log("Wrote " + outPath);
console.log("  lines=" + s.lines.toLocaleString() + " estNodes=" + s.estNodes.toLocaleString() +
  " (divs=" + s.divs.toLocaleString() + " spans=" + s.spans.toLocaleString() + ") cssRules=" + s.rules.toLocaleString() + " size=" + (fs.statSync(outPath).size / 1048576).toFixed(1) + "MB");
