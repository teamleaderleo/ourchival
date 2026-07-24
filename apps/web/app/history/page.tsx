"use client";

import { useState } from "react";
import { ConversationHistoryBrowser } from "../ConversationHistoryBrowser";
import {
  useConversations,
  type ConversationSummary,
} from "../useConversations";

export default function ConversationHistoryPage() {
  const conversations = useConversations(50);
  const [selectedId, setSelectedId] = useState<string>();
  const selected = conversations.conversations.find(
    (conversation) => conversation._id === selectedId,
  );

  return (
    <main className="conversation-history-page">
      <header>
        <div>
          <p className="eyebrow">Ourchival Workbench</p>
          <h1>Conversation history</h1>
          <p>
            Inspect saved revisions without mounting every message or snapshot at once.
          </p>
        </div>
        <a className="button ghost" href="/">
          Back to Reliquary
        </a>
      </header>

      <div className="conversation-history-page-layout">
        <aside aria-label="Recent conversations">
          <h2>Recent conversations</h2>
          <p>
            Showing {conversations.conversations.length} recently updated conversations.
          </p>
          {conversations.error ? (
            <p className="conversation-message error">{conversations.error}</p>
          ) : conversations.loading && !conversations.conversations.length ? (
            <p className="conversation-empty">Loading conversations…</p>
          ) : (
            conversations.conversations.map((conversation) => (
              <ConversationButton
                key={conversation._id}
                conversation={conversation}
                active={conversation._id === selectedId}
                onClick={() => setSelectedId(conversation._id)}
              />
            ))
          )}
        </aside>

        <section aria-label="Selected conversation history">
          {selected ? (
            <>
              <header>
                <div>
                  <p className="eyebrow">{providerLabel(selected.provider)}</p>
                  <h2>{selected.title}</h2>
                </div>
                <span>{selected.snapshotCount} saved snapshots</span>
              </header>
              <ConversationHistoryBrowser conversationId={selected._id} />
            </>
          ) : (
            <p className="conversation-empty">
              Choose a recent conversation to inspect its saved revisions.
            </p>
          )}
        </section>
      </div>
    </main>
  );
}

function ConversationButton({
  conversation,
  active,
  onClick,
}: {
  conversation: ConversationSummary;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={`conversation-history-page-row ${active ? "active" : ""}`}
      onClick={onClick}
    >
      <strong>{conversation.title}</strong>
      <span>
        {providerLabel(conversation.provider)} · {conversation.latestSnapshot.messageCount}{" "}
        messages
      </span>
      <small>
        {conversation.snapshotCount} {conversation.snapshotCount === 1 ? "snapshot" : "snapshots"}
      </small>
    </button>
  );
}

function providerLabel(provider: ConversationSummary["provider"]) {
  if (provider === "chatgpt") return "ChatGPT";
  if (provider === "claude") return "Claude";
  if (provider === "gemini") return "Gemini";
  return "Imported";
}
