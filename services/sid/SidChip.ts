
import { SidVoiceStatus, SidFilterStatus } from './SidTypes';

// ADSR rate tables (ms) - Precise MOS 6581 values
// Attack: Time to go from 0x00 to 0xFF
const ATTACK_TIMES = [2, 8, 16, 24, 38, 56, 68, 80, 100, 240, 500, 800, 1000, 3000, 5000, 8000];
// Decay/Release: Time to go from 0xFF to 0x00 (Exponential 3*tau)
const DECAY_TIMES = [6, 24, 48, 72, 114, 168, 204, 240, 300, 750, 1500, 2400, 3000, 9000, 15000, 24000];

// Simulation Granularity
// 32 steps per frame @ 50Hz = 1600Hz update rate (~0.625ms resolution).
// Sufficient to capture the fastest attack (2ms).
const STEPS_PER_FRAME = 32;

interface VoiceInternal {
  freqLo: number;
  freqHi: number;
  freq: number;
  pulseLo: number;
  pulseHi: number;
  pulse: number;
  control: number;
  attack: number;
  decay: number;
  sustain: number;
  release: number;
  gate: boolean;
  test: boolean;
  ringMod: boolean;
  sync: boolean;
  waveform: number; // 4-bit (Tri, Saw, Pulse, Noise)
  rawWaveform: number; // 8-bit full control reg
  triggered: boolean;
  envState: 'attack' | 'decay' | 'sustain' | 'release';
  envLevel: number;
}

export class SidChip {
  private clockHz: number;
  private voices: VoiceInternal[] = [];

  // Filter state
  private filterCutoff = 0;
  private filterRes = 0;
  private filterModeLp = false;
  private filterModeBp = false;
  private filterModeHp = false;
  private filterVol = 0;
  private filterRouting = 0; // Bits 0-3 (V1, V2, V3, Ext)

  constructor(clockHz: number) {
    this.clockHz = clockHz;
    for (let i = 0; i < 3; i++) {
      this.voices.push({
        freqLo: 0, freqHi: 0, freq: 0,
        pulseLo: 0, pulseHi: 0, pulse: 0,
        control: 0,
        attack: 0, decay: 0, sustain: 0, release: 0,
        gate: false, test: false, ringMod: false, sync: false,
        waveform: 0,
        rawWaveform: 0,
        triggered: false,
        envState: 'release',
        envLevel: 0.0,
      });
    }
  }

  public reset() {
    this.voices.forEach(v => {
      v.freq = 0; v.gate = false; v.envLevel = 0; v.envState = 'release';
    });
  }

  public update(totalCycles: number, registers: Uint8Array) {
    // 1. Read Registers (Assume state at end of frame applies to whole frame for now)
    for (let i = 0; i < 3; i++) {
      const base = i * 7;
      const v = this.voices[i];

      const fLo = registers[base];
      const fHi = registers[base + 1];
      const pLo = registers[base + 2];
      const pHi = registers[base + 3];
      const ctrl = registers[base + 4];
      const ad = registers[base + 5];
      const sr = registers[base + 6];

      v.freq = (fHi << 8) | fLo;
      v.pulse = ((pHi & 0x0F) << 8) | pLo;

      const newGate = (ctrl & 0x01) !== 0;
      // Capture gate rising edges for the entire video-frame interval. The SID
      // state is updated after each CPU instruction, but JSON/MIDI consumes a
      // single frame snapshot; assigning this directly would lose a retrigger
      // as soon as the following instruction ran.
      if (newGate && !v.gate) v.triggered = true;

      // Gate State Logic
      // If Gate goes high, we transition to Attack (unless Test bit is set, which resets envelope)
      // If Gate goes low, we transition to Release
      if (newGate && !v.gate) {
           v.envState = 'attack';
      } else if (!newGate && v.gate) {
           v.envState = 'release';
      }

      v.gate = newGate;
      v.sync = (ctrl & 0x02) !== 0;
      v.ringMod = (ctrl & 0x04) !== 0;
      v.test = (ctrl & 0x08) !== 0;
      v.waveform = (ctrl >> 4) & 0x0F;
      v.rawWaveform = ctrl;
      v.control = ctrl;

      v.attack = (ad >> 4) & 0x0F;
      v.decay = ad & 0x0F;
      v.sustain = (sr >> 4) & 0x0F;
      v.release = sr & 0x0F;
    }

    // Filter
    const fCutLo = registers[0x15] & 0x07;
    const fCutHi = registers[0x16];
    this.filterCutoff = (fCutHi << 3) | fCutLo;
    this.filterRes = (registers[0x17] >> 4) & 0x0F;
    this.filterRouting = registers[0x17] & 0x0F; // Extract routing bits

    const modeVol = registers[0x18];
    this.filterModeLp = (modeVol & 0x10) !== 0;
    this.filterModeBp = (modeVol & 0x20) !== 0;
    this.filterModeHp = (modeVol & 0x40) !== 0;
    this.filterVol = modeVol & 0x0F;

    // 2. Granular Envelope Simulation
    const stepCycles = totalCycles / STEPS_PER_FRAME;
    const dt = stepCycles / this.clockHz; // Seconds per step

    for (let step = 0; step < STEPS_PER_FRAME; step++) {
        for (let i = 0; i < 3; i++) {
            const v = this.voices[i];

            // Test bit resets envelope immediately
            if (v.test) {
                v.envLevel = 0;
                v.envState = 'attack'; // Ready to attack when test cleared if gate high?
                // Actually 6581 holds zero while Test is high.
                continue;
            }

            if (v.envState === 'attack') {
                // Linear Attack
                const attackTime = ATTACK_TIMES[v.attack] / 1000.0;
                const rate = attackTime > 0 ? (1.0 / attackTime) : 10000;

                v.envLevel += rate * dt;

                if (v.envLevel >= 1.0) {
                    v.envLevel = 1.0;
                    v.envState = 'decay';
                }
            }
            else if (v.envState === 'decay') {
                // Exponential Decay to Sustain Level
                const decayTime = DECAY_TIMES[v.decay] / 1000.0;
                const susLevel = v.sustain / 15.0;

                // Hardware discharge targets Ground (0.0)
                // We model this as V_new = V_old * e^(-t/RC)
                // Divisor 3.0 approximates the 6581 time constant relation
                // (Decay time is roughly 3 tau)
                const tau = decayTime / 3.0;
                const decayFactor = tau > 0 ? Math.exp(-dt / tau) : 0;

                v.envLevel *= decayFactor;

                if (v.envLevel <= susLevel) {
                    v.envLevel = susLevel;
                    v.envState = 'sustain';
                }
            }
            else if (v.envState === 'sustain') {
                // Sustain Phase
                const target = v.sustain / 15.0;

                if (v.envLevel > target) {
                    // If register Sustain changed to be lower, we Decay down to it
                    // using the Decay rate
                    const decayTime = DECAY_TIMES[v.decay] / 1000.0;
                    const tau = decayTime / 3.0;
                    const decayFactor = tau > 0 ? Math.exp(-dt / tau) : 0;
                    v.envLevel *= decayFactor;

                    if (v.envLevel < target) v.envLevel = target;
                }
                // NOTE: If target > current level, we DO NOT charge up.
                // The hardware has no charging path in Sustain/Decay/Release phases.
                // Level holds steady.
            }
            else if (v.envState === 'release') {
                // Exponential Release to 0
                const relTime = DECAY_TIMES[v.release] / 1000.0;
                const tau = relTime / 3.0;
                const decayFactor = tau > 0 ? Math.exp(-dt / tau) : 0;

                v.envLevel *= decayFactor;

                // Hard floor to clean up float precision
                if (v.envLevel < 0.001) {
                    v.envLevel = 0;
                }
            }
        }
    }
  }

  public getSnapshot(): { voices: [SidVoiceStatus, SidVoiceStatus, SidVoiceStatus], filter: SidFilterStatus } {
    const voicesSnap = this.voices.map(v => {
       const hz = (v.freq * this.clockHz) / 16777216;
       let midi = 0;
       let pitchBend = 0;

       if (hz > 4) { // Minimum audible Hz
           // Formula: Note = 69 + 12 * log2(Hz/440)
           midi = 69 + 12 * Math.log2(hz / 440);

           // Calculate pitch bend (deviation from nearest semitone)
           pitchBend = midi - Math.round(midi);
       }

       return {
           freqReg: v.freq,
           freqHz: hz,
           midiNote: midi,
           pitchBend: pitchBend,
           envelope: Math.max(0, Math.min(1, v.envLevel)),
           gate: v.gate,
           waveform: v.waveform,
           rawWaveform: v.rawWaveform,
           pulse: v.pulse,
           attack: v.attack,
           decay: v.decay,
           sustain: v.sustain,
           release: v.release,
           sync: v.sync,
           ringMod: v.ringMod,
           test: v.test,
           triggered: v.triggered,
           state: v.envState
       };
    }) as [SidVoiceStatus, SidVoiceStatus, SidVoiceStatus];

    // `triggered` is an edge latch, consumed exactly once per capture frame.
    this.voices.forEach((voice) => { voice.triggered = false; });

    let mode = 0;
    if (this.filterModeLp) mode |= 1;
    if (this.filterModeBp) mode |= 2;
    if (this.filterModeHp) mode |= 4;

    return {
        voices: voicesSnap,
        filter: {
            cutoff: this.filterCutoff,
            resonance: this.filterRes,
            mode: mode,
            vol: this.filterVol,
            on: mode !== 0,
            routing: this.filterRouting
        }
    };
  }
}
