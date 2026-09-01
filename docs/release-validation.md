# MotionAnalysys Start release validation

This checklist separates software checks from validation that requires
rights-cleared videos, independent coaches, target devices, and ground truth.
Blank evidence is not a pass.

## Current beta status

Status as of 2026-09-01: **unvalidated local swimming-start analysis beta**.

| Product gate | Status | Evidence required before changing status |
| --- | --- | --- |
| Start validation: 80 videos / 20 per stroke | **UNVERIFIED** | Versioned protocol, rights and consent record, two independent label sets, adjudication, predictions, error report |
| 120fps event accuracy | **UNVERIFIED** | Takeoff and head-entry median ≤1 frame and p90 ≤2 frames |
| 60fps event accuracy | **UNVERIFIED** | Takeoff and head-entry median ≤2 frames and p90 ≤4 frames |
| Entry distance accuracy | **UNVERIFIED** | MAE ≤0.25m |
| 2D forward velocity accuracy | **UNVERIFIED** | MAPE ≤5% against a compatible reference method |
| Low-quality false-valid rate | **UNVERIFIED** | Less than 5% |
| Coach field pilot | **UNVERIFIED** | Protocol, consent, workflow findings, defect log, acceptance decision |
| Official timing or officiating | **OUT OF SCOPE** | The app must not imply certification |
| Underwater, force, power, work, medical use | **OUT OF SCOPE** | The app must not claim these capabilities |

Do not change `UNVERIFIED` based only on automated tests, developer judgment,
the existence of published research, or a demonstration video.

## Product boundary to validate

- public UI is Start-only; Swim, Turn, and stroke measurement are not imported;
- freestyle, butterfly, and breaststroke use a dive start;
- backstroke uses a wall start;
- users are at least 13 years old;
- input is a device-selected video from one fixed, side-on, above-water phone;
- 0m wall, 5m position, and water surface are visible;
- minimum frame rate is 60fps and 120fps is recommended;
- video, decoded frames, Pose, events, and results remain in the browser;
- automatic output is a candidate only;
- a metric is calculated only when every required event is coach-verified;
- missing or invalid values are `null`, never zero;
- only a calibration profile may use same-origin `localStorage`;
- age and research sex category are session-only and appear only in an explicit
  user export;
- no account, DB, cloud history, video upload, external analysis API, LLM, or
  server-side inference is present;
- outputs are coaching references, not official timing, officiating, medical
  assessment, diagnosis, or talent selection.

## Automated software gate

Run from the repository root:

```bash
npm ci
npm run audit:prod
npm run verify
npx --no-install playwright install chromium webkit
npm run test:e2e
npm run validation:start -- --help
```

`npm run verify` covers pinned assets, model integrity, TypeScript, lint, unit
tests, and the production build. Record exact command output and commit SHA.

The Start acceptance checker requires a real external manifest. Running help,
unit tests, or a synthetic fixture proves the checker works; it does not prove
that the 80-video gate passed.

## Independent Start annotations

Use `/validation`. This screen must not reveal automatic candidates. Each
coach labels and exports independently before adjudication.

Each annotation must include:

- anonymous video ID and anonymous annotator ID;
- stroke, age when available, and research sex category when available;
- effective frame rate and fixed/side-on/single-swimmer capture declarations;
- 0m, 5m, and two water-surface calibration points;
- signal, movement onset, hands off, rear-foot off for dive starts, takeoff,
  head entry, and optional 5m head crossing;
- source frame index and presentation timestamp for each available event;
- `null` for unavailable events or calibration points;
- rights-cleared, minor-consent, and footage-outside-repository declarations;
- no source filename, path, URL, participant name, or video bytes.

The two coach IDs must be distinct. Keep raw labels, adjudicated references,
predictions, consent evidence, and media outside the repository.

## 80-video Start acceptance gate

Before looking at aggregate results:

1. Freeze the protocol, event definitions, exclusion rules, metrics, and
   thresholds.
2. Obtain lawful rights and required consent for at least 80 videos.
3. Include at least 20 videos for each of freestyle, butterfly, breaststroke,
   and backstroke.
4. Include both 60fps and 120fps evidence in every event-error report.
5. Deliberately include no-signal, foot occlusion, splash, multiple-person,
   camera-motion, and invisible-5m cases.
6. Have two coaches annotate every clip independently before adjudication.
7. Preserve failed, excluded, invalid, and unassessable clips in the report.
8. Compare predictions from the exact release candidate against adjudicated
   references.

Run:

```bash
npm run validation:start -- /absolute/path/to/start-validation.json
```

Acceptance requires all of the following:

- at least 80 valid reference clips;
- at least 20 valid reference clips for each stroke;
- 120fps takeoff/head-entry error: median ≤1 frame, p90 ≤2 frames;
- 60fps takeoff/head-entry error: median ≤2 frames, p90 ≤4 frames;
- entry-distance MAE ≤0.25m with no missing valid-case values;
- calibrated 2D forward-velocity MAPE ≤5% with no missing valid-case values;
- false-valid rate on intentionally invalid/low-quality clips <5%; and
- unavailable results remain `null`.

The command only checks the supplied manifest. It cannot verify that consent
was genuine, labeling was independent, the camera was fixed, or the reference
method was correct.

Record:

| Field | Result |
| --- | --- |
| Protocol/version | UNVERIFIED |
| Release SHA | UNVERIFIED |
| Rights-cleared videos | 0 / 80 verified in this repository |
| Freestyle | 0 / 20 verified |
| Butterfly | 0 / 20 verified |
| Breaststroke | 0 / 20 verified |
| Backstroke | 0 / 20 verified |
| Two independent coaches | UNVERIFIED |
| Adjudication complete | UNVERIFIED |
| 120fps median/p90 | UNVERIFIED |
| 60fps median/p90 | UNVERIFIED |
| Entry-distance MAE | UNVERIFIED |
| 2D velocity MAPE | UNVERIFIED |
| Low-quality false-valid rate | UNVERIFIED |
| Acceptance owner and decision | UNVERIFIED |

If an automatic event fails a threshold, demote that event to manual-only.
Do not relax the threshold after inspecting results without a new protocol
version and independent holdout set.

## Browser scenario matrix

Run on current Chrome and Safari using target poolside phones/tablets. Record
app SHA, OS, browser version, device, video properties, and evidence.

| Scenario | Expected result |
| --- | --- |
| 13 years old | Analysis may proceed |
| Under 13 | Analysis cannot start |
| 33 or older | Analysis may proceed; no research band |
| 120fps fixed side view | Recommended-condition message |
| 60fps fixed side view | Allowed with precision warning |
| Below 60fps | Precision analysis disabled |
| No audible signal / no flash | Signal remains unavailable or manual-only |
| Feet occluded | Takeoff remains review/unavailable; dependent metrics null |
| Heavy splash at entry | Head entry remains review/unavailable |
| Multiple people | Quality rejected; no silent swimmer selection |
| Camera pan, zoom, or rotation | Calibration/quality rejected |
| 5m not visible | 5m metric and percentile unavailable |
| External stopwatch 5m value | May be stored as external; never used for percentile |
| Dive start | Rear-foot-off event is available for review |
| Backstroke start | Dive-only rear-foot-off is absent |
| Candidate event | No dependent numeric metric |
| Verify event | Only its satisfied dependent metrics recalculate |
| Undo/redo correction | Events, metrics, and bands return deterministically |
| Head-entry point click | Entry distance uses the selected point |
| Right-to-left travel | Calibrated forward distance remains positive |
| Unsupported codec | Clear error and usable reset path |
| Reload | Video, results, age, and research sex are not restored |
| Calibration reuse | Only calibration is restored and requires visual confirmation |

## Research-reference gate

For every release that changes `lib/start/references.ts`:

- compare all 32 records against Born et al. (2026), Appendix A, Tables A1–A8;
- verify exact P3/P10/P25/P50/P75/P90/P97 values;
- verify stroke and sex mapping;
- verify block versus wall-contact naming for backstroke;
- verify explicit performance direction;
- verify age 13–32 display and age 33+ suppression;
- verify entry-time and entry-distance are labeled as method-sensitive;
- verify attribution, DOI, CC BY 4.0, and transformation notice on `/research`
  and `/licenses`;
- verify no grade, pass/fail, talent label, or composite score is generated.

## Local-only privacy gate

Using a network capture on both target browsers, load the app, select a video,
run candidate analysis, confirm events, export results, and reload. Confirm:

- video bytes, decoded frames, landmarks, events, metrics, calibration, age,
  research sex category, and exports do not appear in network requests;
- runtime requests are limited to same-origin app, model, WASM, and navigation
  resources;
- no LLM, generative AI, external analysis API, telemetry, or ad endpoint is
  contacted;
- reload does not restore video, analysis, age, or research sex category;
- only calibration may remain in same-origin `localStorage`; and
- clearing site data removes calibration.

Capture logs without participant images, names, or source filenames.

## Publication transition

Keep the visible `未検証ベータ` label and `noindex` while the Start validation,
target-browser, privacy, and field-pilot gates are unverified. A successful
build or Sites deployment does not change validation status. Publishing is a
separate authorized operation and is not part of this checklist run.
