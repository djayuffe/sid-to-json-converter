# Usage examples

All commands below use the project scripts so they work without a global installation. Run `pnpm run build:cli` once after cloning or after changing source files.

## Inspect a SID before capturing

```sh
pnpm run cli -- inspect "music/Example Tune.sid"
```

The command prints parsed PSID/RSID metadata, including title, author, format version, available subtunes, declared PAL/NTSC clock, load/init/play addresses, and program size. Use the `songs` field to choose a valid `--song` number.

## Create a JSON register trace

```sh
pnpm run cli -- sid-to-json "music/Example Tune.sid" \
  --song 2 --seconds 120 --out "exports/example-song-2.json"
```

The capture contains one frame per PAL or NTSC video update. The default output is next to the source file with a `.json` extension; pass `--out` to choose another path. Use `--compact` when output size matters more than readability.

Validate an existing trace before using it in a batch job:

```sh
pnpm run cli -- validate-json "exports/example-song-2.json"
```

## Make a musical MIDI draft

```sh
pnpm run cli -- sid-to-midi "music/Example Tune.sid" \
  --song 2 --seconds 120 --json-out "exports/example-song-2.json" \
  --quantize auto --note-duration smart --out "exports/example-song-2.mid"
```

This performs capture and MIDI conversion in one operation, while retaining JSON for later inspection. The generated `.mid` is a standard MIDI File type 1: conductor track first, three SID-voice tracks, and a Channel 10 drum track only when noise events are detected.

To convert a saved trace with different musical settings without rerunning C64 code:

```sh
pnpm run cli -- json-to-midi "exports/example-song-2.json" \
  --quantize 1/16 --octave-shift -1 --minimal-automation \
  --out "exports/example-song-2-clean.mid"
```

## Option recipes

| Situation | Suggested options | Why |
| --- | --- | --- |
| Faithful inspection | `--quantize none --note-duration gate --no-drums` | Keeps frame-derived timing and avoids percussion heuristics. |
| General DAW sketch | `--quantize auto --note-duration smart` | Finds a reliable straight/triplet grid when present and handles sustaining sounds. |
| Drum-oriented tune | `--quantize 1/16 --note-duration gate` | Produces regular timing and short, explicit gate-based events. |
| Filter/pulse-heavy sound design | default automation | Exports expression, filter, pulse, ADSR, waveform and routing controllers. |
| Cleaner piano-roll view | `--minimal-automation --no-merge-gaps` | Reduces controller density and preserves short rests. |
| Chordal reduction | `--arps-to-chords --quantize 1/8` | Collapses rapid tonal arpeggios heuristically; review the result in a DAW. |
| Noise used melodically | `--no-drums` | Keeps noise-waveform events in their SID voice instead of Channel 10. |

`--octave-shift` accepts whole octaves from `-4` to `4`. `--min-note-frames` removes very short segments; start with `2` or `3` if a tune creates too many tiny notes. Valid quantization values are `none`, `auto`, `1/32`, `1/16`, `1/16T`, `1/8`, `1/8T`, and `1/4`.

## Browser usage

Run `pnpm run dev` and open the URL printed by Vite. The browser never uploads a SID or JSON file: decoding, tracing, validation, and MIDI generation happen locally. A completed SID capture automatically prepares MIDI using the controls in the JSON-to-MIDI panel. Change an option to regenerate MIDI from the in-memory capture; download JSON first if you want a durable, inspectable record.

## Troubleshooting

| Message or symptom | Meaning and next step |
| --- | --- |
| `Magic ID mismatch` | The file is not a PSID/RSID file or is truncated. Check the source file. |
| `Subtune must be ...` | Choose a `--song` value between 1 and the `songs` value shown by `inspect`. |
| `SID init did not return` | The player's INIT routine exceeded the safety budget or relies on unavailable machine state. Try a full C64 emulator capture for this tune. |
| `SID play routine exceeded ...` | A PSID play routine did not return within one video frame. This often indicates unsupported code or a nonstandard driver. |
| Unsupported opcode | The compact 6510 implementation does not support an instruction reached by this tune. The error includes its address for diagnosis. |
| MIDI feels too rigid | Use `--quantize none` or `auto`, and try `--note-duration audible` for longer release tails. |
| MIDI is too busy | Add `--minimal-automation`, increase `--min-note-frames`, or use `--arps-to-chords` where musically appropriate. |

## Verify the checkout

```sh
pnpm run typecheck
pnpm run verify
pnpm run build
```

`verify` generates temporary synthetic PSID and RSID fixtures. It checks deterministic captures, PAL timing, direct play and CIA IRQ paths, rejected malformed input, and the structure of the generated MIDI file.

## Licensing the output

The converter itself is GPL-3.0-or-later and copyrighted by Ulf Bertilsson. A JSON or MIDI file made with the converter may have separate copyright or licensing considerations because it can reflect the musical composition or SID program supplied as input. Verify that you have the rights needed to share a tune or its derived export.
