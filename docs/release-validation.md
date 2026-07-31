# Release validation

This checklist separates automated checks from measurements that require the
target browser, device, camera, and a rights-cleared representative video set.
A release is not accepted merely because the fields below are blank.

## Current beta status

Status as of 2026-08-01: **free local competitive-swimming measurement beta**.
This label does not mean that the competitive-swimming measurement gates have
passed.

| Product gate | Status | Required evidence before changing status |
| --- | --- | --- |
| Rights-cleared 80-video competitive-swimming validation | **UNVERIFIED** | Recorded ground truth, per-video results, error summary, and signed review covering all four strokes |
| Start-specific detection and measurement | **PENDING VALIDATION** | Separate annotated start set and coaching-use error thresholds |
| Turn-specific detection and measurement | **PENDING VALIDATION** | Separate annotated turn set and coaching-use error thresholds |
| Coach/swimmer field pilot | **UNVERIFIED** | Pilot protocol, consent record, observations, defects, and acceptance decision |
| Official timing or officiating | **OUT OF SCOPE** | The beta must not claim or imply certification for this purpose |
| Medical, diagnostic, rehabilitation, or injury prediction | **OUT OF SCOPE** | The beta must not claim or imply suitability for this purpose |

Do not replace `UNVERIFIED` or `PENDING VALIDATION` with a pass based only on
automated tests, a model-to-model comparison, demonstrations, or developer
judgment.

## Beta product boundary

Validation must use the same boundary described to users:

- input is a video file explicitly selected from the device;
- the camera is fixed for the recording; live-camera input is not offered;
- the selectable strokes are freestyle/front crawl, backstroke, breaststroke,
  and butterfly;
- video and analysis stay in browser memory;
- only the calibration profile may persist, in same-origin `localStorage`;
- there is no account, analysis history, cloud storage, external LLM,
  generative-AI call, external analysis API, or server-side inference; and
- outputs are coaching reference estimates, not official times, officiating
  decisions, or medical results.

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

As of 2026-08-01, `npm run audit:prod` reports zero vulnerabilities. The full
development-dependency audit may still report advisories in the lint/build/test
toolchain; record and review its current output separately instead of treating
it as a production-runtime result or forcing incompatible transitive
overrides.

For a rights-cleared fixed-camera video containing one swimmer, run the
model-backed deterministic golden test:

```bash
MOTION_ANALYSIS_GOLDEN_VIDEO=/absolute/path/to/video.webm \
  npm run test:e2e -- --grep "同一動画"
```

It analyzes the file twice and requires exactly matching presentation
timestamps, detected events, six measurements, and exported CSV bytes. The test
is skipped during ordinary CI when the private validation video is not
provided; a release record must not count a skipped run as evidence.

## Model comparison gate

Use ten or more representative competitive-swimming videos that may legally be
used for internal model comparison. Include all four supported strokes, but do
not treat this 10-video comparison as the separate 80-video product-validation
gate. Do not commit participant videos or identifying filenames. Run Pose
Landmarker Full and MoveNet Thunder as separate development benchmarks;
MoveNet must not be bundled into the production application.

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

`liveRuns` is the current benchmark-report schema name for a developer
throughput measurement. It does not authorize or document a live-camera input
in the beta product.

Failure stops the release. It must not trigger an automatic production-model
switch to MoveNet Thunder.

## 80-video competitive-swimming gate — unverified

This gate has not been run. Before it can pass:

1. Define the validation protocol, ground-truth annotation rules, error
   measures, and acceptance thresholds before looking at aggregate results.
2. Obtain lawful consent and usage rights for at least 80 fixed-camera videos.
3. Cover freestyle/front crawl, backstroke, breaststroke, and butterfly, and
   record the relevant camera view, pool configuration, resolution, frame rate,
   lighting, occlusion, and swimmer level for every video.
4. Keep an immutable mapping from anonymized video ID to annotations and app
   version without committing participant media or identifying filenames.
5. Report failures and excluded videos as well as successful measurements.
6. Review start and turn outputs against their separate annotated sets; a pass
   on surface swimming must not be reused as evidence for either event.

Independent coach labels can be created at `/validation`. This local-only
screen deliberately hides automatic detections and exports a normalized V1
JSON document without the source filename or path. Each coach must label and
export separately before adjudication; using the normal analysis result screen
does not count as independent ground truth because it reveals automatic events.
Valid labels include the known gate distance and each event's source frame index
and presentation timestamp. Invalid or unassessable clips are exported with a
reason and null measurements so they remain part of false-valid-rate testing.

The Swim dataset and decision must satisfy all of the following:

- at least 80 rights-cleared adult videos and at least 20 for each of the four
  strokes;
- two different coaches independently label every gate crossing and stroke
  event before adjudication;
- exact stroke-count agreement on at least 95% of supported-condition clips;
- cycle-rate mean absolute error at most 3 cycles/min;
- average-speed mean absolute percentage error at most 3%;
- gate-crossing error median at most 1 source frame and p90 at most 2 frames;
- fewer than 1% of known low-quality clips incorrectly reported as valid; and
- unknown or suppressed values remain `null` and are never substituted with
  zero.

Store the anonymized labels and predictions outside the repository, then run:

```bash
npm run validation:swim -- /absolute/path/to/swim-validation.json
```

For every coach label, adjudicated reference, and prediction, the manifest must
store `strokeEventFrames` as a strictly increasing source-frame array whose
length equals `strokeCount`; valid events must fall between the two labeled
gate frames. Unavailable measurements use `null`, never an empty or zero
sentinel. This preserves the two independent event-level label sets instead of
retaining only their aggregate counts.

The command is only a deterministic threshold checker. It does not establish
consent, labeling independence, recording conditions, or the correctness of
the supplied reference data by itself.

Record:

| Field | Result |
| --- | --- |
| Protocol/version | UNVERIFIED |
| Rights-cleared adult videos | 0 / 80 verified in this repository |
| Per-stroke minimum | 0 / 20 verified for each stroke |
| Independent coach labels | 0 / 2 verified per video |
| All four strokes represented | UNVERIFIED |
| Ground-truth review | UNVERIFIED |
| Stroke-count exact agreement ≥95% | UNVERIFIED |
| Cycle-rate MAE ≤3 cycles/min | UNVERIFIED |
| Average-speed MAPE ≤3% | UNVERIFIED |
| Gate error median ≤1 frame / p90 ≤2 frames | UNVERIFIED |
| False-valid rate on low-quality clips <1% | UNVERIFIED |
| Start validation | PENDING |
| Turn validation | PENDING |
| Acceptance decision and evidence link | UNVERIFIED |

## Field-pilot gate — unverified

The coach pilot has not been completed. It must run for four weeks with at
least five adult coaches and at least 100 total analyses. At least 80% of
analyses must be completed without assistance, and at least four of the five
coaches must say that they want to continue using the tool before general
release. A pilot record must identify
the app version, participating environment, consent process, fixed-camera setup,
task completion time, corrections to automatically produced measurements,
misleading or unusable outputs, participant feedback, and the decision owner.
Do not infer pilot acceptance from web analytics, downloads, or informal demos.

| Field | Result |
| --- | --- |
| Pilot protocol/version | UNVERIFIED |
| Consent and media-handling review | UNVERIFIED |
| Adult coaches | 0 / 5 verified |
| Pilot duration | 0 / 4 weeks verified |
| Total analyses | 0 / 100 verified |
| Unassisted completion | UNVERIFIED (target ≥80%) |
| Continued-use preference | UNVERIFIED (target ≥4 / 5 coaches) |
| Measurement-correction rate | UNVERIFIED |
| Workflow time and usability findings | UNVERIFIED |
| Safety/privacy incidents | UNVERIFIED |
| Acceptance decision and evidence link | UNVERIFIED |

## Local-only privacy gate

On both target browsers, use developer tools or an equivalent network capture
while loading the app, selecting a video, creating and deleting a calibration
profile, running an analysis, and exporting results. Confirm that:

- video bytes, decoded frames, landmarks, measurements, exports, and
  calibration values are not present in network requests;
- no LLM, generative-AI, external analysis API, telemetry, or advertising
  endpoint is contacted;
- runtime requests after page load are limited to expected same-origin app,
  model, WASM, and navigation resources;
- reloading does not restore a prior video or analysis result;
- the calibration profile persists only in same-origin `localStorage`; and
- clearing site data removes that profile.

Record request logs and storage screenshots without participant images or
identifying filenames.

## Browser scenario matrix

Record the app version, OS, device, browser version, input properties, and
result for each row. Run the matrix on current Chrome and current Safari.

| Scenario | Expected result |
| --- | --- |
| No person | No numeric result; retry guidance |
| Multiple people | Quality is rejected; no swimmer is silently selected |
| Heavy splash / occlusion | Uncertain events require review or remain unavailable |
| Full body outside frame | Missing points suppress dependent values |
| Low light | Low-confidence values are suppressed |
| Partial occlusion | Only metrics whose required points are reliable appear |
| Camera movement / zoom | Calibration warning; result is not marked valid |
| Portrait video | Preview, analysis, overlay, and export preserve orientation |
| Landscape video | Preview, analysis, overlay, and export preserve orientation |
| Below 30fps Swim video | Preview may work; precision analysis remains disabled |
| Unsupported codec | Preview may work; clear re-record/convert guidance; no precision result |
| Analysis cancellation | Returns to a usable preview without stale result |
| Manual marker add/move/delete | Event becomes verified and all six metrics recalculate |
| Live-camera input | No live-camera capture control or permission request is exposed |
| Unsupported media | Clear format error; app remains usable |
| Reload after analysis | Previous video and result are not restored |
| Calibration profile reload | Profile persists only in same-origin `localStorage` |
| Calibration profile reuse | Saved gates are overlaid and require visual confirmation |
| Site-data deletion | Calibration profile is removed |

## Workflow performance gate

Using a 10-second 1080p60 supported video and an already saved calibration on
each target Chrome and Safari device:

- the coach can select the video, confirm the overlaid calibration, and start
  analysis within 30 seconds; and
- the result screen appears within 90 seconds of starting analysis.

Record median and worst-case times, device temperature/power state, browser
version, whether hardware decoding was available, and any excluded or failed
run. A developer desktop result cannot substitute for the target poolside
device.

## Publication transition

The limited beta remains free, link-shared, and `noindex` while any 80-video,
performance, or field-pilot gate is unverified. Remove the beta label and
`noindex` only after the evidence above is reviewed and accepted. Turn and Start
remain visibly marked as under validation and may be enabled independently only
after their own annotated accuracy gates pass.

## Memory and repeated-analysis gate

On each target browser:

1. Warm up the application with a short analysis.
2. Record a heap snapshot or browser memory timeline.
3. Analyze a rights-cleared local video at least five times, returning to input
   between runs.
4. Analyze a longer rights-cleared local video that represents the intended
   beta workload.
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
| Video repetitions | |
| Long-video duration / properties | |
| Initial retained heap | |
| Final retained heap after cleanup | |
| Outstanding raw-frame objects | |
| Detached elements / Workers | |
| Pass / fail and evidence link | |

An initial model/WASM allocation or bounded cache is expected. A retained-heap
trend that grows with elapsed frames or completed runs fails the release.
