# Conversation archives

Ourchival stores one archive reference per conversation and appends versioned conversation snapshots beneath it.

## Portable normalized format

Every imported conversation is normalized to JSON:

```json
{
  "schemaVersion": 1,
  "title": "Conversation title",
  "provider": "generic",
  "providerConversationId": "optional-provider-id",
  "sourceUrl": "https://optional-live-conversation-url",
  "capturedAt": "2026-07-24T00:00:00.000Z",
  "messages": [
    {
      "id": "message-1",
      "role": "user",
      "author": "optional display name",
      "text": "Message text",
      "createdAt": "optional source timestamp"
    }
  ]
}
```

Supported roles are `user`, `assistant`, `system`, `tool`, and `other`. Supported providers are `generic`, `chatgpt`, `claude`, and `gemini`.

## Import paths

### Markdown

The importer recognizes speaker sections such as:

```md
## User
Question

## Assistant
Answer
```

Inline forms such as `User: Question` also work. Fenced code remains inside the current message.

### JSON

The importer accepts a root message array or common objects containing `messages`, `conversation`, `items`, or `chat.messages`. Message content can be a string, nested text object, or array of content blocks.

## Identity and revisions

Ourchival resolves a conversation in this order:

1. provider plus provider conversation ID
2. canonical live source URL
3. exact normalized import hash for imports without stable source identity

An unchanged import deletes the redundant uploaded file and refreshes the capture time. Changed content appends a snapshot and records added and removed message fingerprints. One reference remains in the normal Inbox/Library/Later/Archive/Trash workflow.

## Storage

Normalized JSON is uploaded directly to Convex Storage. Conversation records retain:

- provider identity and canonical URL
- first and latest capture times
- latest snapshot and snapshot count

Snapshot records retain:

- storage ID and authoritative SHA-256 content hash
- message count and message fingerprints
- original import format and adapter version
- previous snapshot link
- added, changed, and removed counts

## Reader and exports

The private conversation drawer provides:

- recent conversation list
- role-grouped message reader
- live-source action when available
- portable JSON download
- Markdown copy

## Next work

1. ChatGPT browser adapter
2. Claude and Gemini browser adapters
3. message ID-aware changed-message counts
4. snapshot history and visual diff
5. citations, code-block, and attachment metadata
6. message-level archive indexing
7. pinned takeaways and accepted summaries

Tracking issue: #44

Stacked implementation: #50 on #49
