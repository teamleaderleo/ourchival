"use client";

import { FormEvent, useMemo, useState } from "react";
import {
  parseConversationImport,
  type ConversationArchive,
  type ConversationImportFormat,
  type ConversationProvider,
} from "./conversationImport";
import {
  importConversationArchive,
  useConversation,
  useConversations,
  type ConversationSummary,
} from "./useConversations";

export function ConversationPanel() {
  const [open, setOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string | undefined>();
  const [format, setFormat] = useState<ConversationImportFormat>("markdown");
  const [provider, setProvider] = useState<ConversationProvider>("generic");
  const [title, setTitle] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  const [providerConversationId, setProviderConversationId] = useState("");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const list = useConversations(40);
  const reader = useConversation(selectedId);
  const selected = useMemo(
    () => list.conversations.find((conversation) => conversation._id === selectedId),
    [list.conversations, selectedId],
  );

  async function submitImport(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage("Normalizing and importing conversation…");
    try {
      const archive = parseConversationImport({
        text,
        format,
        provider,
        ...(title.trim() ? { title } : {}),
        ...(sourceUrl.trim() ? { sourceUrl } : {}),
        ...(providerConversationId.trim() ? { providerConversationId } : {}),
      });
      const result = await importConversationArchive({
        archive,
        originalFormat: format,
      });
      await list.refresh();
      setSelectedId(result.conversationId);
      setImportOpen(false);
      setText("");
      setTitle("");
      setSourceUrl("");
      setProviderConversationId("");
      setMessage(
        result.duplicate
          ? "That exact conversation snapshot was already archived."
          : result.addedCount || result.removedCount
            ? `Saved revision: ${result.addedCount} added, ${result.removedCount} removed.`
            : "Conversation archived.",
      );
    } catch (caught) {
      setMessage(
        caught instanceof Error ? caught.message : "Could not import the conversation.",
      );
    } finally {
      setBusy(false);
    }
  }

  function closeReader() {
    setSelectedId(undefined);
    setMessage("");
  }

  return (
    <>
      <button
        type="button"
        className="conversation-launcher button ghost"
        onClick={() => setOpen((current) => !current)}
      >
        Conversations
        {list.conversations.length ? <span>{list.conversations.length}</span> : null}
      </button>

      {open ? (
        <aside className="conversation-drawer" aria-label="Conversation archive">
          <header>
            <div>
              <p className="eyebrow">Conversation archive</p>
              <h2>{selected ? selected.title : "Conversations"}</h2>
            </div>
            <div>
              {selectedId ? (
                <button type="button" className="button ghost" onClick={closeReader}>
                  Back
                </button>
              ) : null}
              <button
                type="button"
                className="button secondary"
                onClick={() => setImportOpen((current) => !current)}
              >
                {importOpen ? "Close import" : "Import"}
              </button>
              <button type="button" className="button ghost" onClick={() => setOpen(false)}>
                Close
              </button>
            </div>
          </header>

          {importOpen ? (
            <ConversationImportForm
              format={format}
              setFormat={setFormat}
              provider={provider}
              setProvider={setProvider}
              title={title}
              setTitle={setTitle}
              sourceUrl={sourceUrl}
              setSourceUrl={setSourceUrl}
              providerConversationId={providerConversationId}
              setProviderConversationId={setProviderConversationId}
              text={text}
              setText={setText}
              busy={busy}
              onSubmit={submitImport}
            />
          ) : selectedId ? (
            <ConversationReader
              summary={selected}
              archive={reader.archive}
              loading={reader.loading}
              error={reader.error}
            />
          ) : (
            <ConversationList
              conversations={list.conversations}
              loading={list.loading}
              error={list.error}
              onSelect={(conversation) => {
                setSelectedId(conversation._id);
                setMessage("");
              }}
            />
          )}

          {message ? (
            <p className="conversation-message" aria-live="polite">
              {message}
            </p>
          ) : null}
        </aside>
      ) : null}
    </>
  );
}

function ConversationImportForm({
  format,
  setFormat,
  provider,
  setProvider,
  title,
  setTitle,
  sourceUrl,
  setSourceUrl,
  providerConversationId,
  setProviderConversationId,
  text,
  setText,
  busy,
  onSubmit,
}: {
  format: ConversationImportFormat;
  setFormat: (value: ConversationImportFormat) => void;
  provider: ConversationProvider;
  setProvider: (value: ConversationProvider) => void;
  title: string;
  setTitle: (value: string) => void;
  sourceUrl: string;
  setSourceUrl: (value: string) => void;
  providerConversationId: string;
  setProviderConversationId: (value: string) => void;
  text: string;
  setText: (value: string) => void;
  busy: boolean;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  return (
    <form className="conversation-import-form" onSubmit={onSubmit}>
      <div className="conversation-import-grid">
        <label>
          Format
          <select
            value={format}
            onChange={(event) => setFormat(event.target.value as ConversationImportFormat)}
          >
            <option value="markdown">Markdown or transcript</option>
            <option value="json">JSON</option>
          </select>
        </label>
        <label>
          Provider
          <select
            value={provider}
            onChange={(event) => setProvider(event.target.value as ConversationProvider)}
          >
            <option value="generic">Generic</option>
            <option value="chatgpt">ChatGPT</option>
            <option value="claude">Claude</option>
            <option value="gemini">Gemini</option>
          </select>
        </label>
      </div>
      <label>
        Title <span>optional</span>
        <input
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          placeholder="Derived from the first user message when empty"
        />
      </label>
      <label>
        Live conversation URL <span>optional</span>
        <input
          type="url"
          value={sourceUrl}
          onChange={(event) => setSourceUrl(event.target.value)}
          placeholder="https://chatgpt.com/c/..."
        />
      </label>
      <label>
        Provider conversation ID <span>optional</span>
        <input
          value={providerConversationId}
          onChange={(event) => setProviderConversationId(event.target.value)}
          placeholder="Keeps later imports in one revision history"
        />
      </label>
      <label>
        Conversation
        <textarea
          required
          value={text}
          onChange={(event) => setText(event.target.value)}
          placeholder={
            format === "json"
              ? '{"title":"...","messages":[{"role":"user","content":"..."}]}'
              : "## User\nYour message\n\n## Assistant\nThe reply"
          }
          rows={14}
        />
      </label>
      <button type="submit" className="button primary" disabled={busy}>
        {busy ? "Importing…" : "Import conversation"}
      </button>
    </form>
  );
}

function ConversationList({
  conversations,
  loading,
  error,
  onSelect,
}: {
  conversations: ConversationSummary[];
  loading: boolean;
  error: string;
  onSelect: (conversation: ConversationSummary) => void;
}) {
  if (error) return <p className="conversation-message error">{error}</p>;
  if (!conversations.length) {
    return (
      <p className="conversation-empty">
        {loading ? "Loading conversations…" : "Imported conversations will appear here."}
      </p>
    );
  }
  return (
    <div className="conversation-list">
      {conversations.map((conversation) => (
        <button
          type="button"
          className="conversation-row"
          key={conversation._id}
          onClick={() => onSelect(conversation)}
        >
          <span className="conversation-provider" aria-hidden="true">
            {providerInitial(conversation.provider)}
          </span>
          <span>
            <strong>{conversation.title}</strong>
            <small>
              {providerLabel(conversation.provider)} · {conversation.latestSnapshot.messageCount} messages ·{" "}
              {formatDate(conversation.lastCapturedAt)}
            </small>
            <em>
              {conversation.snapshotCount} {conversation.snapshotCount === 1 ? "snapshot" : "snapshots"}
              {conversation.latestSnapshot.addedCount
                ? ` · +${conversation.latestSnapshot.addedCount} recent`
                : ""}
            </em>
          </span>
        </button>
      ))}
    </div>
  );
}

function ConversationReader({
  summary,
  archive,
  loading,
  error,
}: {
  summary?: ConversationSummary;
  archive: ConversationArchive | null;
  loading: boolean;
  error: string;
}) {
  if (error) return <p className="conversation-message error">{error}</p>;
  if (!archive || !summary) {
    return <p className="conversation-empty">{loading ? "Loading conversation…" : "Conversation unavailable."}</p>;
  }
  return (
    <div className="conversation-reader">
      <section className="conversation-reader-summary">
        <div>
          <strong>{providerLabel(archive.provider)}</strong>
          <span>{archive.messages.length} messages</span>
          <span>{summary.snapshotCount} saved snapshots</span>
        </div>
        <div>
          {archive.sourceUrl ? (
            <a className="button ghost" href={archive.sourceUrl} target="_blank" rel="noreferrer">
              Open live ↗
            </a>
          ) : null}
          <button
            type="button"
            className="button ghost"
            onClick={() => downloadConversation(archive)}
          >
            Download JSON
          </button>
          <button
            type="button"
            className="button secondary"
            onClick={() => void navigator.clipboard.writeText(conversationMarkdown(archive))}
          >
            Copy Markdown
          </button>
        </div>
      </section>
      <section className="conversation-messages" aria-label="Conversation messages">
        {archive.messages.map((message) => (
          <article className={`conversation-message-card ${message.role}`} key={message.id}>
            <header>
              <strong>{message.author || roleLabel(message.role)}</strong>
              <span>{message.createdAt ? formatDate(Date.parse(message.createdAt)) : message.role}</span>
            </header>
            <pre>{message.text}</pre>
          </article>
        ))}
      </section>
    </div>
  );
}

function conversationMarkdown(archive: ConversationArchive) {
  return archive.messages
    .map((message) => `## ${message.author || roleLabel(message.role)}\n\n${message.text}`)
    .join("\n\n");
}

function downloadConversation(archive: ConversationArchive) {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(archive, null, 2)], { type: "application/json" }),
  );
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${archive.title.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase() || "conversation"}.json`;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

function roleLabel(role: string) {
  if (role === "user") return "User";
  if (role === "assistant") return "Assistant";
  if (role === "system") return "System";
  if (role === "tool") return "Tool";
  return "Message";
}

function providerLabel(provider: ConversationProvider) {
  if (provider === "chatgpt") return "ChatGPT";
  if (provider === "claude") return "Claude";
  if (provider === "gemini") return "Gemini";
  return "Conversation";
}

function providerInitial(provider: ConversationProvider) {
  if (provider === "chatgpt") return "G";
  if (provider === "claude") return "C";
  if (provider === "gemini") return "M";
  return "✦";
}

function formatDate(value: number) {
  if (!Number.isFinite(value)) return "";
  return new Date(value).toLocaleString([], {
    month: "short",
    day: "numeric",
    year: new Date(value).getFullYear() === new Date().getFullYear() ? undefined : "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}
