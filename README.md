# SID to JSON Converter

A browser-based Commodore 64 SID analysis tool. It loads PSID/RSID files, executes their player code with a compact 6502/C64 runtime, records SID register and voice state frame-by-frame, exports the capture as JSON, and can turn a compatible JSON capture into Standard MIDI File type 1.

## Features

- PSID and RSID header parsing with strict size, song-range, load-address and C64-memory-boundary validation.
- PAL/NTSC timing selection from SID v2NG clock flags.
- In-browser 6502, CIA, VIC-II and SID state simulation for player execution.
- Frame JSON containing all 25 SID registers, voice pitch/envelope/waveform state, gate triggers, and filter state.
- JSON-to-MIDI type-1 export with conductor, voice and optional drum tracks.
- Pitch bend, ADSR/pulse/filter automation, noise-to-drum mapping, optional quantization, gap merging and arpeggio-to-chord conversion.
- Defensive JSON validation at every conversion boundary: frame ordering, register ranges, voice/filter values and capture duration must be internally consistent.
- Smart quantization evaluates straight and triplet grids, while preserving unquantized timing when there is no confident match.
- Fully bundled React/Vite/Tailwind build: no CDN, import map or API key is required at runtime.

## Run locally

Requirements: Node.js 20+ and pnpm 10+.

```sh
pnpm install
pnpm run typecheck
pnpm run build
pnpm run verify
pnpm run dev
```

### Browser quick start

1. Open the local URL printed by Vite.
2. Drop a PSID or RSID file into **SID → JSON**.
3. Set a capture limit (start with 60 seconds) and select the subtune, numbered from 1.
4. Choose **Convert to JSON**. A successful capture also prepares a MIDI download using the selected MIDI settings.
5. Download JSON for forensic/register analysis, or MIDI for a DAW sketch.

For a JSON capture produced elsewhere, use the **JSON → MIDI** panel. The browser validates the file before conversion and reports incompatible captures instead of producing a broken MIDI file.

### Choose a workflow

| Goal | Recommended command or setting |
| --- | --- |
| Inspect header and supported subtunes | `sid-json inspect tune.sid` |
| Preserve exact frame positions | `sid-json sid-to-json tune.sid --seconds 180` |
| Create a musical first-pass MIDI | `sid-json sid-to-midi tune.sid --quantize auto --note-duration smart` |
| Keep chip arpeggios as separate notes | Do not use `--arps-to-chords` |
| Turn fast arpeggios into DAW chords | Add `--arps-to-chords` |
| Treat noise as pitched material | Add `--no-drums` |

## Command-line interface

The same parser, capture runtime and MIDI writer are available without the browser UI. Build once, then run the CLI:

```sh
pnpm run build:cli
pnpm run cli -- inspect tune.sid
pnpm run cli -- sid-to-json tune.sid --seconds 180 --song 1 -o tune.json
pnpm run cli -- json-to-midi tune.json --quantize none -o tune.mid
pnpm run cli -- sid-to-midi tune.sid --json-out tune.json --quantize auto -o tune.mid
```

`sid-to-json` defaults to a 60-second capture and writes JSON alongside the source SID. `sid-to-midi` performs capture and MIDI export in one command, with optional `--json-out`. `json-to-midi` accepts `--quantize` (including `1/16T` and `1/8T` triplets), `--octave-shift`, `--min-note-frames`, `--note-duration`, `--no-expression`, `--minimal-automation`, `--no-merge-gaps`, `--no-drums`, and `--arps-to-chords`. Use `validate-json` before batch MIDI conversion. Run `pnpm run cli -- --help` for the complete reference.

`pnpm run verify` creates an isolated synthetic PSID fixture and checks malformed SID/JSON rejection, deterministic SID-to-JSON output, PAL frame timing, custom-IRQ PSID dispatch, and the complete MIDI chunk/end-marker structure.

See [the detailed usage guide](docs/USAGE.md) for copy-ready commands, output conventions, option recipes, and troubleshooting.

## MIDI interpretation

The MIDI export represents musical control data inferred from SID registers, not rendered SID audio. It maps frequency to notes/pitch bend, gate/envelope to note timing and velocity, pulse and filter values to controller data, and SID noise to General MIDI drum notes. Use the JSON export when you need the raw register capture for inspection or a different downstream mapping.

For the timing model, supported C64 runtime behavior, JSON fields, MIDI controller map, and practical export recipes, see [the emulation and format guide](docs/EMULATION_AND_FORMAT.md).

## Accuracy boundaries

The included runtime is a pragmatic SID-player tracer, not a transistor-level 6581/8580 audio emulator. It supports RAM banking, a minimal vector/IRQ boot environment, CIA timer IRQs, VIC raster IRQs and standard IRQ indirection for conventional player drivers. Complex loaders, ROM-dependent RSID programs, multi-SID files and cycle-perfect raster effects may require a full C64 emulator. Unsupported 6502 opcodes, non-returning init routines and over-budget PSID play calls fail explicitly rather than silently producing a partial capture.

## Project layout

```text
App.tsx                     browser workflow and export controls
services/sid/SidParser.ts   PSID/RSID validation and metadata parsing
services/sid/SidPlayer.ts   C64 execution and frame capture
services/sid/C64System.ts   CPU bus, CIA and VIC timing model
services/sid/SidChip.ts     SID register/envelope snapshot model
services/sid/JsonToMidi.ts  JSON-to-Standard-MIDI writer
services/sid/SidTypes.ts    stable JSON capture types
```
