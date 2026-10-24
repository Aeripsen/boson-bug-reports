# How the pieces fit, and where each bug lives

The Higgs Realtime protocol follows OpenAI's GA Realtime API. One WebSocket carries JSON events both ways: the client
streams microphone audio and sends commands, and the server streams back what it heard and what it says. Five ideas
explain every finding in this repo.

## 1. Voice activity detection turns a stream into turns

The client never says "I'm done talking". It just keeps sending 100 ms chunks of audio (`input_audio_buffer.append`),
silence included. With `turn_detection: {"type": "server_vad"}` the server runs a voice activity detector over that
stream. A VAD outputs a speech probability for each short frame (a neural VAD such as Silero does this every ~30 ms).
Boson's parameters act on that probability stream:

- `threshold` (0.85): a frame counts as speech when its probability is above this.
- `min_speech_duration` (0.125 s): speech must last this long before a turn starts, so a cough does not open one.
- `silence_duration_ms` (500): after speech, this much continuous non-speech ends the turn.
- `prefix_padding_ms` (300): audio kept from before the detected start, so the first syllable is not clipped.

When the turn starts the server sends `input_audio_buffer.speech_started`. When the silence window has passed it
sends `speech_stopped`, then `input_audio_buffer.committed`: the audio for that turn is sealed into a conversation
**item** with an `item_id`, announced by `conversation.item.added`.

The hard part is that people pause mid-sentence. A 500 ms window cuts a slow speaker off; a long window makes the
agent feel sluggish. A common fix is a grace period: if speech resumes just after the turn ended, treat it as the
same turn. That is a design choice, and finding 03 is what happens when it is done silently.

## 2. Every turn gets an automatic response

Under `server_vad` the server answers every committed turn by itself, unless the session sets
`turn_detection.create_response: false`. The docs say that field has no effect, but it does stop the automatic reply
([#29](https://github.com/boson-ai/Boson-Feedback-Collection/issues/29)). It creates a **response** (`response.created`
with a `response_id`), streams audio (`response.output_audio.delta`) and a transcript of what it says, and ends with
`response.done`, whose `status` is `completed` or `cancelled`. The reference promises `response.done` is
"emitted exactly once per `response_id`".

That promise is what clients build on. A client keeps state like "a response is in flight, do not ask for another",
and clears it on `response.done`. If `response.done` never comes, that state never clears: the client either hangs
or, if it uses a timeout, guesses, and guessing in a voice app means two voices at once or none.

## 3. Ending a response early: interrupt and cancel

There are three ways a response ends before it would finish:

- **Barge-in**: the user starts talking over it. The server stops it and ends it with `status: cancelled`.
- **`response.create` from the client** under server VAD: "any in-flight response is interrupted first".
- **`response.cancel`** from the client: "the cancelled response finishes with `response.done` (status: cancelled)".

There is a classic race inside any server like this. A response exists as soon as the request is accepted
(`response.created` is sent), but generation starts a moment later, when the model produces its first token or audio
frame. If the cancel or interrupt is handled by the generation loop ("stop generating, then emit done"), a response
that has not started generating has no loop to stop, and nothing emits the done. The response is left half-open.

## 4. Transcripts are a separate stream

With `transcription.model: higgs-stt-3.1`, a speech-to-text model transcribes each committed user item and the server
sends `conversation.item.input_audio_transcription.completed`, documented as the "final transcript of a user audio
turn". There are no partial (`.delta`) events on Boson, so a client reasonably treats each `completed` as the answer
to act on: score it, decide to give a hint, move to the next question.

## 5. Session configuration

`session.update` sets everything: model, instructions, voice, formats, turn detection, tools. The first one starts
the session; later ones are acknowledged with `session.updated`. What a bad update does is the contract that matters,
and Boson documents it twice, differently (finding 04).

## The findings in those terms

**01 and 02: a response ended before its first output never gets `response.done`.** In the logs the response is
created, the client cancels it one millisecond later (01) or interrupts it with its own `response.create` (02), and
no `response.done` ever arrives for that id. The control in 02 is the useful part: the same interrupt 300 ms later,
after audio had started, does produce `response.done` with `cancelled`. So the end-of-response path exists; it is
only skipped when there was no output yet. That points straight at the race in section 3. Our hypothesis, not
verified: cancellation is handled where audio is produced, and a response with nothing produced is never finalized.

01 shows the worse consequence. The half-open response stays attached to the user's turn, so when the user speaks
again 4.5 seconds later, the server treats it as more of the old turn: same `item_id`, the old audio plus the new,
and the old `response_id` is created again and answers only the combined text. In an interview app that means the
candidate's first answer never gets a reply of its own.

**03: a short pause re-opens a committed turn.** No cancel needed. The voice pauses for about 100 ms; VAD ends the
turn, commits the item, creates a response and finishes a transcript; then speech resumes and the server re-opens the
same item: a second `speech_started`, `committed` and `conversation.item.added` for the same `item_id`, a second
`response.created` with the same `response_id`, and a second "final" transcript with the full sentence. This looks
like the grace period from section 1, done without telling the client. The server knows the first commit was
provisional; the client cannot. A client that acts on each `completed` transcript or each `response.created` acts
twice. In our app that skipped a question. The fix can be small: a field on the second events saying they replace
the first, or holding the commit until the grace period is over.

**04: one bad field drops the whole update.** Changing `turn_detection` after the session starts is rejected
("turn_detection cannot be changed after session start"), and the instructions in the same update are dropped with
it, while the socket stays open. client-events says an invalid configuration closes the session; the tool-calling
guide says the session keeps its previous configuration. The service does the second, and no page says
`turn_detection` is fixed at start. The error also puts `"400"` (an HTTP status) in `code`, which the errors page
describes as a machine-readable cause, and leaves `param` null.

**05: the errors page.** It promises "every error code with its fix" and lists none of the six Realtime causes
named on the client-events page, which itself puts some causes in `type` and others in `code`.

## What a client should do today

- Never rely on `response.done` for a response you ended before it produced audio. Track response ids yourself and
  treat "created, then superseded or cancelled before any delta" as finished.
- Expect the same `item_id` to be committed again and the same `response_id` to be created again. Key your logic on
  item ids, and let a later transcript for the same item replace the earlier one instead of counting as a new answer.
- Choose `turn_detection` at connect time and never change it, and send instructions changes in their own
  `session.update`.
- Watch every `error` event. Several of these failures are only visible there, or not at all.
