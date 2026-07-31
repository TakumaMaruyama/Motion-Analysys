import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import {
  evaluateSwimAcceptance,
  formatSwimAcceptanceText,
} from "../lib/validation/swim-acceptance.ts";

function usage() {
  return [
    "Usage: npm run validation:swim -- <manifest.json> [--json]",
    "",
    "The manifest must reference rights-cleared adult cases without placing footage in the repository.",
  ].join("\n");
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) {
    console.log(usage());
    return;
  }

  const jsonOutput = args.includes("--json");
  const positional = args.filter((argument) => !argument.startsWith("--"));
  const unknownOptions = args.filter(
    (argument) => argument.startsWith("--") && argument !== "--json",
  );
  if (unknownOptions.length > 0) {
    throw new Error(`Unknown option: ${unknownOptions.join(", ")}\n${usage()}`);
  }
  if (positional.length !== 1) {
    throw new Error(usage());
  }

  const manifestPath = resolve(process.cwd(), positional[0]);
  const source = await readFile(manifestPath, "utf8");
  let manifest;
  try {
    manifest = JSON.parse(source);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`Could not parse ${manifestPath} as JSON: ${detail}`);
  }

  const result = evaluateSwimAcceptance(manifest);
  console.log(
    jsonOutput
      ? JSON.stringify(result, null, 2)
      : formatSwimAcceptanceText(result),
  );
  if (!result.passed) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
