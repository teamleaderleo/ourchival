# Provider conversation capture

Ourchival Clipper supports explicit rendered-conversation capture for ChatGPT, Claude, and Gemini.

## Shared capture flow

1. Open a saved provider conversation.
2. Open Ourchival Clipper.
3. Review the detected provider, title, rendered message count, and any capture-quality notes.
4. Choose **Save this conversation**.
5. The active content adapter normalizes rendered messages.
6. The paired Clipper requests a short-lived Convex upload URL.
7. Portable JSON is uploaded directly to Convex Storage.
8. A device-authenticated commit creates or revises one conversation archive.

Provider plus provider conversation ID is the primary identity. Canonical URLs omit query strings and fragments. Exact normalized content hashes reject duplicate snapshots.

Ambiguous commit failures retry once with the same uploaded storage ID. The server preserves a blob that is already referenced by the saved snapshot.

## Preflight diagnostics

The popup describes the capture before writing anything:

- provider
- title
- rendered message count
- number of unrecognized roles
- number of content-derived fallback IDs

A capture is rejected when every detected role is unrecognized. This avoids archiving provider page chrome as though it were a valid conversation.

## Adapter versions

### ChatGPT

```txt
chatgpt.dom.v1
```

Supported identity:

```txt
https://chatgpt.com/c/<conversation-id>
https://chat.openai.com/c/<conversation-id>
```

Primary message marker:

```txt
[data-message-author-role]
```

### Claude

```txt
claude.dom.v1
```

Supported identity:

```txt
https://claude.ai/chat/<conversation-id>
```

Layered message markers include provider test IDs, author-role attributes, and user/Claude typography classes.

### Gemini

```txt
gemini.dom.v1
```

Supported identity:

```txt
https://gemini.google.com/app/<conversation-id>
```

Layered message markers include `user-query`, `model-response`, provider test IDs, and matching class names.

## Preserved fields

Each adapter preserves fields available in the rendered DOM:

- stable message ID, with deterministic content-derived fallback
- role
- author or model label
- rendered text
- timestamp
- provider conversation ID
- canonical live URL
- conversation title
- capture time

Exact duplicate DOM rows are removed. Conflicting provider IDs receive deterministic suffixes so both messages remain available.

## Bounds

- 5,000 rendered messages
- 200,000 characters per message
- 4.5 million normalized JSON characters
- 5 MB uploaded JSON

Capture fails explicitly rather than returning a partial archive when these bounds are exceeded.

## Privacy boundary

Preflight and capture read rendered message containers in the active tab. They do not inspect cookies, browser storage, authorization data, hidden prompts, network responses, or unrelated sidebar conversations.

## Repair policy

Provider DOM selectors will drift. Repairs must remain isolated in provider adapter files. Change the adapter version whenever a repair changes the meaning of stored fields.

Every adapter repair should include:

- supported URL identity tests
- role and message extraction tests
- a live shipping entrypoint
- explicit bounds
- preflight diagnostics
- provider/host/adapter provenance checks

Tracking issue: #44

Active integration: #53
