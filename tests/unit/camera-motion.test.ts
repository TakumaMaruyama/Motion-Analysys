import { describe, expect, it } from "vitest";

import {
  classifyCameraStability,
  estimateCameraTransform,
  estimateCameraTranslation,
  type CameraTransformEstimate,
  type CameraMotionThumbnail,
} from "@/lib/video/camera-motion";

function texturedThumbnail(
  width = 48,
  height = 28,
): CameraMotionThumbnail {
  const luma = new Uint8Array(width * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      luma[y * width + x] =
        (x * 37 + y * 61 + ((x * y) % 17) * 11) % 256;
    }
  }
  return { width, height, luma };
}

function shifted(
  source: CameraMotionThumbnail,
  shiftX: number,
  shiftY: number,
): CameraMotionThumbnail {
  const luma = new Uint8Array(source.luma.length);
  for (let y = 0; y < source.height; y += 1) {
    for (let x = 0; x < source.width; x += 1) {
      const targetX = x + shiftX;
      const targetY = y + shiftY;
      if (
        targetX >= 0 &&
        targetX < source.width &&
        targetY >= 0 &&
        targetY < source.height
      ) {
        luma[targetY * source.width + targetX] =
          source.luma[y * source.width + x];
      }
    }
  }
  return { width: source.width, height: source.height, luma };
}

function transformed(
  source: CameraMotionThumbnail,
  {
    scale = 1,
    rotationDegrees = 0,
    shiftX = 0,
    shiftY = 0,
  }: {
    scale?: number;
    rotationDegrees?: number;
    shiftX?: number;
    shiftY?: number;
  },
): CameraMotionThumbnail {
  const luma = new Uint8Array(source.luma.length);
  const centerX = (source.width - 1) / 2;
  const centerY = (source.height - 1) / 2;
  const radians = (-rotationDegrees * Math.PI) / 180;
  const cosine = Math.cos(radians);
  const sine = Math.sin(radians);
  for (let y = 0; y < source.height; y += 1) {
    for (let x = 0; x < source.width; x += 1) {
      const translatedX = (x - centerX - shiftX) / scale;
      const translatedY = (y - centerY - shiftY) / scale;
      const sourceX = Math.round(
        centerX + cosine * translatedX - sine * translatedY,
      );
      const sourceY = Math.round(
        centerY + sine * translatedX + cosine * translatedY,
      );
      if (
        sourceX >= 0 &&
        sourceX < source.width &&
        sourceY >= 0 &&
        sourceY < source.height
      ) {
        luma[y * source.width + x] =
          source.luma[sourceY * source.width + sourceX];
      }
    }
  }
  return { width: source.width, height: source.height, luma };
}

function observation(
  overrides: Partial<CameraTransformEstimate> = {},
): CameraTransformEstimate {
  return {
    assessed: true,
    shiftX: 0,
    shiftY: 0,
    scale: 1,
    rotationDegrees: 0,
    movement: "none",
    improvement: 0,
    ...overrides,
  };
}

describe("camera translation estimation", () => {
  it("detects coherent whole-frame translation", () => {
    const baseline = texturedThumbnail();
    const estimate = estimateCameraTranslation(
      baseline,
      shifted(baseline, 3, -2),
    );

    expect(estimate.assessed).toBe(true);
    expect(estimate.shiftX).toBe(3);
    expect(estimate.shiftY).toBe(-2);
    expect(estimate.improvement).toBeGreaterThan(0.22);
  });

  it("does not classify local swimmer-like motion as camera translation", () => {
    const baseline = texturedThumbnail();
    const luma = new Uint8Array(baseline.luma);
    for (let y = 10; y < 17; y += 1) {
      for (let x = 18; x < 30; x += 1) {
        luma[y * baseline.width + x] =
          255 - luma[y * baseline.width + x];
      }
    }
    const estimate = estimateCameraTranslation(baseline, {
      ...baseline,
      luma,
    });

    expect(estimate.assessed).toBe(true);
    expect([estimate.shiftX, estimate.shiftY]).toEqual([0, 0]);
  });

  it("leaves textureless water-or-wall frames inconclusive", () => {
    const luma = new Uint8Array(48 * 28).fill(32);
    const estimate = estimateCameraTranslation(
      { width: 48, height: 28, luma },
      { width: 48, height: 28, luma: new Uint8Array(luma) },
    );

    expect(estimate).toEqual({
      assessed: false,
      shiftX: 0,
      shiftY: 0,
      improvement: 0,
    });
  });
});

describe("camera similarity-transform estimation", () => {
  it("detects coherent whole-frame zoom", () => {
    const baseline = texturedThumbnail();
    const estimate = estimateCameraTransform(
      baseline,
      transformed(baseline, { scale: 1.08 }),
    );

    expect(estimate.assessed).toBe(true);
    expect(estimate.movement).toMatch(/zoom|combined/);
    expect(estimate.scale).toBeGreaterThan(1);
    expect(estimate.improvement).toBeGreaterThan(0.22);
  });

  it("detects coherent whole-frame rotation", () => {
    const baseline = texturedThumbnail();
    const estimate = estimateCameraTransform(
      baseline,
      transformed(baseline, { rotationDegrees: 5 }),
    );

    expect(estimate.assessed).toBe(true);
    expect(estimate.movement).toMatch(/rotation|combined/);
    expect(estimate.rotationDegrees).toBeGreaterThan(0);
    expect(estimate.improvement).toBeGreaterThan(0.22);
  });

  it("keeps combined pan, zoom and rotation in the local refinement window", () => {
    const baseline = texturedThumbnail(64, 36);
    const estimate = estimateCameraTransform(
      baseline,
      transformed(baseline, {
        scale: 1.04,
        rotationDegrees: 2.5,
        shiftX: 2,
        shiftY: 1,
      }),
    );

    expect(estimate).toMatchObject({
      assessed: true,
      shiftX: 2,
      shiftY: 1,
      scale: 1.04,
      rotationDegrees: 2.5,
      movement: "combined",
    });
    expect(estimate.improvement).toBeGreaterThan(0.22);
  });

  it("keeps textureless frames unassessable", () => {
    const luma = new Uint8Array(48 * 28).fill(80);
    const estimate = estimateCameraTransform(
      { width: 48, height: 28, luma },
      { width: 48, height: 28, luma: new Uint8Array(luma) },
    );

    expect(estimate).toEqual({
      assessed: false,
      shiftX: 0,
      shiftY: 0,
      scale: 1,
      rotationDegrees: 0,
      movement: "none",
      improvement: 0,
    });
  });
});

describe("camera stability classification", () => {
  it("reports stable after enough assessable unchanged samples", () => {
    expect(
      classifyCameraStability([
        observation(),
        observation(),
        observation(),
      ]),
    ).toBe("stable");
  });

  it("reports moving for repeated pan, zoom or rotation evidence", () => {
    expect(
      classifyCameraStability([
        observation({
          shiftX: 3,
          movement: "translation",
          improvement: 0.7,
        }),
        observation({
          shiftX: 4,
          movement: "translation",
          improvement: 0.8,
        }),
        observation(),
      ]),
    ).toBe("moving");
    expect(
      classifyCameraStability([
        observation({ scale: 1.04, movement: "zoom" }),
        observation({ scale: 1.08, movement: "zoom" }),
        observation(),
      ]),
    ).toBe("moving");
    expect(
      classifyCameraStability([
        observation({
          rotationDegrees: -2.5,
          movement: "rotation",
        }),
        observation({ rotationDegrees: -5, movement: "rotation" }),
        observation(),
      ]),
    ).toBe("moving");
  });

  it("does not call insufficient or contradictory evidence stable", () => {
    expect(classifyCameraStability([observation(), observation()])).toBe(
      "unassessable",
    );
    expect(
      classifyCameraStability([
        observation({ assessed: false }),
        observation({ assessed: false }),
        observation(),
        observation(),
      ]),
    ).toBe("unassessable");
    expect(
      classifyCameraStability([
        observation({ shiftX: 3, movement: "translation" }),
        observation({ shiftX: -3, movement: "translation" }),
        observation(),
      ]),
    ).toBe("unassessable");
  });
});
