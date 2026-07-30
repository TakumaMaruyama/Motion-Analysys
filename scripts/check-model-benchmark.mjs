import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const MINIMUM_VIDEO_COUNT = 10;
const MAXIMUM_MEDIAN_ERROR_DEG = 7;
const MAXIMUM_P90_ERROR_DEG = 15;
const MINIMUM_LIVE_FPS = 15;

function fail(message) {
  throw new Error(`Benchmark report is invalid: ${message}`);
}

function finiteNumber(value, path) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    fail(`${path} must be a finite number`);
  }
  return value;
}

function nonEmptyString(value, path) {
  if (typeof value !== "string" || value.trim().length === 0) {
    fail(`${path} must be a non-empty string`);
  }
  return value;
}

function percentile(values, quantile) {
  const ordered = [...values].sort((first, second) => first - second);
  const position = (ordered.length - 1) * quantile;
  const lowerIndex = Math.floor(position);
  const upperIndex = Math.ceil(position);
  if (lowerIndex === upperIndex) {
    return ordered[lowerIndex];
  }
  const weight = position - lowerIndex;
  return (
    ordered[lowerIndex] * (1 - weight) +
    ordered[upperIndex] * weight
  );
}

function inspectReport(report) {
  if (!report || typeof report !== "object" || Array.isArray(report)) {
    fail("root must be an object");
  }
  if (report.schemaVersion !== "1.0") {
    fail('schemaVersion must be "1.0"');
  }
  if (!Array.isArray(report.videos)) {
    fail("videos must be an array");
  }
  if (!Array.isArray(report.liveRuns)) {
    fail("liveRuns must be an array");
  }

  const videoIds = new Set();
  const errors = [];
  report.videos.forEach((video, videoIndex) => {
    const basePath = `videos[${videoIndex}]`;
    const id = nonEmptyString(video?.id, `${basePath}.id`);
    if (videoIds.has(id)) {
      fail(`${basePath}.id duplicates "${id}"`);
    }
    videoIds.add(id);
    if (!Array.isArray(video.samples) || video.samples.length === 0) {
      fail(`${basePath}.samples must contain at least one angle pair`);
    }
    video.samples.forEach((sample, sampleIndex) => {
      const samplePath = `${basePath}.samples[${sampleIndex}]`;
      nonEmptyString(sample?.metric, `${samplePath}.metric`);
      finiteNumber(sample?.timestampMs, `${samplePath}.timestampMs`);
      const full = finiteNumber(
        sample?.poseLandmarkerFullDeg,
        `${samplePath}.poseLandmarkerFullDeg`,
      );
      const thunder = finiteNumber(
        sample?.moveNetThunderDeg,
        `${samplePath}.moveNetThunderDeg`,
      );
      errors.push(Math.abs(full - thunder));
    });
  });

  if (videoIds.size < MINIMUM_VIDEO_COUNT) {
    fail(
      `at least ${MINIMUM_VIDEO_COUNT} unique videos are required; received ${videoIds.size}`,
    );
  }
  if (report.liveRuns.length === 0) {
    fail("liveRuns must contain at least one target-device run");
  }

  const liveFps = report.liveRuns.map((run, runIndex) => {
    const basePath = `liveRuns[${runIndex}]`;
    nonEmptyString(run?.device, `${basePath}.device`);
    nonEmptyString(run?.browser, `${basePath}.browser`);
    return finiteNumber(
      run?.poseLandmarkerFullFps,
      `${basePath}.poseLandmarkerFullFps`,
    );
  });

  const medianErrorDeg = percentile(errors, 0.5);
  const p90ErrorDeg = percentile(errors, 0.9);
  const minimumLiveFps = Math.min(...liveFps);
  const checks = {
    minimumVideoCount: videoIds.size >= MINIMUM_VIDEO_COUNT,
    medianError: medianErrorDeg <= MAXIMUM_MEDIAN_ERROR_DEG,
    p90Error: p90ErrorDeg <= MAXIMUM_P90_ERROR_DEG,
    liveFps: minimumLiveFps >= MINIMUM_LIVE_FPS,
  };

  return {
    passed: Object.values(checks).every(Boolean),
    thresholds: {
      minimumVideoCount: MINIMUM_VIDEO_COUNT,
      maximumMedianErrorDeg: MAXIMUM_MEDIAN_ERROR_DEG,
      maximumP90ErrorDeg: MAXIMUM_P90_ERROR_DEG,
      minimumLiveFps: MINIMUM_LIVE_FPS,
    },
    observed: {
      videoCount: videoIds.size,
      anglePairCount: errors.length,
      medianErrorDeg,
      p90ErrorDeg,
      minimumLiveFps,
    },
    checks,
  };
}

async function main() {
  const reportPath = process.argv[2];
  if (!reportPath) {
    throw new Error(
      "Usage: npm run benchmark:check -- <benchmark-report.json>",
    );
  }
  const absolutePath = resolve(process.cwd(), reportPath);
  const report = JSON.parse(await readFile(absolutePath, "utf8"));
  const result = inspectReport(report);
  console.log(JSON.stringify(result, null, 2));
  if (!result.passed) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
