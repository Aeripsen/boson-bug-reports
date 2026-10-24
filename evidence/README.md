# Evidence

Every log in `logs/` is one live session against `wss://api.boson.ai/v1/realtime`, recorded 2026-10-24 between
08:43 and 08:48 EDT (UTC-4) by `repro/repro.mjs`. The user's voice is synthetic (Higgs TTS), never a real person.

- `<scenario>-<UTC time>.jsonl`: every event both ways, one per line, with local time (`at`) and ms since start
  (`t_ms`). Audio payloads are replaced by their byte count. No keys.
- `<scenario>-<UTC time>.summary.json`: the counts the reports quote (responses created and done per id,
  transcripts per item, errors, close code).

## Which log supports which report

| Report | Main evidence (session id) | Control |
|---|---|---|
| 01 cancel ignored, next turn merged | `b1-cancel-before-output-2026-10-24T12-46-58` (`e5ceef0c`) | `b1-control-no-cancel-2026-10-24T12-46-13` (`b30f3817`) |
| 02 no `response.done` before output | `b4-no-user-input-d0-2026-10-24T12-47-33` (`d2b67987`); also `e5ceef0c` above | `b4-no-user-input-d300-2026-10-24T12-47-48` (`fb8d533a`) |
| 03 short pause re-opens the turn | `b1-control-no-cancel-2026-10-24T12-46-13` (`b30f3817`), `b1-cancel-before-output-2026-10-24T12-45-25` (`3ee7927f`) | `b3-transcription-repeats-2026-10-24T12-44-56` (`ff72f056`, no pause, clean) |
| 04 turn_detection update rejected | `b2-turn-detection-update-2026-10-24T12-43-45` (`d15d19d6`), `b2-turn-detection-update-2026-10-24T12-44-36` (`ae7e01ef`) | `b2c-instructions-only-fresh-2026-10-24T12-44-14` (`8c47eb90`), `b2c-instructions-only-after-answer-2026-10-24T12-44-15` |
| ruled out: model anchoring | `b2d-two-answers-then-update-2026-10-24T12-44-33` (`d6972540`) | |

Re-checked 2026-10-24 09:23 EDT, still happening:
- 01: `b1-cancel-before-output-2026-10-24T13-23-47` (`c57723f0`): `c577_resp_2` created twice, item `e51b8ef2` merged.
- 02: `b4-no-user-input-d0-2026-10-24T13-24-11` (`0bf9c49c`): `0bf9_resp_2` never gets `response.done`.

Each report cites the `.jsonl` and `.summary.json` of its main run and its control.
