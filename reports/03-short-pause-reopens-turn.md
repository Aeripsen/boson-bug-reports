# [Realtime] A short pause re-opens the committed user turn: same item committed twice, same response id created twice, two "final" transcripts

### Product
Higgs Realtime

### Issue type
Bug

### Severity
Major (clients that act on each transcript or each response.created act twice, e.g. skip a question)

### What happened?
Summary: Under `server_vad`, when the user pauses briefly and goes on speaking, the server ends the turn, commits
the item, creates a response, then re-opens the same turn: `speech_started` arrives again with the same `item_id`,
the same item is committed and added a second time, `response.created` arrives a second time with the same
`response_id`, and `conversation.item.input_audio_transcription.completed` arrives twice for one item, first partial,
then full. No cancel or client-initiated `response.create` is involved; the client only streams audio after setup. The
reopen may be intentional, but the repeated 'created' and 'final' event semantics are not documented.

Expected, from the docs:
- https://docs.boson.ai/api-reference/realtime/server-events: `conversation.item.input_audio_transcription.completed`
  is the "Final transcript of a user audio turn".
- Same page: `response.created` means "Response generation started", and `response.done` is "Emitted exactly once
  per `response_id`", so one response id would be created once.
- A new or continued user turn would either get a new item id, or the merge would be documented with an event that
  says the earlier commit and response were superseded.

Actual (session `b30f3817`, 2026-10-24, EDT, no client event other than audio appends):
- 08:46:28.361 `speech_stopped` item `11d711d7`; .366 `committed`; .367 `conversation.item.added` `11d711d7`;
  .368 `response.created b30f_resp_4`.
- 08:46:28.471 `speech_started` item `11d711d7` again (110 ms later).
- 08:46:28.600 `transcription.completed` `11d711d7`: "Sorry. Let me add one thing."
- 08:46:31.751 `speech_stopped` `11d711d7`; .756 `committed` again; .757 `conversation.item.added` `11d711d7` again;
  .757 `response.created b30f_resp_4` again.
- 08:46:32.123 `transcription.completed` `11d711d7` again: "Sorry, let me add one thing. I would also retrain the
  model every week."
- 08:46:33.639 one `response.done b30f_resp_4` (completed).

The same happened in session `3ee7927f` (08:45:32, item `58cf62cb`, response `3ee7_resp_2`, transcripts "I think the
main risk in production is data drift." then the full sentence). A turn with no pause (session `ff72f056`, three
turns) produced one of each event, so the pause is the trigger.

Questions for Boson: is the re-open intended (it looks like a guard against premature end of turn)? If so, please
document it, give the second `transcription.completed` a way to say it replaces the first, and say whether the first
`response.created` should be treated as superseded.

### How to reproduce
1. Connect, `session.update` with `turn_detection: {"type": "server_vad"}` and transcription `higgs-stt-3.1`.
2. Stream speech that has a short pause in it, e.g. Higgs TTS of "Sorry, let me add one thing. I would also retrain
   the model every week." (the TTS pause after "thing." is enough), then silence.
3. Log every server event: two `committed`, two `conversation.item.added`, two `response.created` (same id) and two
   `transcription.completed` for one `item_id`.

Script: `repro.mjs b1` with `FEEDBACK_NO_CANCEL=1` (Node 24, no dependencies).

### Details
Found by Sepehr Jafari (@Aeripsen) and Javad Maheronnaghsh (@mjmaher987), team Interview from Hell.

higgs-realtime, `server_vad` defaults (threshold 0.85, silence 500 ms), `higgs-stt-3.1`, PCM16 24 kHz, Windows 11,
Node 24.16. Times are EDT (UTC-4).
