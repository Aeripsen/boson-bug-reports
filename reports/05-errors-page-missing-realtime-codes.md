# [Realtime] Errors reference omits six Realtime event causes and mixes type/code usage

### Product
Higgs Realtime (docs)

### Issue type
Docs

### Severity
Minor

### What happened?
Summary: The "Common error types" page promises "every error code with its fix" but omits six named Realtime
event causes described in client-events. Some of those causes appear as `type`, others as `code`, conflicting
with the errors page's category-versus-cause guidance.

Expected: https://docs.boson.ai/api-reference/errors lists the Realtime `error` event causes with a fix, as its
description promises ("HTTP statuses, the error body shape, and every error code with its fix"), and every page uses
`type` for the category and `code` for the cause, as the errors page instructs ("Handle errors by `type` (the stable
category) and use `code` to distinguish causes within it").

Actual: the errors page covers `authentication_error`, `invalid_request_error`, `rate_limit_error`,
`insufficient_quota`, `api_error` and the four `insufficient_quota` codes. Its "Realtime errors" section only covers
billing (`4429`) and invalid keys (`3000`). These causes, all from
https://docs.boson.ai/api-reference/realtime/client-events, appear nowhere on it:

| Cause | Where it is named | Field used there |
|---|---|---|
| `voice_output_task_ongoing` | `input_audio_buffer.commit`, `response.create` | `type` |
| `invalid_previous_item_id` | `conversation.item.create` | `type` |
| `conversation_item_duplicate_id` | `conversation.item.create` | `type` |
| `conversation_item_not_found` | `conversation.item.retrieve` | `type` |
| `response_id_mismatch` | `response.cancel` | `code` |
| `response_not_active` | `response.cancel` | `code` |

So a client following the errors page ("handle errors by `type`") would switch on `voice_output_task_ongoing` as a
category for some causes and on `code` for others, and cannot tell which without reading each event's paragraph.

The live service also uses `code` for an HTTP status: the turn_detection rejection below arrives as
`{"type": "invalid_request_error", "code": "400", ...}` (session `d15d19d6`, 2026-10-24 08:43:46 EDT), so `code`
is not the "machine-readable cause" the page describes.

One independently confirmed live error is also missing from the error reference:
- message `turn_detection cannot be changed after session start` (session `d15d19d6`).

A prior app run reportedly showed `No user input`, but the isolated live reproduction did not reproduce it.
Do not treat that historical message as a confirmed standalone bug.

### How to reproduce
1. Open https://docs.boson.ai/api-reference/errors.md and https://docs.boson.ai/api-reference/realtime/client-events.md.
2. Search the errors page for any of the six causes above: none is present.
3. Compare the field each cause is given in client-events (`type` vs `code`).

### Suggested fix
A "Realtime error codes" table on the errors page: `type`, `code`, `message`, when it happens, what to do. Use one
field consistently (category in `type`, cause in `code`). Add the observed turn-detection rejection. Investigate `No user input` separately if it can be reproduced.

### Details
Found by Sepehr Jafari (@Aeripsen) and Javad Maheronnaghsh (@mjmaher987), team Interview from Hell.

Docs as served 2026-10-24 08:27 EDT (UTC-4).
