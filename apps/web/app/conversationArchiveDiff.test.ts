import { describe, expect, it } from "vitest";
import { diffConversationArchives } from "./conversationArchiveDiff";
import type { ConversationArchive } from "./conversationImport";

const archive = (messages: ConversationArchive["messages"]): ConversationArchive => ({
  schemaVersion: 1,
  title: "Conversation",
  provider: "chatgpt",
  capturedAt: "2026-07-24T00:00:00.000Z",
  messages,
});

describe("conversation archive diffs", () => {
  it("separates added, changed, removed, and unchanged messages", () => {
    const result = diffConversationArchives(
      archive([
        { id: "one", role: "user", text: "Question" },
        { id: "two", role: "assistant", text: "Old answer" },
        { id: "gone", role: "assistant", text: "Remove me" },
      ]),
      archive([
        { id: "one", role: "user", text: "Question" },
        { id: "two", role: "assistant", text: "Edited answer" },
        { id: "new", role: "assistant", text: "Added reply" },
      ]),
    );

    expect(result.unchangedCount).toBe(1);
    expect(result.changed.map((change) => change.key)).toEqual(["two"]);
    expect(result.added.map((change) => change.key)).toEqual(["new"]);
    expect(result.removed.map((change) => change.key)).toEqual(["gone"]);
  });

  it("keeps repeated IDs distinct by occurrence", () => {
    const result = diffConversationArchives(
      archive([
        { id: "repeat", role: "user", text: "First" },
        { id: "repeat", role: "user", text: "Second" },
      ]),
      archive([
        { id: "repeat", role: "user", text: "First" },
        { id: "repeat", role: "user", text: "Edited second" },
      ]),
    );

    expect(result.changed.map((change) => change.key)).toEqual(["repeat#2"]);
  });

  it("treats a first snapshot as entirely added", () => {
    const result = diffConversationArchives(
      null,
      archive([{ id: "one", role: "user", text: "First" }]),
    );

    expect(result.added).toHaveLength(1);
    expect(result.changed).toHaveLength(0);
    expect(result.removed).toHaveLength(0);
  });
});
