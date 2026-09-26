export interface SidHeader {
  magic: string;
  version: number;
  dataOffset: number;
  loadAddress: number;
  initAddress: number;
  playAddress: number;
  songs: number;
  startSong: number;
  speed: number;
  title: string;
  author: string;
  released: string;
  flags: number;
  isNtsc: boolean;
  clockFreq: number;
}

export interface SidVoiceStatus {
  freqReg: number;
  freqHz: number;
  midiNote: number; // Float note value (e.g. 60.5)
  pitchBend: number; // Deviation from nearest semitone (-0.5 to 0.5)
  envelope: number; // 0.0 - 1.0
  gate: boolean;
  waveform: number; // Nibble (0-15)
  rawWaveform: number; // Full byte (for noise/combined detection)
  pulse: number;
  attack: number;
  decay: number;
  sustain: number;
  release: number;
  sync: boolean;
  ringMod: boolean;
  test: boolean;
  triggered: boolean;
  state: 'attack' | 'decay' | 'sustain' | 'release';
}

export interface SidFilterStatus {
  cutoff: number;
  resonance: number;
  mode: number; // Low, Band, High, Off
  vol: number;
  on: boolean; // Filter active?
  routing: number; // Bits 0-2 (Voice 1, 2, 3) + Bit 3 (Ext)
}

export interface SidDumpFrame {
  frame: number;
  time: number; // Seconds
  cycles: number; // CPU cycles executed in this frame
  registers: number[]; // Array of 25 bytes (0xD400 - 0xD418)
  // High fidelity state captured from SID emulation
  voices: [SidVoiceStatus, SidVoiceStatus, SidVoiceStatus];
  filter: SidFilterStatus;
}

export interface SidDump {
  metadata: SidHeader;
  frames: SidDumpFrame[];
  totalDuration: number;
  frameCount: number;
}

/**
 * Reject JSON that cannot safely be interpreted as a capture produced by this
 * application. Keeping this at the data boundary prevents malformed uploads
 * from becoming invalid MIDI bytes or hard-to-diagnose UI failures.
 */
export function assertCompatibleSidDump(value: unknown): asserts value is SidDump {
  if (!value || typeof value !== 'object') throw new Error('Invalid JSON: expected a SID dump object');
  const dump = value as Partial<SidDump>;
  if (!dump.metadata || (dump.metadata.magic !== 'PSID' && dump.metadata.magic !== 'RSID') || !Array.isArray(dump.frames)) {
    throw new Error('Invalid JSON: compatible SID metadata and frames are required');
  }
  if (!Number.isInteger(dump.frameCount) || dump.frameCount !== dump.frames.length || !Number.isFinite(dump.totalDuration) || dump.totalDuration < 0) {
    throw new Error('Invalid JSON: capture frame count or duration is inconsistent');
  }
  // The capture limit is one hour at NTSC rate; reject pathological imports early.
  if (dump.frames.length > 216000) throw new Error('Invalid JSON: capture exceeds the supported one-hour limit');

  for (const [index, frame] of dump.frames.entries()) {
    const validRegisters = Array.isArray(frame.registers) && frame.registers.length === 25 && frame.registers.every((entry) => Number.isInteger(entry) && entry >= 0 && entry <= 255);
    const validVoices = Array.isArray(frame.voices) && frame.voices.length === 3 && frame.voices.every((voice) =>
      voice && typeof voice === 'object' && Number.isFinite(voice.freqReg) && Number.isFinite(voice.freqHz) &&
      Number.isFinite(voice.midiNote) && Number.isFinite(voice.envelope) && voice.envelope >= 0 && voice.envelope <= 1 &&
      typeof voice.gate === 'boolean' && typeof voice.triggered === 'boolean');
    const validFilter = frame.filter && typeof frame.filter === 'object' && Number.isFinite(frame.filter.cutoff) &&
      Number.isFinite(frame.filter.resonance) && Number.isFinite(frame.filter.mode) && Number.isFinite(frame.filter.vol);
    if (!Number.isInteger(frame.frame) || frame.frame !== index || !Number.isFinite(frame.time) || frame.time < 0 || !Number.isFinite(frame.cycles) || frame.cycles < 0 || !validRegisters || !validVoices || !validFilter) {
      throw new Error(`Invalid JSON: frame ${index} is not a compatible SID capture`);
    }
  }
}
