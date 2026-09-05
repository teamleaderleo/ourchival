import type { MutationCtx } from "../_generated/server";

/** Codes are immutable, never recycled, and reserved for compact representations. */
export async function allocateTagCode(ctx: MutationCtx) {
  const sequence = await ctx.db.query("tagCodeSequence").unique();
  const code = sequence?.next ?? 1;
  if (!Number.isSafeInteger(code) || code > 0xffffffff) {
    throw new Error(
      "Tag code capacity reached; upgrade the encoding before allocating more.",
    );
  }
  if (sequence) await ctx.db.patch(sequence._id, { next: code + 1 });
  else await ctx.db.insert("tagCodeSequence", { next: code + 1 });
  return code;
}
