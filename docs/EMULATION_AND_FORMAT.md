# Emulation, capture, and MIDI format guide

## Purpose and timing

This project is an offline **SID register tracer**. It executes the player code in a compact 6510/C64 model, captures the primary SID register bank at video-frame boundaries, and translates that control stream into JSON and optional Standard MIDI File type 1. It does not render SID audio.

PAL captures use 50 frames per second and a 985,248 Hz clock. NTSC captures use 60 frames per second and a 1,022,730 Hz clock. A frame's `cycles` field records the modeled CPU budget for that frame; `time` is the frame index divided by 50 or 60. MIDI is written at 120 BPM and 480 ticks per quarter note, so a capture frame equals 19.2 ticks (PAL) or 16 ticks (NTSC) before quantization.

## Runtime model

The C64 runtime provides the execution pieces commonly used by SID players:

- A 64 KiB RAM image, 6510 zero-page port banking, and RAM visibility when BASIC, KERNAL, character ROM, or I/O are banked out.
- Minimal KERNAL vectors: reset enters an idle loop; IRQ dispatch uses the normal RAM vector at `$0314`; the default target acknowledges CIA1, CIA2, and VIC before `RTI`; NMI has a safe `RTI` target.
- 6502/6510 official instructions plus implemented common undocumented instructions. Unsupported opcodes stop conversion with their address instead of silently continuing.
- CIA Timer A and B PHI2 countdown mode, reload, one-shot mode, force-load strobes, ICR source latching/masking, IRQ delivery, and CIA2-to-NMI edge delivery.
- VIC-II PAL/NTSC raster progression, 9-bit raster compare, raster IRQ mask/status/acknowledgement, and register mirrors.
- Primary SID register mirrors (`$D400`–`$D7FF`) and a frame-granular ADSR/filter/voice-state model for analysis.

For PSID files with a nonzero play address, the declared play routine is called once per video frame and must return within that frame's budget. For RSID or zero-play-address files, INIT returns into the idle loop and CIA/VIC IRQs dispatch through `$0314`. This lets conventional interrupt-driven players work without treating a custom IRQ vector as a PSID play routine.

## Deliberate limits

The runtime is intentionally not a complete C64 or SID chip implementation. It does not include full BASIC/KERNAL/character ROMs, IEC or cartridge devices, CIA serial/TOD/CNT modes, VIC bad-line bus stealing, precise interrupt cycle placement, digi/sample playback, multi-SID banks, or analog 6581/8580 waveform/filter behavior. A tune that relies on those details should be captured with a full emulator and then converted from an equivalent register trace. These limits are especially relevant to loaders and ROM-dependent RSID software.

## JSON capture format

Each export has this top-level shape:

```json
{
  "metadata": { "magic": "PSID", "isNtsc": false, "clockFreq": 985248 },
  "frameCount": 50,
  "totalDuration": 1,
  "frames": [
    {
      "frame": 0,
      "time": 0,
      "cycles": 19704,
      "registers": [0, 0, "… 23 more bytes"],
      "voices": ["… three voice states"],
      "filter": { "cutoff": 0, "resonance": 0, "mode": 0, "vol": 0, "routing": 0 }
    }
  ]
}
```

`registers` is always the 25-byte `$D400`–`$D418` primary SID register image. Each voice exposes frequency register and Hz values, fractional MIDI pitch, gate/retrigger state, waveform/control bits, pulse width, ADSR nibbles, and the modeled envelope level. A `triggered` value indicates that gate rose within the capture interval; it is used to preserve retriggered notes even when gate remains high by the next frame.

The CLI and browser reject imports with inconsistent frame counts, malformed register arrays, out-of-range envelope values, invalid voice/filter values, invalid timing, or more than one hour of capture data. That validation protects the MIDI writer from producing malformed output.

## MIDI mapping and musical controls

The MIDI file contains a conductor track, one track per SID voice, and a Channel 10 drum track only when noise events are detected.

- Frequency maps to the nearest MIDI note plus pitch bend, with a two-semitone bend range.
- Gate/retrigger and the selected note-duration policy determine note boundaries. Envelope peak sets velocity.
- SID noise is classified heuristically as kick, snare/tom, hat, or crash from its frequency and duration; turn this off with `--no-drums` when noise is musical rather than percussive.
- CC 11 is envelope expression; CC 7 is master volume; CC 74 is filter cutoff; CC 71 is resonance; CC 70 is pulse width. Full automation also exports ADSR, waveform, sync/ring/test bits, filter mode, and filter routing in CC 72–86.

Use `--quantize auto` for material with a stable rhythmic grid: it tests 1/8, 1/16, 1/32, 1/8-triplet, and 1/16-triplet grids and leaves loose timing unquantized when confidence is low. Use `none` for forensic playback, `--note-duration gate` for explicit gate timing, `audible` for tails, and `smart` for a practical sustain-aware compromise. `--arps-to-chords` turns fast repeated tonal fragments into chords heuristically; leave it off for chip-style arpeggios you want to preserve.

## Recommended workflows

For inspection, run `sid-json inspect tune.sid`, capture with `sid-json sid-to-json tune.sid --seconds 180`, and inspect the JSON. For a musical draft, use `sid-json sid-to-midi tune.sid --quantize auto --note-duration smart -o tune.mid`. For a DAW that needs exact register timing, export JSON and use your own mapping rather than MIDI quantization. Run `sid-json validate-json dump.json` before batch MIDI conversion.
