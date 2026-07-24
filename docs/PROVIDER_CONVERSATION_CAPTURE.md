# Provider conversation capture

Ourchival Clipper supports explicit visible-conversation capture for ChatGPT, Claude, and Gemini.

## Shared capture flow

1. Open a saved provider conversation.
2. Open Ourchival Clipper.
3. Choose **Save this conversation**.
4. The active content adapter normalizes visible messages.
5. The paired Clipper requests a short-lived Convex upload URL.
6. Portable JSON is uploaded directly to Convex Storage.
7. A device-authenticated commit creates or revises one conversation archive.

Provider conversation ID plus provider is the primary identity. Exact normalized content hashes reject duplicate snapshots.

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

Each adapter preserves fields available in the visible DOM:

- stable message ID, with deterministic fallback
- role
- author or model label
- rendered text
- timestamp
- provider conversation ID
- canonical live URL
- conversation title
- capture time

## Bounds

- 5,000 visible messages
- 200,000 characters per message
- 4.5 million normalized JSON characters
- 5 MB uploaded JSON

## Privacy boundary

Capture runs only after an explicit popup action. Adapters read rendered message containers in the active tab. They do not inspect cookies, browser storage, authorization data, hidden prompts, network responses, or unrelated sidebar conversations.

## Repair policy

Provider DOM selectors will drift. Repairs must remain isolated in provider adapter files. Change the adapter version whenever a repair changes the meaning of stored fields.

Tracking issue: #44

Stacked implementation: #52 on #51
