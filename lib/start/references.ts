import type {
  StartPercentileBand,
  StartPercentileResult,
  StartReferenceBand,
  StartReferenceDataset,
  StartReferenceMetric,
} from "../../types/start";

const PERCENTILES = [3, 10, 25, 50, 75, 90, 97] as const;

function percentileBands(values: readonly number[]): readonly StartPercentileBand[] {
  if (values.length !== PERCENTILES.length) {
    throw new RangeError("A Start reference band requires seven percentile values.");
  }
  return PERCENTILES.map((percentile, index) => ({ percentile, value: values[index] }));
}

function references(
  strokeStyle: StartReferenceBand["strokeStyle"],
  researchSexCategory: StartReferenceBand["researchSexCategory"],
  blockOrWall: readonly number[],
  entryTime: readonly number[],
  entryDistance: readonly number[],
  fiveMeterTime: readonly number[],
): readonly StartReferenceBand[] {
  return [
    {
      strokeStyle,
      researchSexCategory,
      metric: "block-contact-time",
      unit: "s",
      higherIsBetter: false,
      bands: percentileBands(blockOrWall),
    },
    {
      strokeStyle,
      researchSexCategory,
      metric: "entry-time",
      unit: "s",
      higherIsBetter: false,
      bands: percentileBands(entryTime),
    },
    {
      strokeStyle,
      researchSexCategory,
      metric: "entry-distance",
      unit: "m",
      higherIsBetter: true,
      bands: percentileBands(entryDistance),
    },
    {
      strokeStyle,
      researchSexCategory,
      metric: "five-meter-time",
      unit: "s",
      higherIsBetter: false,
      bands: percentileBands(fiveMeterTime),
    },
  ];
}

/**
 * Born et al. (2026) Appendix A, Tables A1–A8からv1で比較する4指標だけを転記。
 * `bands`は原表のP3→P97をそのまま保持する。帯判定時だけ数値の切点を
 * 並べ直し、`higherIsBetter`により「時間は短い、距離は長い」を
 * 高パフォーマンス方向とする。これは原表値を保持した表示上の変更である。
 */
export const BORN_2026_REFERENCE_DATASET: StartReferenceDataset = {
  schemaVersion: "1.0",
  id: "born-2026-appendix-a",
  status: "available",
  source: {
    citation: "Born, Nussbaumer, Buck, Ruiz-Navarro & Romann (2026), Bioengineering 13(2), 180, Appendix A, Tables A1–A8.",
    url: "https://www.mdpi.com/2306-5354/13/2/180",
    doi: "10.3390/bioengineering13020180",
    license: "CC BY 4.0",
    note: "原表値を転記し、時間は短い方向、距離は長い方向が高パフォーマンスとなる帯表示へ変更。測定法差を含む研究参考値。",
  },
  bands: [
    ...references(
      "butterfly", "male",
      [0.78, 0.76, 0.71, 0.68, 0.66, 0.63, 0.62],
      [0.92, 0.96, 0.98, 1.02, 1.06, 1.09, 1.14],
      [2.52, 2.67, 2.83, 3.07, 3.20, 3.44, 3.73],
      [1.68, 1.63, 1.58, 1.51, 1.45, 1.42, 1.38],
    ),
    ...references(
      "backstroke", "male",
      [0.74, 0.72, 0.70, 0.68, 0.63, 0.60, 0.57],
      [0.71, 0.77, 0.81, 0.87, 0.92, 0.95, 0.95],
      [2.12, 2.23, 2.42, 2.61, 2.92, 3.04, 3.49],
      [2.01, 1.97, 1.89, 1.81, 1.62, 1.51, 1.47],
    ),
    ...references(
      "breaststroke", "male",
      [0.78, 0.76, 0.74, 0.69, 0.67, 0.65, 0.63],
      [0.94, 0.96, 1.00, 1.02, 1.06, 1.09, 1.10],
      [2.48, 2.69, 2.86, 2.94, 3.22, 3.50, 3.54],
      [1.63, 1.56, 1.55, 1.52, 1.49, 1.44, 1.43],
    ),
    ...references(
      "freestyle", "male",
      [0.78, 0.76, 0.72, 0.70, 0.67, 0.64, 0.63],
      [0.91, 0.95, 1.00, 1.01, 1.06, 1.09, 1.15],
      [2.47, 2.65, 2.81, 2.98, 3.19, 3.51, 3.63],
      [1.73, 1.57, 1.53, 1.50, 1.45, 1.43, 1.41],
    ),
    ...references(
      "butterfly", "female",
      [0.75, 0.73, 0.72, 0.70, 0.67, 0.64, 0.61],
      [0.82, 0.89, 0.94, 0.99, 1.03, 1.07, 1.11],
      [2.12, 2.29, 2.47, 2.70, 2.89, 3.13, 3.36],
      [1.81, 1.77, 1.72, 1.65, 1.60, 1.56, 1.51],
    ),
    ...references(
      "backstroke", "female",
      [0.77, 0.69, 0.67, 0.65, 0.61, 0.59, 0.56],
      [0.72, 0.75, 0.78, 0.81, 0.84, 0.91, 0.97],
      [2.05, 2.09, 2.18, 2.34, 2.54, 2.65, 2.75],
      [2.31, 2.20, 2.12, 2.03, 1.96, 1.86, 1.77],
    ),
    ...references(
      "breaststroke", "female",
      [0.80, 0.79, 0.74, 0.72, 0.69, 0.66, 0.65],
      [0.91, 0.95, 0.98, 1.01, 1.04, 1.10, 1.12],
      [2.37, 2.45, 2.48, 2.59, 2.92, 3.07, 3.16],
      [1.81, 1.78, 1.72, 1.68, 1.64, 1.60, 1.54],
    ),
    ...references(
      "freestyle", "female",
      [0.82, 0.78, 0.76, 0.71, 0.68, 0.65, 0.63],
      [0.88, 0.94, 0.97, 1.01, 1.05, 1.08, 1.13],
      [2.22, 2.32, 2.54, 2.80, 2.98, 3.14, 3.28],
      [1.85, 1.79, 1.72, 1.67, 1.60, 1.55, 1.50],
    ),
  ],
};

function bandForValue(
  value: number,
  bands: readonly StartPercentileBand[],
  higherIsBetter: boolean,
): StartPercentileResult["band"] {
  if (bands.length !== 7) return null;
  const orderedValues = bands.map((entry) => entry.value).sort((a, b) => a - b);
  const labels = ["below-p3", "p3-p10", "p10-p25", "p25-p50", "p50-p75", "p75-p90", "p90-p97", "above-p97"] as const;
  const rawIndex = orderedValues.findIndex((cutpoint) => value < cutpoint);
  const numericIndex = rawIndex === -1 ? 7 : rawIndex;
  return higherIsBetter ? labels[numericIndex] : labels[7 - numericIndex];
}

export function percentileForStartMetric(
  metric: StartReferenceMetric,
  value: number | null,
  athlete: { readonly strokeStyle: string; readonly researchSexCategory: string; readonly age: number },
  dataset: StartReferenceDataset = BORN_2026_REFERENCE_DATASET,
): StartPercentileResult {
  if (value === null || !Number.isFinite(value) || athlete.age < 13 || athlete.age > 32) {
    return { metric, band: null, referenceStatus: dataset.status, note: "比較対象外です。" };
  }
  const reference = dataset.bands.find(
    (entry) => entry.metric === metric && entry.strokeStyle === athlete.strokeStyle && entry.researchSexCategory === athlete.researchSexCategory,
  );
  if (!reference || dataset.status !== "available") {
    return { metric, band: null, referenceStatus: dataset.status, note: dataset.source.note };
  }
  return {
    metric,
    band: bandForValue(value, reference.bands, reference.higherIsBetter),
    referenceStatus: dataset.status,
    note: "研究参考帯。診断・選抜・総合評価には使用しない。",
  };
}

export function referenceBandsForStartMetric(
  metric: StartReferenceMetric,
  dataset: StartReferenceDataset = BORN_2026_REFERENCE_DATASET,
): readonly StartReferenceBand[] {
  return dataset.status === "available"
    ? dataset.bands.filter((entry) => entry.metric === metric)
    : [];
}
