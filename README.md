# SID to JSON Converter

A browser-based Commodore 64 SID analysis tool. It loads PSID/RSID files, executes their player code with a compact 6502/C64 runtime, records SID register and voice state frame-by-frame, exports the capture as JSON, and can turn a compatible JSON capture into Standard MIDI File type 1.

## Features

- PSID and RSID header parsing with strict size, song-range, load-address and C64-memory-boundary validation.
- PAL/NTSC timing selection from SID v2NG clock flags.
- In-browser 6502, CIA, VIC-II and SID state simulation for player execution.
- Frame JSON containing all 25 SID registers, voice pitch/envelope/waveform state, gate triggers, and filter state.
- JSON-to-MIDI type-1 export with conductor, voice and optional drum tracks.
- Pitch bend, ADSR/pulse/filter automation, noise-to-drum mapping, optional quantization, gap merging and arpeggio-to-chord conversion.
- Fully bundled React/Vite/Tailwind build: no CDN, import map or API key is required at runtime.

## Run locally

Requirements: Node.js 20+ and pnpm 10+.

```sh
pnpm install
pnpm run typecheck
pnpm run build
pnpm run dev
```

Open the local URL printed by Vite, choose a `.sid` file, set the maximum capture duration and subtune, then run the SID-to-JSON conversion. A MIDI file is generated automatically from a successful capture; either JSON or MIDI can be downloaded from the interface.

## Command-line interface

The same parser, capture runtime and MIDI writer are available without the browser UI. Build once, then run the CLI:

```sh
pnpm run build:cli
pnpm run cli -- inspect tune.sid
pnpm run cli -- sid-to-json tune.sid --seconds 180 --song 1 -o tune.json
pnpm run cli -- json-to-midi tune.json --quantize none -o tune.mid
```

`sid-to-json` defaults to a 60-second capture and writes JSON alongside the source SID. `json-to-midi` accepts `--quantize`, `--octave-shift`, `--note-duration`, `--no-expression`, `--minimal-automation`, `--no-merge-gaps`, `--no-drums`, and `--arps-to-chords`. Run `pnpm run cli -- --help` for the complete reference.

## MIDI interpretation

The MIDI export represents musical control data inferred from SID registers, not rendered SID audio. It maps frequency to notes/pitch bend, gate/envelope to note timing and velocity, pulse and filter values to controller data, and SID noise to General MIDI drum notes. Use the JSON export when you need the raw register capture for inspection or a different downstream mapping.

## Accuracy boundaries

The included runtime is a pragmatic SID-player tracer, not a transistor-level 6581/8580 audio emulator. Complex loaders, illegal 6502 opcodes, ROM-dependent RSID programs, multi-SID files and cycle-perfect raster effects may require a full C64 emulator. The application rejects malformed headers rather than silently producing a partial capture.

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
