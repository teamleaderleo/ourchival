# ChatGPT conversation capture

Ourchival Clipper can archive the visible rendered messages from an open ChatGPT conversation through an explicit popup action.

## Capture action

1. Open a saved ChatGPT conversation on `chatgpt.com` or `chat.openai.com`.
2. Open Ourchival Clipper.
3. Choose **Save this ChatGPT conversation**.

The action reads the active tab, normalizes the visible conversation, uploads portable JSON, and creates or updates one conversation archive reference.

## Adapter contract

Adapter identifier:

```txt
chatgpt.dom.v1
```

The adapter reads elements carrying `data-message-author-role` and preserves:

- visible message role
- visible stable message ID when exposed
- rendered text, including code text
- visible timestamp when exposed
- visible model label when exposed
- conversation title
- provider conversation ID from the `/c/<id>` URL
- canonical live URL
- capture time

Messages fall back to deterministic local IDs when the rendered page omits an ID.

## Privacy boundary

Capture occurs only after an explicit popup click. The adapter reads rendered message nodes in the active conversation. It does not read:

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

- identical normalized JSON discards the redundant upload
- changed visible messages append a versioned snapshot
- added and removed message fingerprint counts are recorded
- the ordinary Ourchival reference remains in Inbox, Library, Later, Archive, or Trash

## Current bounds

- 5,000 visible messages
- 200,000 characters per message
- 4.5 million normalized JSON characters
- 5 MB uploaded JSON

## Current limitations

This first adapter preserves visible rendered messages. It does not yet preserve:

- unloaded earlier messages
- branch and fork identity
- attachment files
- citation metadata beyond rendered text
- canvas document state
- voice transcripts
- provider export metadata absent from the DOM

Tracking issue: #44

Stacked implementation: #51 on #50
