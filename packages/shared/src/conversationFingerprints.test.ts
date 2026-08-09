import { describe, expect, it } from "vitest";
import { buildConversationFingerprints } from "./index";

describe("conversation fingerprints", () => {
  it("keeps stable provider identity while content changes", () => {
    const before = buildConversationFingerprints([
      { id: "provider-1", role: "assistant", text: "First answer" },
    ]);
    const after = buildConversationFingerprints([
      { id: "provider-1", role: "assistant", text: "Edited answer" },
    ]);

    expect(before.confidence).toBe("stable");
    expect(before.fingerprints[0]?.split(":")[1]).toBe(
      after.fingerprints[0]?.split(":")[1],
    );
    expect(before.fingerprints[0]?.split(":")[2]).not.toBe(
      after.fingerprints[0]?.split(":")[2],
    );
  });

  it("does not shift content-based identity when an earlier message is inserted", () => {
    const before = buildConversationFingerprints([
      { id: "message-1", role: "user", text: "Question" },
      { id: "message-2", role: "assistant", text: "Answer" },
    ]);
    const after = buildConversationFingerprints([
      { id: "message-1", role: "system", text: "Inserted" },
      { id: "message-2", role: "user", text: "Question" },
      { id: "message-3", role: "assistant", text: "Answer" },
    ]);

    expect(before.confidence).toBe("positional");
    expect(after.fingerprints.slice(1)).toEqual(before.fingerprints);
  });

  it("keeps repeated identical messages distinct by occurrence", () => {
    const result = buildConversationFingerprints([
      { id: "message-1", role: "user", text: "Repeat" },
      { id: "message-2", role: "user", text: "Repeat" },
    ]);

    expect(result.fingerprints[0]).not.toBe(result.fingerprints[1]);
  });

  it("reports mixed confidence when stable and inferred IDs coexist", () => {
    const result = buildConversationFingerprints([
      { id: "provider-1", role: "user", text: "Stable" },
      { id: "captured-abc", role: "assistant", text: "Inferred" },
    ]);

    expect(result.confidence).toBe("mixed");
  });
});
