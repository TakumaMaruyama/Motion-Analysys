import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { evaluateStartAcceptance, formatStartAcceptanceText } from "../lib/validation/start-acceptance.ts";

const args = process.argv.slice(2);
if (args.includes("-h") || args.includes("--help")) {
  console.log("Usage: npm run validation:start -- <manifest.json> [--json]");
  process.exit(0);
}
const json = args.includes("--json");
const files = args.filter((arg) => !arg.startsWith("--"));
if (files.length !== 1) throw new Error("Usage: npm run validation:start -- <manifest.json> [--json]");
let manifest;
try { manifest = JSON.parse(await readFile(resolve(process.cwd(), files[0]), "utf8")); }
catch (error) { throw new Error(`Could not read manifest: ${error instanceof Error ? error.message : String(error)}`); }
const result = evaluateStartAcceptance(manifest);
console.log(json ? JSON.stringify(result, null, 2) : formatStartAcceptanceText(result));
if (!result.passed) process.exitCode = 1;
