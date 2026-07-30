import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import {
  copyFile,
  mkdir,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const MODEL_SOURCE =
  "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/latest/pose_landmarker_full.task?generation=1682642787774579";
const MODEL_DESTINATION = new URL(
  "../public/models/pose_landmarker_full.task",
  import.meta.url,
);
const EXPECTED_MODEL_SIZE_BYTES = 9_398_198;
const EXPECTED_MODEL_SHA256 =
  "4eaa5eb7a98365221087693fcc286334cf0858e2eb6e15b506aa4a7ecdcec4ad";
const RUNTIME_ASSETS = [
  "vision_wasm_module_internal.js",
  "vision_wasm_module_internal.wasm",
];
const PACKAGE_WASM_DIRECTORY = new URL(
  "../node_modules/@mediapipe/tasks-vision/wasm/",
  import.meta.url,
);
const PUBLIC_WASM_DIRECTORY = new URL(
  "../public/mediapipe/wasm/",
  import.meta.url,
);

function sha256File(filePath) {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(filePath);

    stream.on("error", reject);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}

async function fileMatches(filePath, expectedSize, expectedSha256) {
  try {
    const fileStat = await stat(filePath);
    if (!fileStat.isFile() || fileStat.size !== expectedSize) {
      return false;
    }
    return (await sha256File(filePath)) === expectedSha256;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

async function prepareModel() {
  const destination = fileURLToPath(MODEL_DESTINATION);
  if (
    await fileMatches(
      destination,
      EXPECTED_MODEL_SIZE_BYTES,
      EXPECTED_MODEL_SHA256,
    )
  ) {
    console.log("Pose Landmarker Full is already prepared.");
    return;
  }

  await mkdir(dirname(destination), { recursive: true });
  const temporaryDestination = `${destination}.download-${process.pid}`;

  try {
    const response = await fetch(MODEL_SOURCE, { redirect: "error" });
    if (!response.ok) {
      throw new Error(
        `Model download failed with HTTP ${response.status} ${response.statusText}.`,
      );
    }
    await writeFile(
      temporaryDestination,
      new Uint8Array(await response.arrayBuffer()),
    );

    if (
      !(await fileMatches(
        temporaryDestination,
        EXPECTED_MODEL_SIZE_BYTES,
        EXPECTED_MODEL_SHA256,
      ))
    ) {
      throw new Error(
        "Downloaded Pose Landmarker Full failed size or SHA-256 verification.",
      );
    }

    await rename(temporaryDestination, destination);
    console.log("Prepared and verified Pose Landmarker Full.");
  } finally {
    await rm(temporaryDestination, { force: true });
  }
}

async function prepareRuntimeAssets() {
  await mkdir(fileURLToPath(PUBLIC_WASM_DIRECTORY), { recursive: true });

  for (const fileName of RUNTIME_ASSETS) {
    const source = fileURLToPath(
      new URL(fileName, PACKAGE_WASM_DIRECTORY),
    );
    const destination = fileURLToPath(
      new URL(fileName, PUBLIC_WASM_DIRECTORY),
    );
    const sourceStat = await stat(source);
    const sourceHash = await sha256File(source);

    if (await fileMatches(destination, sourceStat.size, sourceHash)) {
      continue;
    }

    const temporaryDestination = `${destination}.copy-${process.pid}`;
    try {
      await copyFile(source, temporaryDestination);
      if (
        !(await fileMatches(
          temporaryDestination,
          sourceStat.size,
          sourceHash,
        ))
      ) {
        throw new Error(`Copied runtime asset failed verification: ${fileName}`);
      }
      await rename(temporaryDestination, destination);
    } finally {
      await rm(temporaryDestination, { force: true });
    }
  }

  console.log(
    `Prepared ${RUNTIME_ASSETS.length} self-hosted MediaPipe module assets.`,
  );
}

await Promise.all([prepareModel(), prepareRuntimeAssets()]);
