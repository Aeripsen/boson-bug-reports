# Reproducing the reports

`repro.mjs` needs Node 22 or later and nothing else. It speaks synthetic Higgs TTS speech into a paced fake
microphone, logs every event, and writes `e2e_logs/feedback/<scenario>-<time>.jsonl` and `.summary.json` under the
folder you run it from (`e2e_logs/` is gitignored; copy a run into `evidence/logs/` if a report should cite it).

## Key

Put your Boson key in a file outside this repo and point at it. Never commit it or paste it anywhere.

```
BOSON_API_KEY_FILE=/path/to/boson_api_key node repro/repro.mjs b1
```

`BOSON_API_KEY` in the environment, or a `.env` in the current folder, also work. The key is used only to mint a
10-minute ephemeral key and to call TTS; neither is written to the logs.

## Scenarios

| Command | What it does | Report |
|---|---|---|
| `node repro/repro.mjs b1` | Cancel on `response.created`, then the user speaks again | 01, 03 |
| `FEEDBACK_SAY="Precision is the share of predicted positives that are correct." node repro/repro.mjs b1` | Same, first sentence without a pause | 01, 02 |
| `FEEDBACK_NO_CANCEL=1 node repro/repro.mjs b1` | Same speech, no cancel (control) | 03 |
| `node repro/repro.mjs b2` | `session.update` changing turn_detection and instructions | 04 |
| `node repro/repro.mjs b2c` | Instructions-only update (control) | 04 |
| `node repro/repro.mjs b2d` | Two answers, then an instructions update (anchoring check) | not filed |
| `node repro/repro.mjs b3` | Three spoken turns with no pause and no cancel | 03 control |
| `FEEDBACK_DELAY_MS=0 node repro/repro.mjs b4` | Text item plus `response.create` right at `speech_stopped` | 02 |
| `FEEDBACK_DELAY_MS=300 node repro/repro.mjs b4` | Same, 300 ms later (control) | 02 |

Each run is 20 to 40 s of realtime audio. Keep runs short: credit is limited.
