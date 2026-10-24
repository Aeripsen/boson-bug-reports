# [Realtime] Mid-session turn_detection update rejects the entire settings change; API docs conflict

### Product
Higgs Realtime

### Issue type
Docs

### Severity
Major (an undocumented immutable setting causes a mixed settings update to be rejected; clients must handle the error)

### What happened?
Summary: After session start, changing `audio.input.turn_detection` makes the server reject the whole
`session.update` with an error, so the new instructions in the same request receive no `session.updated`
acknowledgment. The Realtime API docs omit this immutable-setting restriction and contradict each other on
whether an invalid update closes the socket. Boson's Pipecat 0.1.4 changelog (Oct 22) *does* acknowledge that
turn detection is fixed at session start.

Expected: The API reference should document that turn detection is immutable, state explicitly that an invalid
`session.update` is rejected atomically, and specify whether the connection stays open. The connections guide
lists turn detection among session settings without describing this limitation.

Actual (sessions `d15d19d6` at 2026-10-24 08:43:46 EDT and `ae7e01ef` at 08:44:36, same result both times):
- The second `session.update` gets, 26 ms later:
  `{"type": "invalid_request_error", "code": "400", "message": "turn_detection cannot be changed after session start", "param": null}`
- The socket stays open (no close within 3 s, the session goes on working), contrary to client-events.
- The invalid mixed update receives no `session.updated`; the model answers APPLE afterward, but output alone
  cannot prove configuration state because the model may ignore valid instructions as well.
- A following instructions-only update is acknowledged with `session.updated`, but in session `d15d19d6` the
  model still answered APPLE. This is not evidence that the acknowledged update failed to apply.
- `code` is `"400"`, an HTTP status, not the "machine-readable cause" the errors page describes, and `param` is
  `null` although the cause is `audio.input.turn_detection`.

Control: a separate fresh session `8c47eb90` acknowledged an instructions-only `session.update` and answered
BANANA instead of APPLE. Another longer-context session `d6972540` repeated the old code word despite an
acknowledged update. Treat the error event and acknowledgment as protocol evidence; model wording is only
supporting behavioral evidence.

The two pages that disagree:
- https://docs.boson.ai/api-reference/realtime/client-events, `session.update`: "An invalid configuration produces an
  `error` and the session is closed."
- https://docs.boson.ai/models/higgs-realtime/guides/tool-calling (web search section): "An invalid configuration
  returns an `error` event, and the session keeps its previous configuration."

Impact: apps bundling a turn-detection change with a new persona can unknowingly retain their old configuration
if they do not handle the `error` event. The entire update being rejected may be correct server behavior;
the documentation and error contract are the issues. Related adapter acknowledgment:
https://github.com/boson-ai/pipecat-boson/blob/main/CHANGELOG.md#014---2026-10-22

### How to reproduce
1. Connect `wss://api.boson.ai/v1/realtime?model=higgs-realtime`; send `session.update` with
   `turn_detection: {"type": "server_vad"}` and instructions "If asked for the code word, reply with exactly APPLE."
2. Ask "What is the code word?" (text item + `response.create`): answer APPLE.
3. Send `session.update` with instructions "... exactly BANANA." and
   `turn_detection: {"type": "server_vad", "silence_duration_ms": 250}`.
4. Observe the `error`; ask again: answer is still APPLE.
5. Without changing turn detection, a subsequent instructions-only update receives `session.updated`; the
   model may still say APPLE in this session. For a behavioral control, run `repro.mjs b2c` in a fresh session
   (recorded session `8c47eb90` changed APPLE to BANANA).

Script: `repro.mjs b2` (Node 22+, no dependencies).

### Details
Found by Sepehr Jafari (@Aeripsen) and Javad Maheronnaghsh (@mjmaher987), team Interview from Hell.

higgs-realtime, `server_vad`, transcription `higgs-stt-3.1`, PCM16 24 kHz, Node 24.16, Windows 11.
Session `d15d19d6`, error event_id `978e2b0a-9fa0-4ebe-a811-683297d57e35`, 2026-10-24 08:43:46.766 EDT (UTC-4).
First seen 2026-10-24 about 01:20 EDT in end-to-end runs of our hackathon app.
