export type VisualResult = {
  inputSha256: string;
  pipelineFingerprint: string;
  models: Array<{ id: string; revision: string; sha256: string; task: string }>;
  tags: Array<{ name: string; category: string; confidence: number }>;
  ratings: Array<{ label: string; confidence: number }>;
  ocrText?: string;
  caption?: string;
};
const digest = /^[a-f0-9]{64}$/;
export function validateVisualResult(result: VisualResult): void {
  if (
    !digest.test(result.inputSha256) ||
    !digest.test(result.pipelineFingerprint)
  )
    throw new Error("Invalid content or pipeline digest.");
  if (!result.models.length || result.models.length > 6)
    throw new Error("Provide one to six model provenance records.");
  for (const model of result.models) {
    if (
      !digest.test(model.sha256) ||
      !model.id.trim() ||
      model.id.length > 200 ||
      !model.revision.trim() ||
      model.revision.length > 100 ||
      !model.task.trim() ||
      model.task.length > 64
    ) {
      throw new Error("Invalid model provenance.");
    }
  }
  if (result.tags.length > 128 || result.ratings.length > 12)
    throw new Error("Annotation count exceeds the per-image limit.");
  for (const tag of result.tags) {
    if (
      !tag.name.trim() ||
      tag.name.length > 120 ||
      !["general", "character"].includes(tag.category)
    )
      throw new Error("Invalid visual tag.");
    probability(tag.confidence);
  }
  for (const rating of result.ratings) {
    if (!rating.label.trim() || rating.label.length > 64)
      throw new Error("Invalid rating label.");
    probability(rating.confidence);
  }
  if (
    (result.ocrText?.length ?? 0) > 16_000 ||
    (result.caption?.length ?? 0) > 2_000
  )
    throw new Error("Annotation text exceeds the limit.");
}
function probability(value: number): void {
  if (!Number.isFinite(value) || value < 0 || value > 1)
    throw new Error("Confidence must be finite and between zero and one.");
}
