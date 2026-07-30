# Model sources and selection record

## Production model

MotionAnalysys uses MediaPipe Pose Landmarker Full for single-person,
local-only pose estimation in the browser.

| Item | Recorded value |
| --- | --- |
| Runtime | `@mediapipe/tasks-vision@1.0.0` |
| Model | `pose_landmarker_full.task` |
| Variant | BlazePose GHUM 3D, Full, float16 |
| Official download | `https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/latest/pose_landmarker_full.task?generation=1682642787774579` |
| Artifact revision | Google Cloud Storage generation `1682642787774579` |
| Expected size | `9,398,198` bytes |
| Expected SHA-256 | `4eaa5eb7a98365221087693fcc286334cf0858e2eb6e15b506aa4a7ecdcec4ad` |
| License | Apache License 2.0 |
| Model card | `https://storage.googleapis.com/mediapipe-assets/Model%20Card%20BlazePose%20GHUM%203D.pdf` |

The application must load its checked-in model and MediaPipe WASM assets from
the same origin. Production code must not fall back to a CDN. When replacing
the model, update the bundled artifact, expected byte size, SHA-256, model ID,
this record, and `THIRD_PARTY_NOTICES.md` together.

The model produces 33 image landmarks, visibility values, and estimated world
landmarks. World landmarks are useful for orientation only. They must not be
presented as calibrated centimetres, metres, or high-accuracy 3D measurement.

## PINTO_model_zoo review

The project reviewed
[PINTO0309/PINTO_model_zoo](https://github.com/PINTO0309/PINTO_model_zoo)
while selecting a pose model. Its top-level README states two requirements:

1. Read the `LICENSE` file directly inside each model folder before using that
   model.
2. Treat PINTO's conversion scripts and the original model as separately
   licensed works: the scripts are MIT-licensed, while the model follows its
   provider repository's license.

Folder
[`053_BlazePose`](https://github.com/PINTO0309/PINTO_model_zoo/tree/main/053_BlazePose)
and its
[`LICENSE`](https://github.com/PINTO0309/PINTO_model_zoo/blob/main/053_BlazePose/LICENSE)
confirmed that the BlazePose model family fit the 33-landmark requirement. The
production application nevertheless uses the official Google MediaPipe task
bundle above because it includes the maintained browser runtime, detection,
tracking, and preprocessing/postprocessing path.

No PINTO_model_zoo code, converted model, sample, or archive is copied into or
distributed with MotionAnalysys. If a PINTO_model_zoo artifact is considered in
the future, its folder-level `LICENSE` and its original provider license must be
reviewed again before the artifact is downloaded or committed.

## Alternatives considered

- MoveNet Thunder: useful as an offline comparison baseline, but its 17
  two-dimensional landmarks do not meet the production landmark requirement.
- Human-pose 3D conversions: require additional detection, decoding, depth, and
  camera assumptions that do not fit the local browser v1.
- RTMPose WholeBody: 133 landmarks and its runtime cost are beyond v1 needs.
- ViTPose: requires an external detector and additional ONNX preprocessing and
  postprocessing.

None of these alternatives is bundled with the application.
