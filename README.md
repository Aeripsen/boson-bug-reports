# Higgs Realtime bug reports

Five problems in Boson AI's Higgs Realtime API, found while building a voice interview app ("Interview from Hell") at
the Boson AI x MScAC Higgs Audio Hackathon, Toronto, October 23 to 24, 2026. Each one has a reproduction script and
the raw event logs from the live API.

By Sepehr Jafari ([@Aeripsen](https://github.com/Aeripsen)) and Javad Maheronnaghsh
([@mjmaher987](https://github.com/mjmaher987)).

## The findings

| # | Finding | Severity | Upstream |
|---|---|---|---|
| 01 | [`response.cancel` before output is ignored, and the next user turn is merged into the cancelled one](reports/01-cancel-before-output-merges-next-turn.md) | Major | Evidence added to [#11](https://github.com/boson-ai/Boson-Feedback-Collection/issues/11#issuecomment-6388070745) (merged next turn) |
| 02 | [A response ended before its first audio never gets `response.done`](reports/02-no-response-done-before-output.md) | Major | Evidence added to [#11](https://github.com/boson-ai/Boson-Feedback-Collection/issues/11#issuecomment-6388070745) (overlapping `response.create` case) |
| 03 | [A short pause re-opens a committed turn: same item and response ids twice, two "final" transcripts](reports/03-short-pause-reopens-turn.md) | Major | Filed: [#27](https://github.com/boson-ai/Boson-Feedback-Collection/issues/27) |
| 04 | [A `session.update` that changes `turn_detection` is rejected whole, and two doc pages disagree on what happens](reports/04-session-update-turn-detection.md) | Major | Filed: [#4](https://github.com/boson-ai/Boson-Feedback-Collection/issues/4), live evidence in [this comment](https://github.com/boson-ai/Boson-Feedback-Collection/issues/4#issuecomment-6388070964) |
| 05 | [The errors reference lists none of the Realtime error codes](reports/05-errors-page-missing-realtime-codes.md) | Minor | Filed: [#28](https://github.com/boson-ai/Boson-Feedback-Collection/issues/28) |

We also filed four requests that came out of the same work:
[#5](https://github.com/boson-ai/Boson-Feedback-Collection/issues/5) (how an automatic reply consumes text added during its turn),
[#6](https://github.com/boson-ai/Boson-Feedback-Collection/issues/6) (keep server VAD but let the client decide when to reply),
[#7](https://github.com/boson-ai/Boson-Feedback-Collection/issues/7) (keeping spoken replies within a time budget),
[#8](https://github.com/boson-ai/Boson-Feedback-Collection/issues/8) (requiring a tool for one step).

## How we found them

The app is a spoken mock interview: Higgs Realtime plays the interviewer, and our client decides when to move to the
next question, give a hint or reveal an answer. In the first live runs on the night of the 23rd the interviewer spoke
twice in a row, went silent, and skipped questions.

Most of that was our own client, and we fixed it (fourteen groups of race conditions, covered by tests). What was
left could not be explained by our code: a response id that showed up as "created" three to five times, transcripts
of one turn that arrived again with more words, a cancel that seemed to do nothing. We stopped guessing from the app
and wrote a small script that talks to the API directly ([`repro/repro.mjs`](repro/repro.mjs)). It speaks synthetic
Higgs TTS audio into a paced fake microphone, so every run is the same and no real voice is recorded, and it logs
every event in both directions with times and ids.

For each suspected bug we ran the smallest sequence that should trigger it, then a control run that changes one
thing. The controls changed two of our conclusions:

- We first thought the repeated ids (03) were caused by our cancel. The same speech with no cancel still re-opened
  the turn whenever the voice paused for about 100 ms. So 03 is its own bug, and it hits any client, not only one
  that cancels.
- A valid instructions update was ignored after a rejected one, which looked like a fourth bug. The control without
  any rejected update was ignored too, once the model had already answered twice. That is the model sticking to its
  own earlier answers, not the protocol, so we left it out.

We also checked each claim against the docs as they read that morning, and dropped two that the docs already cover:
the server always replies after each user turn (documented: `create_response` and `interrupt_response` "are accepted
but have no effect"), and the default VAD threshold (0.85 everywhere; the 0.55 we had was a wrong comment in our own
code). A "No user input" error we saw in the app did not reproduce in isolation.

[`notes/how-it-works.md`](notes/how-it-works.md) explains the mechanics behind each finding: VAD, turns, items,
the response lifecycle, and where we think each bug lives on the server.
[`notes/workarounds.md`](notes/workarounds.md) lists what our client does about each one until the server is fixed.

## Reproducing

Node 22 or later, no dependencies, a Boson API key in a file outside the repo. See [`repro/README.md`](repro/README.md).
Each scenario is 20 to 40 seconds of realtime audio. [`evidence/README.md`](evidence/README.md) maps every log to the
finding it supports.

This repo was created on 2026-10-24 at 09:20 EDT (GitHub's `created_at`). All runs were on 2026-10-24 between 08:43 and 09:24 EDT against `wss://api.boson.ai/v1/realtime?model=higgs-realtime`,
with `server_vad` defaults, `higgs-stt-3.1` transcription and PCM16 at 24 kHz. Docs quoted are from
https://docs.boson.ai as served that morning; they had not changed by 09:23.
