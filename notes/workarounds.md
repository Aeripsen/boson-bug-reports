# What our client does about each bug

These are the changes we made in our app (Interview from Hell) after hitting each problem in live tests on the night
of October 23 to 24, 2026. They are client-side workarounds; the fixes belong on the server.

## 01 and 02: responses ended before output, and cancel

- We stopped using `response.cancel` to replace a reply. When our app wants to say something else, it lets the
  server's automatic reply start, then sends its own reply; the earlier audio is cut where it has got to, and we send
  `conversation.item.truncate` with the real `audio_end_ms` so the transcript matches what was heard.
- `response.cancel` is used only for Pause.
- The client tracks the current `response_id`. Audio deltas or a late `response.done` for any other id are ignored,
  and a reply we replaced is treated as finished even if its `response.done` never comes.
- Every `response.create` of ours waits at most 10 s for its `response.created`. If nothing arrives we stop waiting
  and report it, but never resend, because the first request may still arrive and two voices would play.

## 03: a re-opened turn sends the same item and transcript again

- The client keeps one record per input `item_id`: which question it answered, its latest text, and what it was taken
  as (answer, hint request, "I don't know").
- A second `transcription.completed` for the same item replaces the earlier text instead of counting as a new answer.
  It can complete an answer, but it can never trigger a second hint, failure or move to the next question.
- A transcript for an item from a question we already left is ignored.

## 04: turn detection is fixed after the session starts

- Turn detection is chosen once, in the first `session.update`, and never changed. Our "pressure" stages, which
  used to shorten `silence_duration_ms`, now change only the instructions and the voice.
- Every `error` event is logged and shown in the debug drawer, because a rejected `session.update` is visible
  nowhere else.

## 05: error codes

- Since the Realtime errors carry no stable code, the client has to match some of them by their `message` text
  (for example "No user input"). That is fragile, and it is why a documented code list would help.
