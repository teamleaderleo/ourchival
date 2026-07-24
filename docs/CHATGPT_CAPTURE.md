# ChatGPT conversation capture

Ourchival Clipper can archive the rendered messages from an open ChatGPT conversation through the shared provider-conversation action.

## Capture action

1. Open a saved ChatGPT conversation on `chatgpt.com` or `chat.openai.com`.
2. Open Ourchival Clipper.
3. Confirm the preflight title and visible message count.
4. Choose **Save this conversation**.

The action reads the active tab, normalizes the rendered conversation, uploads portable JSON, and creates or updates one conversation archive reference.

The popup also reports capture-quality notes when message roles are unrecognized or message IDs must be derived from content.

## Adapter contract

Adapter identifier:

```txt
chatgpt.dom.v1
```

The adapter reads elements carrying `data-message-author-role` and preserves:

- rendered message role
- stable message ID when exposed
- deterministic content-derived ID when the page omits one
- rendered text, including code text
- timestamp when exposed
- model label when exposed
- conversation title
- provider conversation ID from the `/c/<id>` URL
- canonical live URL without query strings or fragments
- capture time

Exact duplicate DOM nodes are removed. Conflicting provider IDs are resolved deterministically rather than overwriting one message with another.

Capture stops with a clear error when every detected role is unrecognized, a message exceeds the browser-capture bound, or the rendered conversation would be truncated.

## Privacy boundary

Preflight and capture read rendered message nodes in the active conversation. They do not read:

- cookies
- local or session storage
- authorization headers
- hidden system prompts
- network responses
- unrelated sidebar conversations
- conversations absent from the active page

The paired Clipper device token authorizes the upload grant and final snapshot commit. Revoked devices cannot add conversation captures.

## Revision behavior

The provider conversation ID is the primary identity. Repeated captures update one conversation record:

- identical normalized JSON reuses the existing snapshot
- changed rendered messages append a versioned snapshot
- added and removed message fingerprint counts are recorded
- ambiguous commit responses retry once with the same uploaded storage ID
- an already-referenced snapshot blob is never deleted by an idempotent retry
- the ordinary Ourchival reference remains in Inbox, Library, Later, Archive, or Trash

## Current bounds

- 5,000 rendered messages
- 200,000 characters per message
- 4.5 million normalized JSON characters
- 5 MB uploaded JSON

## Current limitations

The adapter preserves messages currently rendered in the active page. It does not yet preserve:

- unloaded earlier messages
- branch and fork identity
- attachment files
- citation metadata beyond rendered text
- canvas document state
- voice transcripts
- provider export metadata absent from the DOM

See `PROVIDER_CONVERSATION_CAPTURE.md` for the shared ChatGPT, Claude, and Gemini contract.

Tracking issue: #44

Active integration: #53
