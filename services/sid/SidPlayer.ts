import { parseSidHeader } from './SidParser';
import { SidDump, SidDumpFrame, SidHeader } from './SidTypes';
import { C64System } from './C64System';
import { SystemLogger } from '../Logger';

export class SidPlayer {
  private c64: C64System;

  constructor() {
    this.c64 = new C64System();
  }

  public convertToJSON(fileData: ArrayBuffer, durationSecs: number = 60, songNum: number = 1): SidDump {
    const { header, sidData } = parseSidHeader(fileData);
    if (!Number.isFinite(durationSecs) || durationSecs <= 0 || durationSecs > 3600) {
      throw new Error('Duration must be a finite value between 1 second and 3600 seconds');
    }
    if (!Number.isInteger(songNum) || songNum < 1 || songNum > header.songs) {
      throw new Error(`Subtune must be an integer in the range 1..${header.songs}`);
    }

    SystemLogger.log('Player', `Loading ${header.title}...`);
    this.c64.init(header.isNtsc, header.clockFreq);

    // Load SID Data
    for (let i = 0; i < sidData.length; i++) {
      if (header.loadAddress + i < 65536) {
        this.c64.ram[header.loadAddress + i] = sidData[i];
      }
    }

    // Setup Init Call
    const initAddr = header.initAddress === 0 ? header.loadAddress : header.initAddress;
    this.c64.cpu.a = songNum - 1;
    this.c64.cpu.x = 0;
    this.c64.cpu.y = 0;
    this.c64.cpu.pc = initAddr;

    // Trap RTS (return from init) by putting 0xFFFF on stack
    this.c64.cpu.sp = 0xFD;
    this.c64.ram[0x01FF] = 0xFF;
    this.c64.ram[0x01FE] = 0xFE;

    // Run Init
    SystemLogger.log('Player', `Executing Init at $${initAddr.toString(16)}...`);
    this.c64.cpu.execute(2000000, 0xFFFF);
    if (this.c64.cpu.pc !== 0xFFFF) {
      throw new Error('SID init did not return within the execution budget');
    }
    SystemLogger.log('Player', 'Init Complete. Starting Playback...');

    const frames: SidDumpFrame[] = [];
    const refreshRate = header.isNtsc ? 60 : 50;
    const cyclesPerFrame = Math.floor(header.clockFreq / refreshRate);
    const totalFrames = Math.floor(durationSecs * refreshRate);

    let isPsidStyle = header.magic === 'PSID' && header.playAddress !== 0;
    const irqVec = this.c64.ram[0xFFFE] | (this.c64.ram[0xFFFF] << 8);
    if (!isPsidStyle || irqVec !== 0xFF48) {
        isPsidStyle = false;
        SystemLogger.log('Player', 'Detected RSID/IRQ driver mode', 'info');
    }

    const playAddr = header.playAddress;
    let silenceFrameCount = 0;
    const silenceThresholdFrames = 3 * refreshRate; // 3 seconds of silence to stop

    for (let f = 0; f < totalFrames; f++) {
        const startCycles = this.c64.cpu.cycles;
        let frameCycles = 0;

        if (isPsidStyle) {
            this.c64.cpu.sp = 0xFD;
            this.c64.ram[0x01FF] = 0xFF;
            this.c64.ram[0x01FE] = 0xFE;
            this.c64.cpu.pc = playAddr;

            while (this.c64.cpu.pc !== 0xFFFF && frameCycles < cyclesPerFrame) {
                this.c64.step();
                frameCycles = this.c64.cpu.cycles - startCycles;
            }
            if (this.c64.cpu.pc !== 0xFFFF) {
                throw new Error(`SID play routine exceeded its ${cyclesPerFrame}-cycle frame budget`);
            }
            this.c64.advancePeripherals(cyclesPerFrame - frameCycles, false);
            frameCycles = cyclesPerFrame;
        }
        else {
            while (frameCycles < cyclesPerFrame) {
                this.c64.step();
                frameCycles = this.c64.cpu.cycles - startCycles;
            }
        }

        const snapshot = this.c64.sid.getSnapshot();
        const regsArray: number[] = [];
        for(let i=0; i<=0x18; i++) regsArray.push(this.c64.ram[0xD400 + i]);

        // Auto-Silence Detection
        const maxEnv = Math.max(
            snapshot.voices[0].envelope,
            snapshot.voices[1].envelope,
            snapshot.voices[2].envelope
        );

        if (maxEnv < 0.001) {
            silenceFrameCount++;
        } else {
            silenceFrameCount = 0;
        }

        if (silenceFrameCount > silenceThresholdFrames) {
            SystemLogger.log('Player', `Auto-stop: Detected ${silenceThresholdFrames/refreshRate}s of silence.`, 'warn');
            break;
        }

        frames.push({
            frame: f,
            time: f / refreshRate,
            cycles: frameCycles,
            registers: regsArray,
            voices: snapshot.voices,
            filter: snapshot.filter
        });
    }

    return {
        metadata: header,
        frames: frames,
        totalDuration: frames.length / refreshRate,
        frameCount: frames.length
    };
  }
}
