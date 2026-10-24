# [Realtime] response.cancel before output is silently ignored, and the next user turn is merged into the cancelled one

### Product
Higgs Realtime

### Issue type
Bug

### Severity
Major (a voice app that cancels a reply to say something else loses the user's next answer as a separate turn)

### What happened?
Summary: `response.cancel` sent right after `response.created`, before any output, gets no `response.done`, no
`error` and no audio. No terminal cancellation event is observed. When the user next speaks after several seconds of silence, the new
speech is appended to the previous input item (same `item_id`), the same `response_id` is created again, and that
response completes, answering only the combined text.

Expected, from https://docs.boson.ai/api-reference/realtime/client-events (`response.cancel`): "Cancel the
in-flight response. The cancelled response finishes with `response.done` (`status: "cancelled"`)." When no response
is active, an `error` (`code: "response_not_active"`). We got neither. A user turn after 4.5 s of silence would be a
new item.

Actual (session `e5ceef0c`, 2026-10-24, EDT):
- 08:47:04.974 `speech_stopped` item `04ce380d`; .978 `committed`; 05.081 `response.created e5ce_resp_2`.
- 08:47:05.082 client `response.cancel` with `response_id: "e5ce_resp_2"`. No reply of any kind.
- 08:47:05.309 `transcription.completed` `04ce380d`: "Precision is the share of predicted positives that are correct."
- 4.5 s of silence (we stream silence), then the user speaks again.
- 08:47:09.459 `speech_started` item `04ce380d` (the old item); 13.952 `committed` `04ce380d` again;
  14.050 `response.created e5ce_resp_2` again.
- 08:47:14.486 `transcription.completed` `04ce380d`: "Precision is the share of predicted positives that are
  correct. Sorry, let me add one thing. I would also retrain the model every week."
- 08:47:15.127 `response.done e5ce_resp_2` `completed`, reply: "That's a good approach to maintain model performance
  over time." The first answer never gets its own reply.

Comparison without cancellation (session `b30f3817`) gives two separate input items (`ce028242`, `11d711d7`)
and two response IDs (`b30f_resp_2`, `b30f_resp_4`). The comparison run used a different first sentence, so it is not a perfect control. The
missing `response.done` and the reused ids are in the cancel log itself either way.

This is how we first met it in a live app: an interviewer that cancelled its automatic reply to ask the next
question instead saw the candidate's next answer merged into the previous one, transcripts that grew, and
repeated response-creation events. Those app observations motivated this isolated API reproduction.

### How to reproduce
1. Connect, `session.update` with `turn_detection: {"type": "server_vad"}` and transcription `higgs-stt-3.1`.
2. Stream one spoken sentence with no pause, then silence.
3. On `response.created`, send `response.cancel` with that `response_id`.
4. Wait about 4 s, stream a second sentence, then silence.
5. The second sentence lands in the first `item_id`, and the cancelled `response_id` is created again and completes.

Script: `repro.mjs b1` with `FEEDBACK_SAY="Precision is the share of predicted positives that are correct."`.

### Details
Found by Sepehr Jafari (@Aeripsen) and Javad Maheronnaghsh (@mjmaher987), team Interview from Hell.

higgs-realtime, `server_vad` defaults, `higgs-stt-3.1`, PCM16 24 kHz, Windows 11, Node 24.16. Times are EDT (UTC-4).
Related: [report 02](02-no-response-done-before-output.md), responses ended before output get no `response.done`.
