import * as esbuild from "esbuild";
import * as path from "path";
import { fileURLToPath } from "url";

var dir = path.dirname(fileURLToPath(import.meta.url));
var watch = process.argv.includes("--watch");

var config = {
  entryPoints: [path.join(dir, "src", "code.ts")],
  outfile: path.join(dir, "dist", "code.js"),
  bundle: true,
  minify: false,
  format: "cjs",
  platform: "node",
  target: "es2017",
  tsconfig: path.join(dir, "tsconfig.json"),
  logLevel: "info",
};

if (watch) {
  var ctx = await esbuild.context(config);
  await ctx.watch();
  console.log("watching...");
} else {
  await esbuild.build(config);
  console.log("built: dist/code.js");
}
