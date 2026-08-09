import type {
  ConversationArchive,
  ConversationMessage,
} from "./conversationImport";

export type ConversationMessageChange = {
  key: string;
  before?: ConversationMessage;
  after?: ConversationMessage;
};

export type ConversationArchiveDiff = {
  added: ConversationMessageChange[];
  changed: ConversationMessageChange[];
  removed: ConversationMessageChange[];
  unchangedCount: number;
};

export function diffConversationArchives(
  before: ConversationArchive | null,
  after: ConversationArchive,
): ConversationArchiveDiff {
  if (!before) {
    return {
      added: indexMessages(after.messages).map(({ key, message }) => ({
        key,
        after: message,
      })),
      changed: [],
      removed: [],
      unchangedCount: 0,
    };
  }

  const previous = new Map(
    indexMessages(before.messages).map(({ key, message }) => [key, message]),
  );
  const next = new Map(
    indexMessages(after.messages).map(({ key, message }) => [key, message]),
  );
  const added: ConversationMessageChange[] = [];
  const changed: ConversationMessageChange[] = [];
  const removed: ConversationMessageChange[] = [];
  let unchangedCount = 0;

  for (const [key, message] of next) {
    const previousMessage = previous.get(key);
    if (!previousMessage) {
      added.push({ key, after: message });
    } else if (messageSignature(previousMessage) !== messageSignature(message)) {
      changed.push({ key, before: previousMessage, after: message });
    } else {
      unchangedCount += 1;
    }
  }
  for (const [key, message] of previous) {
    if (!next.has(key)) removed.push({ key, before: message });
  }

  return { added, changed, removed, unchangedCount };
}

function indexMessages(messages: ConversationMessage[]) {
  const occurrences = new Map<string, number>();
  return messages.map((message) => {
    const base = message.id.trim() || "message";
    const occurrence = (occurrences.get(base) ?? 0) + 1;
    occurrences.set(base, occurrence);
    return {
      key: occurrence === 1 ? base : `${base}#${occurrence}`,
      message,
    };
  });
}

function messageSignature(message: ConversationMessage) {
  return JSON.stringify({
    role: message.role,
    author: message.author,
    text: message.text,
    createdAt: message.createdAt,
  });
}
