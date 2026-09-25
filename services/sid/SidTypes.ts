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
