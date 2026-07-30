# Release validation

This checklist separates automated checks from measurements that require the
target browser, device, camera, and a rights-cleared representative video set.
A release is not accepted merely because the fields below are blank.

## Automated gate

Run:

```bash
npm ci
npm run audit:prod
npm run verify
npx --no-install playwright install chromium webkit
npm run test:e2e
```

The CI workflow runs the same model-integrity, production-dependency audit,
typecheck, lint, unit, production-build, Chromium, and WebKit gates.

As of 2026-07-30, `npm run audit:prod` reports zero vulnerabilities. A full
development-dependency audit still reports 11 high-severity advisories in the
ESLint/Next lint plugin glob-matching dependency graph. ESLint 10.8.0 was
tested, but the React rule set bundled by `eslint-config-next@16.2.12` is not
yet compatible with it. These packages are not shipped in the production
runtime; revisit the upgrade when the matching Next lint stack supports ESLint
10 instead of forcing incompatible transitive overrides.

For a rights-cleared video containing one fully visible person, run the
model-backed deterministic golden test:

```bash
MOTION_ANALYSIS_GOLDEN_VIDEO=/absolute/path/to/video.webm \
  npm run test:e2e -- --grep "同一動画"
```

It analyzes the file twice, requires exactly matching fixed sample timestamps,
and fails if any comparable valid angle differs by more than 2 degrees. The
test is skipped during ordinary CI when the private validation video is not
provided; a release record must not count a skipped run as evidence.

## Model comparison gate

Use ten or more representative sports-form videos that may legally be used for
internal validation. Do not commit participant videos or identifying
filenames. Run Pose Landmarker Full and MoveNet Thunder as separate development
benchmarks; MoveNet must not be bundled into the production application.

Create a local JSON report with this shape:

```json
{
  "schemaVersion": "1.0",
  "videos": [
    {
      "id": "anonymous-video-01",
      "samples": [
        {
          "timestampMs": 1200,
          "metric": "leftKneeAngle",
          "poseLandmarkerFullDeg": 142.5,
          "moveNetThunderDeg": 147.1
        }
      ]
    }
  ],
  "liveRuns": [
    {
      "device": "target-device-id",
      "browser": "Chrome current",
      "poseLandmarkerFullFps": 18.2
    }
  ]
}
```

Then run:

```bash
npm run benchmark:check -- /absolute/path/to/benchmark-report.json
```

The command exits unsuccessfully unless all of these conditions hold:

- at least 10 unique videos;
- median absolute Full-versus-Thunder angle difference at most 7 degrees;
- p90 absolute angle difference at most 15 degrees;
- every recorded target-device Full live run at least 15 fps.

Failure stops the release. It must not trigger an automatic production-model
switch to MoveNet Thunder.

## Browser scenario matrix

Record the app version, OS, device, browser version, input properties, and
result for each row. Run the matrix on current Chrome and current Safari.

| Scenario | Expected result |
| --- | --- |
| No person | No numeric result; retry guidance |
| Full body outside frame | Missing points suppress dependent values |
| Low light | Low-confidence values are suppressed |
| Partial occlusion | Only metrics whose required points are reliable appear |
| Portrait video | Preview, analysis, overlay, and export preserve orientation |
| Landscape video | Preview, analysis, overlay, and export preserve orientation |
| Analysis cancellation | Returns to a usable preview without stale result |
| Camera permission denied | Recovery guidance and video input remain available |
| Unsupported media | Clear format error; app remains usable |

## Memory and repeated-analysis gate

On each target browser:

1. Warm up the application with a short analysis.
2. Record a heap snapshot or browser memory timeline.
3. Run the live camera for at least 10 minutes.
4. Stop, return to input, and analyze the same local video at least five times.
5. Force or wait for garbage collection when the browser tooling permits it,
   then record another snapshot.
6. Confirm that detached video elements, `ImageBitmap`, raw `ImageData`, and
   Worker instances do not accumulate per sampled frame or per completed run.

Record:

| Field | Result |
| --- | --- |
| App commit | |
| Device / OS | |
| Browser / version | |
| Camera duration | |
| Video repetitions | |
| Initial retained heap | |
| Final retained heap after cleanup | |
| Outstanding raw-frame objects | |
| Detached elements / Workers | |
| Pass / fail and evidence link | |

An initial model/WASM allocation or bounded cache is expected. A retained-heap
trend that grows with elapsed frames or completed runs fails the release.
