import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const MODEL_URL = new URL(
  "../public/models/pose_landmarker_full.task",
  import.meta.url,
);
const EXPECTED_SIZE_BYTES = 9_398_198;
const EXPECTED_SHA256 =
  "4eaa5eb7a98365221087693fcc286334cf0858e2eb6e15b506aa4a7ecdcec4ad";
const RUNTIME_WASM_FILES = [
  "vision_wasm_module_internal.js",
  "vision_wasm_module_internal.wasm",
];
const PUBLIC_WASM_URL = new URL("../public/mediapipe/wasm/", import.meta.url);
const PACKAGE_WASM_URL = new URL(
  "../node_modules/@mediapipe/tasks-vision/wasm/",
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

async function verifyModel() {
  const modelPath = fileURLToPath(MODEL_URL);
  let modelStat;

  try {
    modelStat = await stat(modelPath);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`Bundled pose model is missing or unreadable: ${reason}`);
  }

  if (!modelStat.isFile()) {
    throw new Error(`Bundled pose model is not a regular file: ${modelPath}`);
  }

  if (modelStat.size !== EXPECTED_SIZE_BYTES) {
    throw new Error(
      `Bundled pose model has an unexpected size: expected ${EXPECTED_SIZE_BYTES} bytes, received ${modelStat.size} bytes`,
    );
  }

  const actualSha256 = await sha256File(modelPath);

  if (actualSha256 !== EXPECTED_SHA256) {
    throw new Error(
      `Bundled pose model failed SHA-256 verification: expected ${EXPECTED_SHA256}, received ${actualSha256}`,
    );
  }

  console.log(
    `Verified pose_landmarker_full.task (${EXPECTED_SIZE_BYTES} bytes, sha256:${EXPECTED_SHA256})`,
  );
}

async function verifyRuntimeAssets() {
  const publicWasmPath = fileURLToPath(PUBLIC_WASM_URL);
  const publicFiles = (await readdir(publicWasmPath)).sort();
  const expectedFiles = [...RUNTIME_WASM_FILES].sort();

  if (JSON.stringify(publicFiles) !== JSON.stringify(expectedFiles)) {
    throw new Error(
      `Bundled MediaPipe WASM file set does not match @mediapipe/tasks-vision@1.0.0: expected ${expectedFiles.join(", ")}, received ${publicFiles.join(", ")}`,
    );
  }

  for (const fileName of expectedFiles) {
    const publicAsset = new URL(fileName, PUBLIC_WASM_URL);
    const packageAsset = new URL(fileName, PACKAGE_WASM_URL);
    const [publicHash, packageHash] = await Promise.all([
      sha256File(fileURLToPath(publicAsset)),
      sha256File(fileURLToPath(packageAsset)),
    ]);
    if (publicHash !== packageHash) {
      throw new Error(
        `Bundled MediaPipe WASM asset differs from @mediapipe/tasks-vision@1.0.0: ${fileName}`,
      );
    }
  }

  console.log(
    `Verified ${expectedFiles.length} self-hosted MediaPipe module WASM assets against @mediapipe/tasks-vision@1.0.0`,
  );
}

Promise.all([verifyModel(), verifyRuntimeAssets()]).catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
