import { describe, expect, it } from "vitest";

import {
  BORN_2026_REFERENCE_DATASET,
  percentileForStartMetric,
  referenceBandsForStartMetric,
} from "../../lib/start";
import type { StartReferenceDataset } from "../../types/start";

const percentiles = [3, 10, 25, 50, 75, 90, 97] as const;

function dataset(higherIsBetter: boolean): StartReferenceDataset {
  return {
    schemaVersion: "1.0",
    id: "born-2026-appendix-a",
    status: "available",
    source: { citation: "test", url: "https://example.invalid", doi: null, license: "CC BY 4.0", note: "test" },
    bands: [{
      strokeStyle: "freestyle",
      researchSexCategory: "male",
      metric: "entry-distance",
      unit: "m",
      higherIsBetter,
      bands: percentiles.map((percentile, index) => ({ percentile, value: index + 1 })),
    }],
  };
}

describe("start reference bands", () => {
  it("uses performance direction explicitly and suppresses reference output outside the source age range", () => {
    const athlete = { strokeStyle: "freestyle", researchSexCategory: "male", age: 16 } as const;
    expect(percentileForStartMetric("entry-distance", 1.5, athlete, dataset(true)).band).toBe("p3-p10");
    expect(percentileForStartMetric("entry-distance", 1.5, athlete, dataset(false)).band).toBe("p90-p97");
    expect(percentileForStartMetric("entry-distance", 2, { ...athlete, age: 33 }, dataset(true))).toMatchObject({ band: null, note: "比較対象外です。" });
  });

  it("ships the versioned Born 2026 bands for every stroke and research sex category", () => {
    expect(BORN_2026_REFERENCE_DATASET.status).toBe("available");
    expect(BORN_2026_REFERENCE_DATASET.source.doi).toBe("10.3390/bioengineering13020180");
    expect(BORN_2026_REFERENCE_DATASET.bands).toHaveLength(32);
    expect(referenceBandsForStartMetric("entry-distance")).toHaveLength(8);
    expect(BORN_2026_REFERENCE_DATASET.bands.find((entry) =>
      entry.strokeStyle === "freestyle" &&
      entry.researchSexCategory === "female" &&
      entry.metric === "entry-distance"
    )?.bands).toEqual([
      { percentile: 3, value: 2.22 },
      { percentile: 10, value: 2.32 },
      { percentile: 25, value: 2.54 },
      { percentile: 50, value: 2.8 },
      { percentile: 75, value: 2.98 },
      { percentile: 90, value: 3.14 },
      { percentile: 97, value: 3.28 },
    ]);
  });

  it("applies the declared direction to Born time and distance bands", () => {
    const athlete = { strokeStyle: "freestyle", researchSexCategory: "male", age: 20 } as const;
    expect(percentileForStartMetric("five-meter-time", 1.42, athlete).band).toBe("p90-p97");
    expect(percentileForStartMetric("five-meter-time", 1.8, athlete).band).toBe("below-p3");
    expect(percentileForStartMetric("entry-distance", 3.55, athlete).band).toBe("p90-p97");
  });

  it("retains the original Appendix percentile labels before display-direction adaptation", () => {
    expect(BORN_2026_REFERENCE_DATASET.bands.find((entry) =>
      entry.strokeStyle === "freestyle" &&
      entry.researchSexCategory === "male" &&
      entry.metric === "block-contact-time"
    )?.bands).toEqual([
      { percentile: 3, value: 0.78 },
      { percentile: 10, value: 0.76 },
      { percentile: 25, value: 0.72 },
      { percentile: 50, value: 0.7 },
      { percentile: 75, value: 0.67 },
      { percentile: 90, value: 0.64 },
      { percentile: 97, value: 0.63 },
    ]);
  });
});
