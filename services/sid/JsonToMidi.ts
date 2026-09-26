
import { SidDump } from './SidTypes';

// MIDI Constants
const TPQ = 480; // Ticks per Quarter note
const BPM = 120;
const TICKS_PER_SEC = (BPM * TPQ) / 60; // 960

export interface MidiConversionOptions {
    quantize?: 'none' | 'auto' | '1/32' | '1/16' | '1/16T' | '1/8' | '1/8T' | '1/4';
    useExpression?: boolean;
    fullAutomation?: boolean;
    mergeGaps?: boolean;
    minNoteFrames?: number;
    octaveShift?: number; // 0 for auto, or explicit
    detectDrums?: boolean;
    noteDuration?: 'gate' | 'audible' | 'smart';
    convertArpsToChords?: boolean;
}

// Helpers for binary writing
class MidiWriter {
  private chunks: Uint8Array[] = [];

  writeStr(str: string) {
    const arr = new Uint8Array(str.length);
    for (let i = 0; i < str.length; i++) arr[i] = str.charCodeAt(i);
    this.chunks.push(arr);
  }

  writeU32(val: number) {
    const arr = new Uint8Array(4);
    arr[0] = (val >>> 24) & 0xFF;
    arr[1] = (val >>> 16) & 0xFF;
    arr[2] = (val >>> 8) & 0xFF;
    arr[3] = val & 0xFF;
    this.chunks.push(arr);
  }

  writeU16(val: number) {
    const arr = new Uint8Array(2);
    arr[0] = (val >>> 8) & 0xFF;
    arr[1] = val & 0xFF;
    this.chunks.push(arr);
  }

  writeBytes(bytes: number[]) {
    this.chunks.push(new Uint8Array(bytes));
  }

  writeVarInt(value: number) {
    let buffer: number[] = [];
    let v = Number.isFinite(value) ? Math.round(value) : 0;
    v = Math.max(0, Math.min(0x0FFFFFFF, v));
    buffer.push(v & 0x7F);
    while ((v >>>= 7) > 0) {
        buffer.push((v & 0x7F) | 0x80);
    }
    this.writeBytes(buffer.reverse());
  }

  writeTextMeta(type: number, text: string) {
    const payload = new TextEncoder().encode(text);
    this.writeBytes([0xFF, type & 0x7F]);
    this.writeVarInt(payload.length);
    this.chunks.push(payload);
  }

  toBytes(): Uint8Array {
    let size = 0;
    for (const c of this.chunks) size += c.length;
    const res = new Uint8Array(size);
    let offset = 0;
    for (const c of this.chunks) {
      res.set(c, offset);
      offset += c.length;
    }
    return res;
  }
}

// Helper for smoothing data streams (Sliding Window Average)
class ValueSmoother {
    private buffer: number[] = [];
    private readonly size: number;

    constructor(size: number = 3) {
        this.size = size;
    }

    process(value: number): number {
        this.buffer.push(value);
        if (this.buffer.length > this.size) this.buffer.shift();

        let sum = 0;
        for (const v of this.buffer) sum += v;
        return sum / this.buffer.length;
    }

    reset() {
        this.buffer = [];
    }
}

interface NoteSegment {
  startFrame: number;
  endFrame: number;
  note: number; // Integer MIDI note
  midiNoteFloat: number; // Avg float note for pitch bend
  velocity: number;
  maxEnvelope: number;
  isNoise: boolean;
  waveform: number; // Waveform nibble (Timbre)
  chordNotes?: number[]; // For Arpeggio chords
  avgFreq: number; // For drum mapping
}

// Helper to track and emit CC changes
class AutomationTrack {
    private events: { tick: number; type: string; data: number[]; priority: number }[] = [];
    private lastValues = new Map<number, number>();
    private channel: number;

    constructor(channel: number, eventsArray: any[]) {
        this.channel = channel;
        this.events = eventsArray;
    }

    public setCC(tick: number, cc: number, value: number) {
        value = Math.max(0, Math.min(127, Math.floor(value)));
        // Deduplicate: Only add event if value changed from last time
        if (this.lastValues.get(cc) !== value) {
            this.events.push({
                tick,
                type: 'cc',
                priority: 1,
                data: [0xB0 | this.channel, cc, value]
            });
            this.lastValues.set(cc, value);
        }
    }
}

interface MidiEvent { tick: number; type: string; data: number[], priority: number }

export class JsonToMidiConverter {

  public convert(dump: SidDump, options: MidiConversionOptions = {}): Uint8Array {
    const writer = new MidiWriter();

    // Header
    writer.writeStr("MThd");
    writer.writeU32(6);
    writer.writeU16(1);
    // Number of tracks: Conductor + 3 Voices + 1 Drum Track (Potential)
    // We calculate exact number later but MThd usually needs it upfront.
    // We will assume 1 Conductor + 3 Voice Tracks + 1 Drum Track = 5 max.
    // However, some players might be picky if we declare 5 but write 4.
    // For simplicity, we write tracks to buffers first, then compose file.
    // Update: We'll construct the file dynamically.
    // Let's write a placeholder for track count or just follow logic.
    // MIDI Format 1 allows any number of tracks.
    // We will build track buffers and then write header with correct count.

    const trackBuffers: Uint8Array[] = [];

    // Conductor Track (Tempo, Time Sig, Meta)
    const trk0 = new MidiWriter();
    trk0.writeVarInt(0);
    trk0.writeBytes([0xFF, 0x58, 0x04, 0x04, 0x02, 0x18, 0x08]); // 4/4 Time Sig
    trk0.writeVarInt(0);
    trk0.writeBytes([0xFF, 0x51, 0x03, 0x07, 0xA1, 0x20]); // 120 BPM (07 A1 20 = 500,000us)
    const title = dump.metadata?.title || "SID Export";
    trk0.writeVarInt(0);
    trk0.writeTextMeta(0x03, title);
    trk0.writeVarInt(0);
    trk0.writeBytes([0xFF, 0x2F, 0x00]); // End of Track
    trackBuffers.push(trk0.toBytes());

    const fps = dump.metadata?.isNtsc ? 60 : 50;
    const ticksPerFrame = TICKS_PER_SEC / fps;

    // --- Auto-Detection Logic ---
    let gridTicks = 1;
    let effectiveQuantize = options.quantize || 'none';

    if (effectiveQuantize === 'auto') {
        effectiveQuantize = this.detectBestQuantization(dump, fps);
    }

    if (effectiveQuantize === '1/4') gridTicks = TPQ;
    else if (effectiveQuantize === '1/8') gridTicks = TPQ / 2;
    else if (effectiveQuantize === '1/8T') gridTicks = TPQ / 3;
    else if (effectiveQuantize === '1/16') gridTicks = TPQ / 4;
    else if (effectiveQuantize === '1/16T') gridTicks = TPQ / 6;
    else if (effectiveQuantize === '1/32') gridTicks = TPQ / 8;

    let effectiveShift = options.octaveShift !== undefined ? options.octaveShift : 0;

    const frameCount = dump.frames ? dump.frames.length : 0;
    const opts: Required<MidiConversionOptions> = {
        useExpression: true,
        fullAutomation: true,
        mergeGaps: true,
        minNoteFrames: 1,
        octaveShift: effectiveShift,
        detectDrums: true,
        noteDuration: 'smart',
        convertArpsToChords: false,
        ...options,
        quantize: effectiveQuantize as any
    };

    const drumEvents: MidiEvent[] = [];

    // Generate Tracks for Voices 1-3
    for (let v = 0; v < 3; v++) {
      const trk = new MidiWriter();
      const channel = v;

      const vName = `Voice ${v + 1}`;
      trk.writeVarInt(0);
      trk.writeTextMeta(0x03, vName);

      // 1. Analyze Voice -> Segments
      let segments = this.analyzeVoice(dump, v, opts);

      // 2. Post-Process: Merge Gaps
      if (opts.mergeGaps) {
          segments = this.mergeSegments(segments, 2);
      }

      // 3. Post-Process: Detect Arpeggios -> Chords
      if (opts.convertArpsToChords) {
          segments = this.detectArpeggios(segments, fps);
      }

      // Event List
      const events: MidiEvent[] = [
          // RPN Pitch Bend Range (+/- 2 Semitones)
          { tick: 0, type: 'cc', priority: 1, data: [0xB0 | channel, 101, 0] },
          { tick: 0, type: 'cc', priority: 1, data: [0xB0 | channel, 100, 0] },
          { tick: 0, type: 'cc', priority: 1, data: [0xB0 | channel, 6, 2] },
          // RPN Fine Tuning (+/- 0 Semitones center)
          { tick: 0, type: 'cc', priority: 1, data: [0xB0 | channel, 101, 0] },
          { tick: 0, type: 'cc', priority: 1, data: [0xB0 | channel, 100, 1] },
          { tick: 0, type: 'cc', priority: 1, data: [0xB0 | channel, 6, 64] }, // Center (64)
          { tick: 0, type: 'cc', priority: 1, data: [0xB0 | channel, 38, 0] },
          // Reset RPN
          { tick: 0, type: 'cc', priority: 1, data: [0xB0 | channel, 101, 127] },
          { tick: 0, type: 'cc', priority: 1, data: [0xB0 | channel, 100, 127] }
      ];

      const automation = new AutomationTrack(channel, events);

      segments.forEach(seg => {
        let startTick = Math.round(seg.startFrame * ticksPerFrame);
        let endTick = Math.round(seg.endFrame * ticksPerFrame);

        // Apply Quantization
        if (opts.quantize !== 'none') {
            startTick = Math.round(startTick / gridTicks) * gridTicks;
            endTick = Math.round(endTick / gridTicks) * gridTicks;
            if (endTick <= startTick) endTick = startTick + gridTicks;
        }

        const velocity = Math.min(127, Math.max(1, Math.floor(seg.maxEnvelope * 127)));

        if (seg.isNoise && opts.detectDrums) {
            // Collect Drum Event
            const drumNote = this.classifyDrum(seg, fps);
            const drumCh = 9; // Channel 10 (0-indexed)

            // Add to dedicated drum list
            drumEvents.push({ tick: startTick, type: 'on', priority: 3, data: [0x90 | drumCh, drumNote, velocity] });
            drumEvents.push({ tick: endTick, type: 'off', priority: 0, data: [0x80 | drumCh, drumNote, 0] });

        } else if (seg.chordNotes) {
            // Arpeggio Chord Mode
            const shift = opts.octaveShift * 12;
            seg.chordNotes.forEach(note => {
                const midiNote = Math.max(0, Math.min(127, note + shift));
                events.push({ tick: startTick, type: 'on', priority: 3, data: [0x90 | channel, midiNote, velocity] });
                events.push({ tick: endTick, type: 'off', priority: 0, data: [0x80 | channel, midiNote, 0] });
            });
        } else {
            // Melodic Mode
            const noteInt = seg.note;
            const diff = seg.midiNoteFloat - noteInt;

            let initialBend = 8192; // Center

            if (Math.abs(diff) > 0.001) {
                 // Map +/- 1.0 semitone to +/- 4096 bend units (assuming 2 semitone range)
                 initialBend = Math.round(8192 + (diff * 4096));
                 initialBend = Math.max(0, Math.min(16383, initialBend));
            }

            events.push({
                tick: startTick,
                type: 'bend',
                priority: 2,
                data: [0xE0 | channel, initialBend & 0x7F, (initialBend >>> 7) & 0x7F]
            });

            // Dynamic Bend (Slides) with Smoothing
            const bendStep = 2; // Output event resolution
            const pitchSmoother = new ValueSmoother(4); // Window size 4 frames (~80ms @ 50Hz)

            // Iterate all frames to feed smoother, but only output every bendStep
            for (let f = seg.startFrame; f < seg.endFrame; f++) {
                if (f >= frameCount) break;
                const frame = dump.frames[f];
                const vState = frame.voices[v];

                // If voice drops out (0), hold last known pitch or segment note
                let currentMidiNote = vState.midiNote;
                if (currentMidiNote <= 0) currentMidiNote = seg.note;

                const smoothedMidiNote = pitchSmoother.process(currentMidiNote);

                // Emit event
                if (f > seg.startFrame && (f % bendStep === 0)) {
                    const d = smoothedMidiNote - seg.note;
                    if (Math.abs(d) < 2) { // Only bend if within range (+/- 2 semitones)
                         let b = Math.round(8192 + (d * 4096));
                         b = Math.max(0, Math.min(16383, b));
                         const t = Math.round(f * ticksPerFrame);
                         if (t > startTick && t < endTick) {
                            events.push({ tick: t, type: 'bend', priority: 2, data: [0xE0 | channel, b & 0x7F, (b >>> 7) & 0x7F] });
                         }
                    }
                }
            }

            // Reset Bend at end
            events.push({ tick: endTick, type: 'bend', priority: 2, data: [0xE0 | channel, 0x00, 0x40] });

            let midiNote = seg.note + (opts.octaveShift * 12);
            midiNote = Math.max(0, Math.min(127, midiNote));

            events.push({ tick: startTick, type: 'on', priority: 3, data: [0x90 | channel, midiNote, velocity] });
            events.push({ tick: endTick, type: 'off', priority: 0, data: [0x80 | channel, midiNote, 0] });
        }
      });

      // Automation Loop with Smoothing
      const automationStep = 2; // Sample every 2nd frame to save space
      const sExpr = new ValueSmoother(3);
      const sCutoff = new ValueSmoother(3);
      const sRes = new ValueSmoother(3);
      const sVol = new ValueSmoother(3);
      const sPulse = new ValueSmoother(3);

      for (let i = 0; i < frameCount; i++) {
          const frame = dump.frames[i];
          const tick = Math.round(i * ticksPerFrame);
          const vState = frame.voices[v];

          // Feed Smoothers
          const smExpr = sExpr.process(vState.envelope * 127);
          const smCutoff = sCutoff.process(frame.filter.cutoff / 16);
          const smRes = sRes.process(frame.filter.resonance * 8);
          const smVol = sVol.process(frame.filter.vol * 8);
          const smPulse = sPulse.process((vState.pulse / 4095) * 127);

          // Emit based on Step
          if (i % automationStep === 0) {
              if (opts.useExpression) automation.setCC(tick, 11, smExpr);
              automation.setCC(tick, 74, smCutoff);
              automation.setCC(tick, 71, smRes);
              automation.setCC(tick, 7, smVol);

              if (opts.fullAutomation) {
                  automation.setCC(tick, 70, smPulse);

                  // Non-smoothed Parameters (Switches/States)
                  automation.setCC(tick, 73, vState.attack * 8);
                  automation.setCC(tick, 75, vState.decay * 8);
                  automation.setCC(tick, 79, vState.sustain * 8);
                  automation.setCC(tick, 72, vState.release * 8);

                  // Extended CCs
                  automation.setCC(tick, 83, vState.waveform * 8); // Waveform Nibble
                  automation.setCC(tick, 84, vState.rawWaveform >> 4); // Full Waveform Byte
                  automation.setCC(tick, 80, vState.sync ? 127 : 0);
                  automation.setCC(tick, 81, vState.ringMod ? 127 : 0);
                  automation.setCC(tick, 82, vState.test ? 127 : 0);

                  automation.setCC(tick, 85, frame.filter.mode * 8);
                  automation.setCC(tick, 86, frame.filter.routing * 8);
              }
          }
      }

      // Sort Events
      events.sort((a, b) => {
          if (a.tick !== b.tick) return a.tick - b.tick;
          return a.priority - b.priority;
      });

      // Write Delta Times
      let lastTick = 0;
      for (const ev of events) {
        if (ev.tick < lastTick) ev.tick = lastTick;
        const delta = ev.tick - lastTick;
        trk.writeVarInt(delta);
        trk.writeBytes(ev.data);
        lastTick = ev.tick;
      }

      trk.writeVarInt(0);
      trk.writeBytes([0xFF, 0x2F, 0x00]);

      trackBuffers.push(trk.toBytes());
    }

    // Generate Drum Track if events exist
    if (drumEvents.length > 0) {
        const drumTrk = new MidiWriter();

        // Track Name
        drumTrk.writeVarInt(0);
        const dName = "Drums (Ch10)";
        drumTrk.writeTextMeta(0x03, dName);

        // Sort events
        drumEvents.sort((a, b) => {
            if (a.tick !== b.tick) return a.tick - b.tick;
            return a.priority - b.priority;
        });

        // Write events
        let lastTick = 0;
        for (const ev of drumEvents) {
            if (ev.tick < lastTick) ev.tick = lastTick;
            const delta = ev.tick - lastTick;
            drumTrk.writeVarInt(delta);
            drumTrk.writeBytes(ev.data);
            lastTick = ev.tick;
        }

        drumTrk.writeVarInt(0);
        drumTrk.writeBytes([0xFF, 0x2F, 0x00]);
        trackBuffers.push(drumTrk.toBytes());
    }

    // Build Final MIDI File
    writer.writeU16(trackBuffers.length); // Correct Track Count
    writer.writeU16(TPQ);

    trackBuffers.forEach(buf => {
        writer.writeStr("MTrk");
        writer.writeU32(buf.length);
        writer.writeBytes(Array.from(buf));
    });

    return writer.toBytes();
  }

  private classifyDrum(seg: NoteSegment, fps: number): number {
    const durSeconds = (seg.endFrame - seg.startFrame) / fps;

    // SID Noise Frequency (LFSR Clock) Logic
    // Low value (< 0x1000) = Low rumble / Kick
    // Mid value (0x1000 - 0x3000) = Snare / Tom
    // High value (> 0x3000) = Hat / Cymbal

    if (seg.avgFreq < 0x1000) {
        return 36; // Kick (Bass Drum 1)
    } else if (seg.avgFreq < 0x2500) {
        // Mid-range noise.
        if (durSeconds > 0.15) return 47; // Low-Mid Tom
        return 38; // Snare (Acoustic)
    } else if (seg.avgFreq < 0x4000) {
         return 47; // Mid-Mid Tom
    } else {
        // High frequency noise
        if (durSeconds < 0.1) return 42; // Closed Hi-Hat
        if (durSeconds < 0.3) return 46; // Open Hi-Hat
        return 49; // Crash Cymbal 1
    }
  }

  private analyzeVoice(dump: SidDump, vIdx: number, opts: Required<MidiConversionOptions>): NoteSegment[] {
    const segments: NoteSegment[] = [];
    if (!dump.frames || dump.frames.length === 0) return segments;

    const frameCount = dump.frames.length;
    let activeSegment: NoteSegment | null = null;
    let noteAccum = 0;
    let freqAccum = 0;
    let noteCount = 0;
    let wasGateHigh = false;
    let wasTriggered = false;

    for (let f = 0; f < frameCount; f++) {
        const frame = dump.frames[f];
        const v = frame.voices[vIdx];

        // "triggered" flag is captured from sub-frame emulation in SidChip
        // If true, it means Gate went Low->High sometime during this frame interval.
        // We use this to force a new note start even if Gate is currently High.
        const isTriggered = v.triggered || (v.gate && !wasGateHigh);

        const gateHigh = v.gate;
        const isNoise = (v.rawWaveform & 0x80) !== 0;
        const isTonal = !isNoise && v.waveform !== 0;
        const hasLevel = v.envelope > 0.005;

        if (activeSegment) {
            let shouldClose = false;

            // 1. New Attack (Retrigger)
            if (isTriggered) shouldClose = true;

            // 2. Waveform Change
            if (activeSegment.waveform !== v.waveform) shouldClose = true;

            // 3. Pitch Logic
            if (gateHigh && isTonal && v.midiNote > 0) {
                 const prevFrame = dump.frames[f - 1];
                 const prevNote = prevFrame.voices[vIdx].midiNote;

                 // Jump > 1 semitone
                 if (Math.abs(v.midiNote - prevNote) > 1.0) shouldClose = true;

                 // Slide > 2 semitones from start
                 if (Math.abs(v.midiNote - activeSegment.note) > 2.0) shouldClose = true;
            }

            // 4. Note End Logic
            if (opts.noteDuration === 'gate') {
                if (!gateHigh && wasGateHigh) shouldClose = true;
            } else if (opts.noteDuration === 'smart') {
                 const hasSustain = v.sustain > 0;
                 if (hasSustain) {
                     // For sustaining sounds, close when Gate drops (Key Up)
                     if (!gateHigh && wasGateHigh) shouldClose = true;
                 } else {
                     // For percussive/decay sounds, close when Envelope fades out
                     if (!hasLevel && !gateHigh) shouldClose = true;
                 }
            } else {
                // Audible Mode
                if (!hasLevel && !gateHigh) shouldClose = true;
            }

            if (shouldClose) {
                activeSegment.endFrame = f;
                activeSegment.midiNoteFloat = noteAccum / (noteCount || 1);
                activeSegment.avgFreq = freqAccum / (noteCount || 1);

                if ((activeSegment.endFrame - activeSegment.startFrame) >= opts.minNoteFrames || activeSegment.isNoise) {
                    segments.push(activeSegment);
                }
                activeSegment = null;
            }
        }

        // Start New Segment
        const validSignal = (v.midiNote > 0 || isNoise) && (gateHigh || (hasLevel && opts.noteDuration !== 'gate'));

        if (!activeSegment && validSignal) {
             activeSegment = {
                 startFrame: f,
                 endFrame: f,
                 note: Math.round(v.midiNote),
                 midiNoteFloat: v.midiNote,
                 velocity: 0,
                 maxEnvelope: v.envelope,
                 isNoise: isNoise,
                 waveform: v.waveform,
                 avgFreq: v.freqReg
             };
             noteAccum = v.midiNote;
             freqAccum = v.freqReg;
             noteCount = 1;
        } else if (activeSegment) {
            activeSegment.endFrame = f;
            if (v.envelope > activeSegment.maxEnvelope) activeSegment.maxEnvelope = v.envelope;
            noteAccum += v.midiNote;
            freqAccum += v.freqReg;
            noteCount++;
        }

        wasGateHigh = gateHigh;
        wasTriggered = isTriggered;
    }

    if (activeSegment) {
        activeSegment.endFrame = frameCount;
        activeSegment.midiNoteFloat = noteAccum / (noteCount || 1);
        activeSegment.avgFreq = freqAccum / (noteCount || 1);
        segments.push(activeSegment);
    }

    return segments;
  }

  private mergeSegments(segments: NoteSegment[], gapThreshold: number): NoteSegment[] {
      if (segments.length === 0) return segments;
      const merged: NoteSegment[] = [segments[0]];

      for (let i = 1; i < segments.length; i++) {
          const prev = merged[merged.length - 1];
          const curr = segments[i];
          const gap = curr.startFrame - prev.endFrame;

          if (gap <= gapThreshold &&
              prev.note === curr.note &&
              prev.isNoise === curr.isNoise &&
              prev.waveform === curr.waveform) {

              prev.endFrame = curr.endFrame;
              prev.maxEnvelope = Math.max(prev.maxEnvelope, curr.maxEnvelope);
          } else {
              merged.push(curr);
          }
      }
      return merged;
  }

  private detectArpeggios(segments: NoteSegment[], fps: number): NoteSegment[] {
      const output: NoteSegment[] = [];
      const MAX_CHORD_SPAN = fps / 4; // 250ms

      let i = 0;
      while (i < segments.length) {
          const seg = segments[i];
          const duration = seg.endFrame - seg.startFrame;

          if (duration > MAX_CHORD_SPAN || seg.isNoise) {
              output.push(seg);
              i++;
              continue;
          }

          const sequence: NoteSegment[] = [seg];
          let j = i + 1;

          while (j < segments.length) {
              const next = segments[j];
              const gap = next.startFrame - sequence[sequence.length-1].endFrame;
              const nextDur = next.endFrame - next.startFrame;

              if (gap < 3 && nextDur < MAX_CHORD_SPAN && !next.isNoise) {
                  sequence.push(next);
                  j++;
              } else {
                  break;
              }
          }

          if (sequence.length >= 3) {
              const uniqueNotes = Array.from(new Set(sequence.map(s => s.note))).sort((a,b) => a-b);
              // Simple heuristic: If multiple distinct notes in rapid succession, make a chord
              if (uniqueNotes.length >= 2 && uniqueNotes.length <= 5) {
                   const chordStart = sequence[0].startFrame;
                   const chordEnd = sequence[sequence.length-1].endFrame;

                   output.push({
                       startFrame: chordStart,
                       endFrame: chordEnd,
                       note: uniqueNotes[0],
                       midiNoteFloat: uniqueNotes[0],
                       maxEnvelope: Math.max(...sequence.map(s => s.maxEnvelope)),
                       velocity: 0,
                       isNoise: false,
                       waveform: sequence[0].waveform,
                       avgFreq: sequence[0].avgFreq,
                       chordNotes: uniqueNotes
                   });

                   i = j;
                   continue;
              }
          }

          output.push(seg);
          i++;
      }
      return output;
  }

  private detectBestQuantization(dump: SidDump, fps: number): '1/8' | '1/16' | '1/32' | 'none' {
      const startTimes: number[] = [];
      const ticksPerSec = TICKS_PER_SEC;

      for(let v=0; v<3; v++) {
          const opts: Required<MidiConversionOptions> = { quantize: 'none', mergeGaps: true, minNoteFrames: 1, octaveShift:0, detectDrums:true, noteDuration:'audible', convertArpsToChords:false, useExpression:false, fullAutomation:false };
          const segs = this.analyzeVoice(dump, v, opts);
          segs.forEach(s => startTimes.push((s.startFrame / fps) * ticksPerSec));
      }

      if (startTimes.length < 5) return 'none';

      const checkGrid = (gridTicks: number) => {
          let aligned = 0;
          for(const t of startTimes) {
              const remainder = t % gridTicks;
              const dist = Math.min(remainder, gridTicks - remainder);
              if (dist < (gridTicks * 0.15)) aligned++;
          }
          return aligned / startTimes.length;
      };

      const g32 = checkGrid(TPQ / 8);
      const g16 = checkGrid(TPQ / 4);
      const g8 = checkGrid(TPQ / 2);

      if (g8 > 0.75) return '1/8';
      if (g16 > 0.70) return '1/16';
      if (g32 > 0.60) return '1/32';

      return 'none';
  }
}
