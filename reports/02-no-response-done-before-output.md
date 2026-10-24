# [Realtime] A response ended before its first audio never gets response.done (cancel or interrupt)

### Product
Higgs Realtime

### Issue type
Bug

### Severity
Major (clients that wait for response.done to free their "response in flight" state wait forever)

### What happened?
Summary: When a response is ended before it has produced any output, the server never sends `response.done` for it.
This happens both when the response is interrupted by a client `response.create` under `server_vad`, and when the
client sends `response.cancel` for it.

Expected, from the docs:
- https://docs.boson.ai/api-reference/realtime/server-events (`response.done`): "Emitted exactly once per
  `response_id`." and its `status` is "`completed` or `cancelled` (interrupted / `response.cancel`)".
- https://docs.boson.ai/api-reference/realtime/client-events (`response.cancel`): "The cancelled response finishes
  with `response.done` (`status: "cancelled"`)."
- Same page (`response.create`): "With server VAD, any in-flight response is interrupted first."

Actual:
1. Interrupt before output (session `d2b67987`, 2026-10-24 08:47:40 EDT): the server's automatic reply
   `d2b6_resp_2` is created at 40.461; our `response.create` (sent at 40.458) creates `d2b6_resp_3` at 40.485.
   `d2b6_resp_2` never receives `response.done`; all 82 audio deltas belong to `d2b6_resp_3`.
2. Control, interrupt after output started (session `fb8d533a`, 08:47:55): same steps with our `response.create`
   300 ms later. `fb8d_resp_2` correctly gets `response.done` with `status: "cancelled"` at 55.699.
3. Cancel before output (session `e5ceef0c`, 08:47:05): `response.created e5ce_resp_2` at 05.081, our
   `response.cancel {response_id: "e5ce_resp_2"}` at 05.082. No `response.done`, no `error`, no audio. The response
   stays open until the user's next turn revives it (see [report 01](01-cancel-before-output-merges-next-turn.md)).

So the documented terminal-event guarantee fails in both tested pre-output interruption paths. We have not
established that every possible pre-output termination behaves this way.

### How to reproduce
1. Connect to `wss://api.boson.ai/v1/realtime?model=higgs-realtime`, `session.update` with
   `turn_detection: {"type": "server_vad"}`, input transcription `higgs-stt-3.1`, PCM16 24 kHz.
2. Stream about 5 s of speech (we use Higgs TTS output), then silence.
3. On `input_audio_buffer.speech_stopped`, immediately send `conversation.item.create` (a user text item) and
   `response.create`.
4. Count `response.done` per `response_id`: the server's own response has none.
5. Variant: on `response.created`, immediately send `response.cancel` with its id; again no `response.done`.

Script: `repro.mjs`, scenarios `b4` (`FEEDBACK_DELAY_MS=0` and `300`) and `b1`
(`FEEDBACK_SAY="Precision is the share of predicted positives that are correct."`). Node 24, no dependencies.

### Details
Found by Sepehr Jafari (@Aeripsen) and Javad Maheronnaghsh (@mjmaher987), team Interview from Hell.

higgs-realtime, `server_vad` defaults, `higgs-stt-3.1`, PCM16 24 kHz in and out, voice `default`, Windows 11,
Node 24.16. Times are EDT (UTC-4). Event logs (JSON lines, audio replaced by byte counts) can be attached.
