import { Bus, Cpu6502 } from './Cpu6502';
import { SidChip } from './SidChip';
import { SystemLogger } from '../Logger';

// CIA (Complex Interface Adapter) 6526
class Cia6526 {
  // Registers
  public pra = 0; // Port A
  public prb = 0; // Port B
  public ddra = 0; // Data Direction A
  public ddrb = 0; // Data Direction B
  public taLo = 0; // Timer A Low
  public taHi = 0; // Timer A High
  public tbLo = 0; // Timer B Low
  public tbHi = 0; // Timer B High
  public tod10 = 0;
  public todSec = 0;
  public todMin = 0;
  public todHr = 0;
  public sdr = 0;
  public icr = 0; // Interrupt Control
  public cra = 0; // Control A
  public crb = 0; // Control B

  // Internal State
  private timerA = 0;
  private timerB = 0;
  private latchA = 0;
  private latchB = 0;
  private icrMask = 0; // Mask for interrupts
  private irqPending = false;
  private name: string;

  constructor(name: string) {
      this.name = name;
  }

  public reset() {
    this.pra = 0; this.prb = 0; this.ddra = 0; this.ddrb = 0;
    this.taLo = 0; this.taHi = 0; this.tbLo = 0; this.tbHi = 0;
    this.timerA = 0xFFFF; this.timerB = 0xFFFF;
    this.latchA = 0xFFFF; this.latchB = 0xFFFF;
    this.icr = 0; this.icrMask = 0;
    this.cra = 0; this.crb = 0;
    this.irqPending = false;
    SystemLogger.log(this.name, 'Reset complete', 'debug');
  }

  // Count down timers
  public step(cycles: number): boolean {
    let irqTriggered = false;

    // Timer A
    if (this.cra & 0x01) { // Start bit
      let underflow = false;
      this.timerA -= cycles;
      if (this.timerA <= 0) {
        underflow = true;
        this.timerA += this.latchA; // Reload
      }

      if (underflow) {
        if (this.cra & 0x08) this.cra &= ~0x01; // One-shot
        if (this.icrMask & 0x01) { // Interrupt enabled
          this.icr |= 0x01;
          this.irqPending = true;
          irqTriggered = true;
          // SystemLogger.log(this.name, 'Timer A Underflow -> IRQ', 'debug'); // Disabled
        }
      }
    }

    // Timer B (Simplified - assumes CNT counting Phi2)
    if (this.crb & 0x01) {
       let underflow = false;
       this.timerB -= cycles;
       if (this.timerB <= 0) {
         underflow = true;
         this.timerB += this.latchB;
       }
       if (underflow) {
         if (this.crb & 0x08) this.crb &= ~0x01;
         if (this.icrMask & 0x02) {
           this.icr |= 0x02;
           this.irqPending = true;
           irqTriggered = true;
           // SystemLogger.log(this.name, 'Timer B Underflow -> IRQ', 'debug'); // Disabled
         }
       }
    }

    return irqTriggered;
  }

  public read(reg: number): number {
    switch(reg & 0x0F) {
      case 0x00: return this.pra;
      case 0x01: return this.prb;
      case 0x02: return this.ddra;
      case 0x03: return this.ddrb;
      case 0x04: return this.timerA & 0xFF;
      case 0x05: return (this.timerA >> 8) & 0xFF;
      case 0x06: return this.timerB & 0xFF;
      case 0x07: return (this.timerB >> 8) & 0xFF;
      case 0x0D: // Read clears interrupts
        const val = this.icr | (this.irqPending ? 0x80 : 0);
        this.icr = 0;
        this.irqPending = false;
        return val;
      case 0x0E: return this.cra;
      case 0x0F: return this.crb;
      default: return 0;
    }
  }

  public write(reg: number, val: number) {
    switch(reg & 0x0F) {
      case 0x00: this.pra = val; break;
      case 0x01: this.prb = val; break;
      case 0x02: this.ddra = val; break;
      case 0x03: this.ddrb = val; break;
      case 0x04: this.latchA = (this.latchA & 0xFF00) | val; break;
      case 0x05:
        this.latchA = (this.latchA & 0x00FF) | (val << 8);
        if ((this.cra & 0x01) === 0) this.timerA = this.latchA; // Load if stopped
        break;
      case 0x06: this.latchB = (this.latchB & 0xFF00) | val; break;
      case 0x07:
        this.latchB = (this.latchB & 0x00FF) | (val << 8);
        if ((this.crb & 0x01) === 0) this.timerB = this.latchB;
        break;
      case 0x0D:
        if (val & 0x80) { // Set bits
          this.icrMask |= (val & 0x7F);
        } else { // Clear bits
          this.icrMask &= ~(val & 0x7F);
        }
        break;
      case 0x0E:
        this.cra = val;
        if (val & 0x10) this.timerA = this.latchA; // Force load
        break;
      case 0x0F:
        this.crb = val;
        if (val & 0x10) this.timerB = this.latchB;
        break;
    }
  }
}

// VIC-II (Video Interface Chip)
class VicII {
    // Only implemented for Raster Interrupt Timing
    public rasterLine = 0;
    public rasterIrqLine = 0;
    public irqEnabled = 0;
    public irqStatus = 0;
    public cyclesPerLine = 63; // PAL default
    public linesPerFrame = 312; // PAL default
    public cycleCounter = 0;

    public reset(isNtsc: boolean) {
        this.cyclesPerLine = isNtsc ? 65 : 63;
        this.linesPerFrame = isNtsc ? 263 : 312;
        this.rasterLine = 0;
        this.cycleCounter = 0;
        this.irqStatus = 0;
        this.irqEnabled = 0;
        SystemLogger.log('VIC-II', `Reset (Standard: ${isNtsc ? 'NTSC' : 'PAL'})`, 'info');
    }

    public step(cycles: number): boolean {
        this.cycleCounter += cycles;
        let irq = false;

        while (this.cycleCounter >= this.cyclesPerLine) {
            this.cycleCounter -= this.cyclesPerLine;
            this.rasterLine++;
            if (this.rasterLine >= this.linesPerFrame) {
                this.rasterLine = 0;
            }

            // Check Raster IRQ (simplified 8-bit check, real is 9-bit)
            if (this.rasterLine === this.rasterIrqLine) {
                if (this.irqEnabled & 0x01) {
                    this.irqStatus |= 0x81; // Set IRQ bit + Any IRQ bit
                    irq = true;
                    // SystemLogger.log('VIC-II', `Raster IRQ triggered at line ${this.rasterLine}`, 'debug'); // Disabled
                }
            }
        }
        return irq;
    }

    public read(reg: number): number {
        switch(reg) {
            case 0x11: return (this.rasterLine & 0x100) >> 1; // Bit 7 is bit 8 of raster
            case 0x12: return this.rasterLine & 0xFF;
            case 0x19: return this.irqStatus | 0x70;
            case 0x1A: return this.irqEnabled | 0xF0;
            default: return 0;
        }
    }

    public write(reg: number, val: number) {
        switch(reg) {
            case 0x11:
                this.rasterIrqLine = (this.rasterIrqLine & 0xFF) | ((val & 0x80) << 1);
                break;
            case 0x12:
                this.rasterIrqLine = (this.rasterIrqLine & 0x100) | val;
                break;
            case 0x19:
                // Acknowledge interrupts by writing 1s
                this.irqStatus &= ~(val & 0x0F);
                if ((this.irqStatus & 0x0F) === 0) this.irqStatus &= ~0x80;
                break;
            case 0x1A:
                this.irqEnabled = val & 0x0F;
                // SystemLogger.log('VIC-II', `IRQ Enable Mask: $${this.irqEnabled.toString(16)}`, 'debug');
                break;
        }
    }
}


export class C64System implements Bus {
  public ram: Uint8Array;
  public cpu: Cpu6502;
  public sid: SidChip;
  public cia1: Cia6526;
  public cia2: Cia6526;
  public vic: VicII;

  // PLA State ($01)
  private ddr = 0x2F; // $00 Data Direction
  private port = 0x37; // $01 Port

  constructor() {
    this.ram = new Uint8Array(65536);
    this.cpu = new Cpu6502(this);
    this.sid = new SidChip(985248); // Clock set later
    this.cia1 = new Cia6526('CIA1');
    this.cia2 = new Cia6526('CIA2');
    this.vic = new VicII();
  }

  public init(isNtsc: boolean, clockFreq: number) {
    this.ram.fill(0);
    this.cpu.reset();
    this.sid = new SidChip(clockFreq);
    this.cia1.reset();
    this.cia2.reset();
    this.vic.reset(isNtsc);

    // Default PLA
    this.ddr = 0;
    this.port = 0x37;

    // Install Default Vectors for stability (in case no ROMs)
    this.ram[0xFFFA] = 0x00; this.ram[0xFFFB] = 0xFE; // NMI
    this.ram[0xFFFC] = 0x00; this.ram[0xFFFD] = 0xE0; // RESET
    this.ram[0xFFFE] = 0x48; this.ram[0xFFFF] = 0xFF; // IRQ

    // Install a dummy IRQ handler at $FF48 that acknowledges CIA/VIC
    const dummyIrq = [0x48, 0x8A, 0x48, 0x98, 0x48, 0xAD, 0x19, 0xD0, 0x8D, 0x19, 0xD0, 0x68, 0xA8, 0x68, 0xAA, 0x68, 0x40];
    for(let i=0; i<dummyIrq.length; i++) this.ram[0xFF48 + i] = dummyIrq[i];

    SystemLogger.clear();
    SystemLogger.log('System', 'C64 Power On Sequence Complete', 'info');
  }

  public step() {
    // 1. Run CPU
    const prevCycles = this.cpu.cycles;
    this.cpu.execute(1);
    const delta = this.cpu.cycles - prevCycles;

    // 2. Step Peripherals
    const c1Irq = this.cia1.step(delta);
    const c2Irq = this.cia2.step(delta);
    const vicIrq = this.vic.step(delta);

    // 3. Trigger Interrupts
    if (c1Irq || vicIrq) {
        this.cpu.irq();
    }
    if (c2Irq) {
        this.cpu.nmi();
    }

    // 4. Update SID
    this.sid.update(delta, this.ram.subarray(0xD400, 0xD419));
  }

  public read(addr: number): number {
    addr &= 0xFFFF;

    // Memory Banking Logic via PLA ($01)
    const loram = this.port & 1;
    const hiram = this.port & 2;
    const charen = this.port & 4;

    // BASIC ROM ($A000-$BFFF)
    if (addr >= 0xA000 && addr <= 0xBFFF) {
        if (hiram && loram) {
            return 0xFF;
        }
        return this.ram[addr]; // RAM
    }

    // I/O Area vs Char ROM ($D000-$DFFF)
    if (addr >= 0xD000 && addr <= 0xDFFF) {
        if (hiram || loram) {
            if (charen) {
                // I/O Active
                // VIC-II
                if (addr >= 0xD000 && addr <= 0xD02E) return this.vic.read(addr & 0x3F);
                // SID
                if (addr >= 0xD400 && addr <= 0xD7FF) return this.ram[addr]; // Shadow read
                // CIA 1
                if (addr >= 0xDC00 && addr <= 0xDCFF) return this.cia1.read(addr);
                // CIA 2
                if (addr >= 0xDD00 && addr <= 0xDDFF) return this.cia2.read(addr);

                return 0xFF; // Unmapped I/O
            } else {
                // Char ROM Active
                return 0xFF; // Dummy ROM
            }
        }
        return this.ram[addr]; // RAM
    }

    // KERNAL ROM ($E000-$FFFF)
    if (addr >= 0xE000 && addr <= 0xFFFF) {
        if (hiram) {
             return 0xFF;
        }
        return this.ram[addr]; // RAM
    }

    // Zero Page Ports
    if (addr === 0x00) return this.ddr;
    if (addr === 0x01) return this.port;

    return this.ram[addr];
  }

  public write(addr: number, val: number): void {
    addr &= 0xFFFF;
    val &= 0xFF;

    const loram = this.port & 1;
    const hiram = this.port & 2;
    const charen = this.port & 4;

    // I/O Area Writing
    if (addr >= 0xD000 && addr <= 0xDFFF) {
         if ((hiram || loram) && charen) {
             // I/O Mapped
            if (addr >= 0xD000 && addr <= 0xD02E) {
                this.vic.write(addr & 0x3F, val);
                return;
            }
            if (addr >= 0xD400 && addr <= 0xD7FF) {
                this.ram[addr] = val;
                return;
            }
            if (addr >= 0xDC00 && addr <= 0xDCFF) {
                this.cia1.write(addr, val);
                return;
            }
            if (addr >= 0xDD00 && addr <= 0xDDFF) {
                this.cia2.write(addr, val);
                return;
            }
         }
         // If Not I/O, it falls through to RAM write
    }

    // Zero Page
    if (addr === 0x00) {
        this.ddr = val;
        // SystemLogger.log('System', `DDR Update: $${val.toString(16)}`, 'debug');
        return;
    }
    if (addr === 0x01) {
        const oldPort = this.port;
        this.port = (this.port & ~this.ddr) | (val & this.ddr);
        if (oldPort !== this.port) {
            // SystemLogger.log('System', `Bank Switch: $${oldPort.toString(16)} -> $${this.port.toString(16)}`, 'info');
        }
        return;
    }

    this.ram[addr] = val;
  }
}