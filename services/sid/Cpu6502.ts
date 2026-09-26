import { SystemLogger } from '../Logger';

export interface Bus {
  read(addr: number): number;
  write(addr: number, val: number): void;
}

export class Cpu6502 {
  // Registers
  public a: number = 0;
  public x: number = 0;
  public y: number = 0;
  public sp: number = 0xff;
  public pc: number = 0;
  public flags: number = 0x20;

  // System Bus
  private bus: Bus;

  // Cycle counting
  public cycles: number = 0;

  constructor(bus: Bus) {
    this.bus = bus;
  }

  public reset() {
    this.a = 0;
    this.x = 0;
    this.y = 0;
    this.sp = 0xff;
    this.flags = 0x20;
    this.cycles = 0;
    // Load Reset Vector
    this.pc = this.read16(0xFFFC);
    SystemLogger.log('CPU', `Reset vector: $${this.pc.toString(16).toUpperCase()}`, 'info');
  }

  // Hardware Interrupts
  public irq() {
    if ((this.flags & 0x04) === 0) { // If Interrupts not disabled
      this.push((this.pc >> 8) & 0xff);
      this.push(this.pc & 0xff);
      this.push(this.flags & ~0x10); // Break flag clear
      this.flags |= 0x04; // Disable interrupts
      this.pc = this.read16(0xFFFE);
      this.cycles += 7;
    }
  }

  public nmi() {
    this.push((this.pc >> 8) & 0xff);
    this.push(this.pc & 0xff);
    this.push(this.flags & ~0x10);
    this.flags |= 0x04; // Disable interrupts
    this.pc = this.read16(0xFFFA);
    this.cycles += 7;
    // SystemLogger.log('CPU', 'NMI Triggered', 'debug'); // Disabled for performance
  }

  // Flag helpers
  private setZ(val: number) {
    if ((val & 0xff) === 0) this.flags |= 0x02;
    else this.flags &= ~0x02;
  }
  private setN(val: number) {
    if (val & 0x80) this.flags |= 0x80;
    else this.flags &= ~0x80;
  }
  private setC(val: boolean) {
    if (val) this.flags |= 0x01;
    else this.flags &= ~0x01;
  }

  // Memory Access via Bus
  private read(addr: number): number {
    return this.bus.read(addr);
  }

  private write(addr: number, val: number) {
    this.bus.write(addr, val);
  }

  public push(val: number) {
    this.write(0x0100 + this.sp, val);
    this.sp = (this.sp - 1) & 0xff;
  }

  private pop(): number {
    this.sp = (this.sp + 1) & 0xff;
    return this.read(0x0100 + this.sp);
  }

  private read16(addr: number): number {
    const lo = this.read(addr);
    const hi = this.read(addr + 1);
    return (hi << 8) | lo;
  }

  private read16Bug(addr: number): number {
    const lo = this.read(addr);
    const hiAddr = (addr & 0xff) === 0xff ? addr - 0xff : addr + 1;
    const hi = this.read(hiAddr);
    return (hi << 8) | lo;
  }

  /**
   * Executes CPU instructions.
   */
  public execute(maxCycles: number, trapAddress: number = -1): number {
    const startCycles = this.cycles;

    while ((this.cycles - startCycles) < maxCycles) {
      if (this.pc === trapAddress) {
          break;
      }

      const opAddr = this.pc;
      const opcode = this.read(opAddr);
      this.pc = (this.pc + 1) & 0xffff;

      this.cycles += 2; // Fetch
      this.stepOp(opcode);
      this.pc &= 0xffff;
    }
    return this.cycles - startCycles;
  }

  private stepOp(opcode: number) {
    let addr = 0;
    let val = 0;
    let temp = 0;

    switch (opcode) {
      case 0xA9: this.a = this.read(this.pc++); this.setZ(this.a); this.setN(this.a); break;
      case 0xA5: this.a = this.read(this.read(this.pc++)); this.setZ(this.a); this.setN(this.a); this.cycles += 1; break;
      case 0xB5: this.a = this.read((this.read(this.pc++) + this.x) & 0xff); this.setZ(this.a); this.setN(this.a); this.cycles += 2; break;
      case 0xAD: this.a = this.read(this.read16(this.pc)); this.pc += 2; this.setZ(this.a); this.setN(this.a); this.cycles += 2; break;
      case 0xBD: addr = this.read16(this.pc); this.pc += 2; this.a = this.read(addr + this.x); this.setZ(this.a); this.setN(this.a); this.cycles += 2; break;
      case 0xB9: addr = this.read16(this.pc); this.pc += 2; this.a = this.read(addr + this.y); this.setZ(this.a); this.setN(this.a); this.cycles += 2; break;
      case 0xA1: temp = (this.read(this.pc++) + this.x) & 0xff; addr = this.read(temp) | (this.read((temp + 1) & 0xff) << 8); this.a = this.read(addr); this.setZ(this.a); this.setN(this.a); this.cycles += 4; break;
      case 0xB1: temp = this.read(this.pc++); addr = (this.read(temp) | (this.read((temp + 1) & 0xff) << 8)) + this.y; this.a = this.read(addr); this.setZ(this.a); this.setN(this.a); this.cycles += 3; break;

      case 0xA2: this.x = this.read(this.pc++); this.setZ(this.x); this.setN(this.x); break;
      case 0xA6: this.x = this.read(this.read(this.pc++)); this.setZ(this.x); this.setN(this.x); this.cycles += 1; break;
      case 0xB6: this.x = this.read((this.read(this.pc++) + this.y) & 0xff); this.setZ(this.x); this.setN(this.x); this.cycles += 2; break;
      case 0xAE: this.x = this.read(this.read16(this.pc)); this.pc += 2; this.setZ(this.x); this.setN(this.x); this.cycles += 2; break;
      case 0xBE: addr = this.read16(this.pc); this.pc += 2; this.x = this.read(addr + this.y); this.setZ(this.x); this.setN(this.x); this.cycles += 2; break;

      case 0xA0: this.y = this.read(this.pc++); this.setZ(this.y); this.setN(this.y); break;
      case 0xA4: this.y = this.read(this.read(this.pc++)); this.setZ(this.y); this.setN(this.y); this.cycles += 1; break;
      case 0xB4: this.y = this.read((this.read(this.pc++) + this.x) & 0xff); this.setZ(this.y); this.setN(this.y); this.cycles += 2; break;
      case 0xAC: this.y = this.read(this.read16(this.pc)); this.pc += 2; this.setZ(this.y); this.setN(this.y); this.cycles += 2; break;
      case 0xBC: addr = this.read16(this.pc); this.pc += 2; this.y = this.read(addr + this.x); this.setZ(this.y); this.setN(this.y); this.cycles += 2; break;

      case 0x85: this.write(this.read(this.pc++), this.a); this.cycles += 1; break;
      case 0x95: this.write((this.read(this.pc++) + this.x) & 0xff, this.a); this.cycles += 2; break;
      case 0x8D: this.write(this.read16(this.pc), this.a); this.pc += 2; this.cycles += 2; break;
      case 0x9D: this.write(this.read16(this.pc) + this.x, this.a); this.pc += 2; this.cycles += 3; break;
      case 0x99: this.write(this.read16(this.pc) + this.y, this.a); this.pc += 2; this.cycles += 3; break;
      case 0x81: temp = (this.read(this.pc++) + this.x) & 0xff; addr = this.read(temp) | (this.read((temp + 1) & 0xff) << 8); this.write(addr, this.a); this.cycles += 4; break;
      case 0x91: temp = this.read(this.pc++); addr = (this.read(temp) | (this.read((temp + 1) & 0xff) << 8)) + this.y; this.write(addr, this.a); this.cycles += 4; break;

      case 0x86: this.write(this.read(this.pc++), this.x); this.cycles += 1; break;
      case 0x96: this.write((this.read(this.pc++) + this.y) & 0xff, this.x); this.cycles += 2; break;
      case 0x8E: this.write(this.read16(this.pc), this.x); this.pc += 2; this.cycles += 2; break;

      case 0x84: this.write(this.read(this.pc++), this.y); this.cycles += 1; break;
      case 0x94: this.write((this.read(this.pc++) + this.x) & 0xff, this.y); this.cycles += 2; break;
      case 0x8C: this.write(this.read16(this.pc), this.y); this.pc += 2; this.cycles += 2; break;

      case 0xAA: this.x = this.a; this.setZ(this.x); this.setN(this.x); break;
      case 0xA8: this.y = this.a; this.setZ(this.y); this.setN(this.y); break;
      case 0x8A: this.a = this.x; this.setZ(this.a); this.setN(this.a); break;
      case 0x98: this.a = this.y; this.setZ(this.a); this.setN(this.a); break;
      case 0xBA: this.x = this.sp; this.setZ(this.x); this.setN(this.x); break;
      case 0x9A: this.sp = this.x; break;

      case 0x48: this.push(this.a); this.cycles += 1; break;
      case 0x08: this.push(this.flags | 0x10); this.cycles += 1; break;
      case 0x68: this.a = this.pop(); this.setZ(this.a); this.setN(this.a); this.cycles += 2; break;
      case 0x28: this.flags = this.pop() | 0x20; this.cycles += 2; break;

      case 0xE9: this.sbc(this.read(this.pc++)); break;
      case 0xE5: this.sbc(this.read(this.read(this.pc++))); this.cycles += 1; break;
      case 0xED: this.sbc(this.read(this.read16(this.pc))); this.pc += 2; this.cycles += 2; break;
      case 0xF9: addr = this.read16(this.pc); this.pc += 2; this.sbc(this.read(addr + this.y)); this.cycles += 2; break;
      case 0xFD: addr = this.read16(this.pc); this.pc += 2; this.sbc(this.read(addr + this.x)); this.cycles += 2; break;
      case 0xE1: temp = (this.read(this.pc++) + this.x) & 0xff; addr = this.read(temp) | (this.read((temp + 1) & 0xff) << 8); this.sbc(this.read(addr)); this.cycles += 4; break;
      case 0xF1: temp = this.read(this.pc++); addr = (this.read(temp) | (this.read((temp + 1) & 0xff) << 8)) + this.y; this.sbc(this.read(addr)); this.cycles += 3; break;

      case 0x69: this.adc(this.read(this.pc++)); break;
      case 0x65: this.adc(this.read(this.read(this.pc++))); this.cycles += 1; break;
      case 0x6D: this.adc(this.read(this.read16(this.pc))); this.pc += 2; this.cycles += 2; break;
      case 0x7D: addr = this.read16(this.pc); this.pc += 2; this.adc(this.read(addr + this.x)); this.cycles += 2; break;
      case 0x79: addr = this.read16(this.pc); this.pc += 2; this.adc(this.read(addr + this.y)); this.cycles += 2; break;
      case 0x61: temp = (this.read(this.pc++) + this.x) & 0xff; addr = this.read(temp) | (this.read((temp + 1) & 0xff) << 8); this.adc(this.read(addr)); this.cycles += 4; break;
      case 0x71: temp = this.read(this.pc++); addr = (this.read(temp) | (this.read((temp + 1) & 0xff) << 8)) + this.y; this.adc(this.read(addr)); this.cycles += 3; break;

      case 0xC9: this.cmp(this.a, this.read(this.pc++)); break;
      case 0xC5: this.cmp(this.a, this.read(this.read(this.pc++))); this.cycles += 1; break;
      case 0xCD: this.cmp(this.a, this.read(this.read16(this.pc))); this.pc += 2; this.cycles += 2; break;
      case 0xDD: addr = this.read16(this.pc); this.pc += 2; this.cmp(this.a, this.read(addr + this.x)); this.cycles += 2; break;
      case 0xD9: addr = this.read16(this.pc); this.pc += 2; this.cmp(this.a, this.read(addr + this.y)); this.cycles += 2; break;
      case 0xC1: temp = (this.read(this.pc++) + this.x) & 0xff; addr = this.read(temp) | (this.read((temp + 1) & 0xff) << 8); this.cmp(this.a, this.read(addr)); this.cycles += 4; break;
      case 0xD1: temp = this.read(this.pc++); addr = (this.read(temp) | (this.read((temp + 1) & 0xff) << 8)) + this.y; this.cmp(this.a, this.read(addr)); this.cycles += 3; break;

      case 0xE0: this.cmp(this.x, this.read(this.pc++)); break;
      case 0xE4: this.cmp(this.x, this.read(this.read(this.pc++))); this.cycles += 1; break;
      case 0xEC: this.cmp(this.x, this.read(this.read16(this.pc))); this.pc += 2; this.cycles += 2; break;

      case 0xC0: this.cmp(this.y, this.read(this.pc++)); break;
      case 0xC4: this.cmp(this.y, this.read(this.read(this.pc++))); this.cycles += 1; break;
      case 0xCC: this.cmp(this.y, this.read(this.read16(this.pc))); this.pc += 2; this.cycles += 2; break;

      case 0x29: this.a &= this.read(this.pc++); this.setZ(this.a); this.setN(this.a); break;
      case 0x25: this.a &= this.read(this.read(this.pc++)); this.setZ(this.a); this.setN(this.a); this.cycles += 1; break;
      case 0x2D: this.a &= this.read(this.read16(this.pc)); this.pc += 2; this.setZ(this.a); this.setN(this.a); this.cycles += 2; break;
      case 0x3D: addr = this.read16(this.pc); this.pc += 2; this.a &= this.read(addr + this.x); this.setZ(this.a); this.setN(this.a); this.cycles += 2; break;
      case 0x39: addr = this.read16(this.pc); this.pc += 2; this.a &= this.read(addr + this.y); this.setZ(this.a); this.setN(this.a); this.cycles += 2; break;
      case 0x21: temp = (this.read(this.pc++) + this.x) & 0xff; addr = this.read(temp) | (this.read((temp + 1) & 0xff) << 8); this.a &= this.read(addr); this.setZ(this.a); this.setN(this.a); this.cycles += 4; break;
      case 0x31: temp = this.read(this.pc++); addr = (this.read(temp) | (this.read((temp + 1) & 0xff) << 8)) + this.y; this.a &= this.read(addr); this.setZ(this.a); this.setN(this.a); this.cycles += 3; break;

      case 0x09: this.a |= this.read(this.pc++); this.setZ(this.a); this.setN(this.a); break;
      case 0x05: this.a |= this.read(this.read(this.pc++)); this.setZ(this.a); this.setN(this.a); this.cycles += 1; break;
      case 0x0D: this.a |= this.read(this.read16(this.pc)); this.pc += 2; this.setZ(this.a); this.setN(this.a); this.cycles += 2; break;
      case 0x1D: addr = this.read16(this.pc); this.pc += 2; this.a |= this.read(addr + this.x); this.setZ(this.a); this.setN(this.a); this.cycles += 2; break;
      case 0x19: addr = this.read16(this.pc); this.pc += 2; this.a |= this.read(addr + this.y); this.setZ(this.a); this.setN(this.a); this.cycles += 2; break;
      case 0x01: temp = (this.read(this.pc++) + this.x) & 0xff; addr = this.read(temp) | (this.read((temp + 1) & 0xff) << 8); this.a |= this.read(addr); this.setZ(this.a); this.setN(this.a); this.cycles += 4; break;
      case 0x11: temp = this.read(this.pc++); addr = (this.read(temp) | (this.read((temp + 1) & 0xff) << 8)) + this.y; this.a |= this.read(addr); this.setZ(this.a); this.setN(this.a); this.cycles += 3; break;

      case 0x49: this.a ^= this.read(this.pc++); this.setZ(this.a); this.setN(this.a); break;
      case 0x45: this.a ^= this.read(this.read(this.pc++)); this.setZ(this.a); this.setN(this.a); this.cycles += 1; break;
      case 0x4D: this.a ^= this.read(this.read16(this.pc)); this.pc += 2; this.setZ(this.a); this.setN(this.a); this.cycles += 2; break;
      case 0x5D: addr = this.read16(this.pc); this.pc += 2; this.a ^= this.read(addr + this.x); this.setZ(this.a); this.setN(this.a); this.cycles += 2; break;
      case 0x59: addr = this.read16(this.pc); this.pc += 2; this.a ^= this.read(addr + this.y); this.setZ(this.a); this.setN(this.a); this.cycles += 2; break;
      case 0x41: temp = (this.read(this.pc++) + this.x) & 0xff; addr = this.read(temp) | (this.read((temp + 1) & 0xff) << 8); this.a ^= this.read(addr); this.setZ(this.a); this.setN(this.a); this.cycles += 4; break;
      case 0x51: temp = this.read(this.pc++); addr = (this.read(temp) | (this.read((temp + 1) & 0xff) << 8)) + this.y; this.a ^= this.read(addr); this.setZ(this.a); this.setN(this.a); this.cycles += 3; break;

      case 0xE6: addr = this.read(this.pc++); val = (this.read(addr) + 1) & 0xff; this.write(addr, val); this.setZ(val); this.setN(val); this.cycles += 3; break;
      case 0xF6: addr = (this.read(this.pc++) + this.x) & 0xff; val = (this.read(addr) + 1) & 0xff; this.write(addr, val); this.setZ(val); this.setN(val); this.cycles += 4; break;
      case 0xEE: addr = this.read16(this.pc); this.pc += 2; val = (this.read(addr) + 1) & 0xff; this.write(addr, val); this.setZ(val); this.setN(val); this.cycles += 4; break;
      case 0xFE: addr = this.read16(this.pc) + this.x; this.pc += 2; val = (this.read(addr) + 1) & 0xff; this.write(addr, val); this.setZ(val); this.setN(val); this.cycles += 5; break;

      case 0xC6: addr = this.read(this.pc++); val = (this.read(addr) - 1) & 0xff; this.write(addr, val); this.setZ(val); this.setN(val); this.cycles += 3; break;
      case 0xD6: addr = (this.read(this.pc++) + this.x) & 0xff; val = (this.read(addr) - 1) & 0xff; this.write(addr, val); this.setZ(val); this.setN(val); this.cycles += 4; break;
      case 0xCE: addr = this.read16(this.pc); this.pc += 2; val = (this.read(addr) - 1) & 0xff; this.write(addr, val); this.setZ(val); this.setN(val); this.cycles += 4; break;
      case 0xDE: addr = this.read16(this.pc) + this.x; this.pc += 2; val = (this.read(addr) - 1) & 0xff; this.write(addr, val); this.setZ(val); this.setN(val); this.cycles += 5; break;

      case 0xE8: this.x = (this.x + 1) & 0xff; this.setZ(this.x); this.setN(this.x); break;
      case 0xCA: this.x = (this.x - 1) & 0xff; this.setZ(this.x); this.setN(this.x); break;
      case 0xC8: this.y = (this.y + 1) & 0xff; this.setZ(this.y); this.setN(this.y); break;
      case 0x88: this.y = (this.y - 1) & 0xff; this.setZ(this.y); this.setN(this.y); break;

      case 0x0A: this.setC((this.a & 0x80) !== 0); this.a = (this.a << 1) & 0xff; this.setZ(this.a); this.setN(this.a); break;
      case 0x06: addr = this.read(this.pc++); val = this.read(addr); this.setC((val & 0x80) !== 0); val = (val << 1) & 0xff; this.write(addr, val); this.setZ(val); this.setN(val); this.cycles += 3; break;
      case 0x16: addr = (this.read(this.pc++) + this.x) & 0xff; val = this.read(addr); this.setC((val & 0x80) !== 0); val = (val << 1) & 0xff; this.write(addr, val); this.setZ(val); this.setN(val); this.cycles += 4; break;
      case 0x0E: addr = this.read16(this.pc); this.pc += 2; val = this.read(addr); this.setC((val & 0x80) !== 0); val = (val << 1) & 0xff; this.write(addr, val); this.setZ(val); this.setN(val); this.cycles += 4; break;
      case 0x1E: addr = this.read16(this.pc) + this.x; this.pc += 2; val = this.read(addr); this.setC((val & 0x80) !== 0); val = (val << 1) & 0xff; this.write(addr, val); this.setZ(val); this.setN(val); this.cycles += 5; break;

      case 0x4A: this.setC((this.a & 0x01) !== 0); this.a = (this.a >> 1) & 0xff; this.setZ(this.a); this.setN(this.a); break;
      case 0x46: addr = this.read(this.pc++); val = this.read(addr); this.setC((val & 0x01) !== 0); val = (val >> 1) & 0xff; this.write(addr, val); this.setZ(val); this.setN(val); this.cycles += 3; break;
      case 0x56: addr = (this.read(this.pc++) + this.x) & 0xff; val = this.read(addr); this.setC((val & 0x01) !== 0); val = (val >> 1) & 0xff; this.write(addr, val); this.setZ(val); this.setN(val); this.cycles += 4; break;
      case 0x4E: addr = this.read16(this.pc); this.pc += 2; val = this.read(addr); this.setC((val & 0x01) !== 0); val = (val >> 1) & 0xff; this.write(addr, val); this.setZ(val); this.setN(val); this.cycles += 4; break;
      case 0x5E: addr = this.read16(this.pc) + this.x; this.pc += 2; val = this.read(addr); this.setC((val & 0x01) !== 0); val = (val >> 1) & 0xff; this.write(addr, val); this.setZ(val); this.setN(val); this.cycles += 5; break;

      case 0x2A: temp = (this.a << 1) | (this.flags & 0x01); this.setC((temp & 0x100) !== 0); this.a = temp & 0xff; this.setZ(this.a); this.setN(this.a); break;
      case 0x26: addr = this.read(this.pc++); val = this.read(addr); temp = (val << 1) | (this.flags & 0x01); this.setC((temp & 0x100) !== 0); val = temp & 0xff; this.write(addr, val); this.setZ(val); this.setN(val); this.cycles += 3; break;
      case 0x36: addr = (this.read(this.pc++) + this.x) & 0xff; val = this.read(addr); temp = (val << 1) | (this.flags & 0x01); this.setC((temp & 0x100) !== 0); val = temp & 0xff; this.write(addr, val); this.setZ(val); this.setN(val); this.cycles += 4; break;
      case 0x2E: addr = this.read16(this.pc); this.pc += 2; val = this.read(addr); temp = (val << 1) | (this.flags & 0x01); this.setC((temp & 0x100) !== 0); val = temp & 0xff; this.write(addr, val); this.setZ(val); this.setN(val); this.cycles += 4; break;
      case 0x3E: addr = this.read16(this.pc) + this.x; this.pc += 2; val = this.read(addr); temp = (val << 1) | (this.flags & 0x01); this.setC((temp & 0x100) !== 0); val = temp & 0xff; this.write(addr, val); this.setZ(val); this.setN(val); this.cycles += 5; break;

      case 0x6A: temp = (this.a >> 1) | ((this.flags & 0x01) << 7); this.setC((this.a & 0x01) !== 0); this.a = temp & 0xff; this.setZ(this.a); this.setN(this.a); break;
      case 0x66: addr = this.read(this.pc++); val = this.read(addr); temp = (val >> 1) | ((this.flags & 0x01) << 7); this.setC((val & 0x01) !== 0); val = temp & 0xff; this.write(addr, val); this.setZ(val); this.setN(val); this.cycles += 3; break;
      case 0x76: addr = (this.read(this.pc++) + this.x) & 0xff; val = this.read(addr); temp = (val >> 1) | ((this.flags & 0x01) << 7); this.setC((val & 0x01) !== 0); val = temp & 0xff; this.write(addr, val); this.setZ(val); this.setN(val); this.cycles += 4; break;
      case 0x6E: addr = this.read16(this.pc); this.pc += 2; val = this.read(addr); temp = (val >> 1) | ((this.flags & 0x01) << 7); this.setC((val & 0x01) !== 0); val = temp & 0xff; this.write(addr, val); this.setZ(val); this.setN(val); this.cycles += 4; break;
      case 0x7E: addr = this.read16(this.pc) + this.x; this.pc += 2; val = this.read(addr); temp = (val >> 1) | ((this.flags & 0x01) << 7); this.setC((val & 0x01) !== 0); val = temp & 0xff; this.write(addr, val); this.setZ(val); this.setN(val); this.cycles += 5; break;

      case 0x24: val = this.read(this.read(this.pc++)); this.setZ(this.a & val); this.setN(val); if (val & 0x40) this.flags |= 0x40; else this.flags &= ~0x40; this.cycles += 1; break;
      case 0x2C: val = this.read(this.read16(this.pc)); this.pc += 2; this.setZ(this.a & val); this.setN(val); if (val & 0x40) this.flags |= 0x40; else this.flags &= ~0x40; this.cycles += 2; break;

      case 0x4C: this.pc = this.read16(this.pc); this.cycles += 1; break;
      case 0x6C: this.pc = this.read16Bug(this.read16(this.pc)); this.cycles += 3; break;

      case 0x20: addr = this.read16(this.pc); this.push(((this.pc + 1) >> 8) & 0xff); this.push((this.pc + 1) & 0xff); this.pc = addr; this.cycles += 4; break;
      case 0x60: this.pc = ((this.pop() | (this.pop() << 8)) + 1) & 0xffff; this.cycles += 4; break;
      case 0x40: this.flags = this.pop() | 0x20; this.pc = this.pop() | (this.pop() << 8); this.cycles += 4; break;

      case 0x00: this.pc++; this.push((this.pc >> 8) & 0xff); this.push(this.pc & 0xff); this.push(this.flags | 0x10); this.flags |= 0x04; this.pc = this.read16(0xFFFE); this.cycles += 5; break; // BRK

      case 0x10: this.branch((this.flags & 0x80) === 0); break;
      case 0x30: this.branch((this.flags & 0x80) !== 0); break;
      case 0x50: this.branch((this.flags & 0x40) === 0); break;
      case 0x70: this.branch((this.flags & 0x40) !== 0); break;
      case 0x90: this.branch((this.flags & 0x01) === 0); break;
      case 0xB0: this.branch((this.flags & 0x01) !== 0); break;
      case 0xD0: this.branch((this.flags & 0x02) === 0); break;
      case 0xF0: this.branch((this.flags & 0x02) !== 0); break;

      case 0x18: this.flags &= ~0x01; break;
      case 0x38: this.flags |= 0x01; break;
      case 0x58: this.flags &= ~0x04; break;
      case 0x78: this.flags |= 0x04; break;
      case 0xB8: this.flags &= ~0x40; break;
      case 0xD8: this.flags &= ~0x08; break;
      case 0xF8: this.flags |= 0x08; break;
      case 0xEA: break;

      // Illegal Opcodes
      case 0xA7: val = this.read(this.read(this.pc++)); this.a = val; this.x = val; this.setZ(val); this.setN(val); this.cycles += 1; break;
      case 0xB7: val = this.read((this.read(this.pc++) + this.y) & 0xff); this.a = val; this.x = val; this.setZ(val); this.setN(val); this.cycles += 2; break;
      case 0xAF: val = this.read(this.read16(this.pc)); this.pc += 2; this.a = val; this.x = val; this.setZ(val); this.setN(val); this.cycles += 2; break;
      case 0xBF: addr = this.read16(this.pc); this.pc += 2; val = this.read(addr + this.y); this.a = val; this.x = val; this.setZ(val); this.setN(val); this.cycles += 2; break;
      case 0xA3: temp = (this.read(this.pc++) + this.x) & 0xff; addr = this.read(temp) | (this.read((temp + 1) & 0xff) << 8); val = this.read(addr); this.a = val; this.x = val; this.setZ(val); this.setN(val); this.cycles += 4; break;
      case 0xB3: temp = this.read(this.pc++); addr = (this.read(temp) | (this.read((temp + 1) & 0xff) << 8)) + this.y; val = this.read(addr); this.a = val; this.x = val; this.setZ(val); this.setN(val); this.cycles += 3; break;

      case 0x87: this.write(this.read(this.pc++), this.a & this.x); this.cycles += 1; break;
      case 0x97: this.write((this.read(this.pc++) + this.y) & 0xff, this.a & this.x); this.cycles += 2; break;
      case 0x8F: this.write(this.read16(this.pc), this.a & this.x); this.pc += 2; this.cycles += 2; break;
      case 0x83: temp = (this.read(this.pc++) + this.x) & 0xff; addr = this.read(temp) | (this.read((temp + 1) & 0xff) << 8); this.write(addr, this.a & this.x); this.cycles += 4; break;

      case 0xC7: addr = this.read(this.pc++); val = (this.read(addr) - 1) & 0xff; this.write(addr, val); this.cmp(this.a, val); this.cycles += 3; break;
      case 0xD7: addr = (this.read(this.pc++) + this.x) & 0xff; val = (this.read(addr) - 1) & 0xff; this.write(addr, val); this.cmp(this.a, val); this.cycles += 4; break;
      case 0xCF: addr = this.read16(this.pc); this.pc += 2; val = (this.read(addr) - 1) & 0xff; this.write(addr, val); this.cmp(this.a, val); this.cycles += 4; break;
      case 0xDF: addr = this.read16(this.pc) + this.x; this.pc += 2; val = (this.read(addr) - 1) & 0xff; this.write(addr, val); this.cmp(this.a, val); this.cycles += 5; break;
      case 0xDB: addr = this.read16(this.pc) + this.y; this.pc += 2; val = (this.read(addr) - 1) & 0xff; this.write(addr, val); this.cmp(this.a, val); this.cycles += 5; break;
      case 0xC3: temp = (this.read(this.pc++) + this.x) & 0xff; addr = this.read(temp) | (this.read((temp + 1) & 0xff) << 8); val = (this.read(addr) - 1) & 0xff; this.write(addr, val); this.cmp(this.a, val); this.cycles += 6; break;
      case 0xD3: temp = this.read(this.pc++); addr = (this.read(temp) | (this.read((temp + 1) & 0xff) << 8)) + this.y; val = (this.read(addr) - 1) & 0xff; this.write(addr, val); this.cmp(this.a, val); this.cycles += 6; break;

      case 0xE7: addr = this.read(this.pc++); val = (this.read(addr) + 1) & 0xff; this.write(addr, val); this.sbc(val); this.cycles += 3; break;
      case 0xF7: addr = (this.read(this.pc++) + this.x) & 0xff; val = (this.read(addr) + 1) & 0xff; this.write(addr, val); this.sbc(val); this.cycles += 4; break;
      case 0xEF: addr = this.read16(this.pc); this.pc += 2; val = (this.read(addr) + 1) & 0xff; this.write(addr, val); this.sbc(val); this.cycles += 4; break;
      case 0xFF: addr = this.read16(this.pc) + this.x; this.pc += 2; val = (this.read(addr) + 1) & 0xff; this.write(addr, val); this.sbc(val); this.cycles += 5; break;
      case 0xFB: addr = this.read16(this.pc) + this.y; this.pc += 2; val = (this.read(addr) + 1) & 0xff; this.write(addr, val); this.sbc(val); this.cycles += 5; break;
      case 0xE3: temp = (this.read(this.pc++) + this.x) & 0xff; addr = this.read(temp) | (this.read((temp + 1) & 0xff) << 8); val = (this.read(addr) + 1) & 0xff; this.write(addr, val); this.sbc(val); this.cycles += 6; break;
      case 0xF3: temp = this.read(this.pc++); addr = (this.read(temp) | (this.read((temp + 1) & 0xff) << 8)) + this.y; val = (this.read(addr) + 1) & 0xff; this.write(addr, val); this.sbc(val); this.cycles += 6; break;

      case 0x07: addr = this.read(this.pc++); val = this.read(addr); this.setC((val & 0x80) !== 0); val = (val << 1) & 0xff; this.write(addr, val); this.a |= val; this.setZ(this.a); this.setN(this.a); this.cycles += 3; break;
      case 0x17: addr = (this.read(this.pc++) + this.x) & 0xff; val = this.read(addr); this.setC((val & 0x80) !== 0); val = (val << 1) & 0xff; this.write(addr, val); this.a |= val; this.setZ(this.a); this.setN(this.a); this.cycles += 4; break;
      case 0x0F: addr = this.read16(this.pc); this.pc += 2; val = this.read(addr); this.setC((val & 0x80) !== 0); val = (val << 1) & 0xff; this.write(addr, val); this.a |= val; this.setZ(this.a); this.setN(this.a); this.cycles += 4; break;
      case 0x1F: addr = this.read16(this.pc) + this.x; this.pc += 2; val = this.read(addr); this.setC((val & 0x80) !== 0); val = (val << 1) & 0xff; this.write(addr, val); this.a |= val; this.setZ(this.a); this.setN(this.a); this.cycles += 5; break;
      case 0x1B: addr = this.read16(this.pc) + this.y; this.pc += 2; val = this.read(addr); this.setC((val & 0x80) !== 0); val = (val << 1) & 0xff; this.write(addr, val); this.a |= val; this.setZ(this.a); this.setN(this.a); this.cycles += 5; break;
      case 0x03: temp = (this.read(this.pc++) + this.x) & 0xff; addr = this.read(temp) | (this.read((temp + 1) & 0xff) << 8); val = this.read(addr); this.setC((val & 0x80) !== 0); val = (val << 1) & 0xff; this.write(addr, val); this.a |= val; this.setZ(this.a); this.setN(this.a); this.cycles += 6; break;
      case 0x13: temp = this.read(this.pc++); addr = (this.read(temp) | (this.read((temp + 1) & 0xff) << 8)) + this.y; val = this.read(addr); this.setC((val & 0x80) !== 0); val = (val << 1) & 0xff; this.write(addr, val); this.a |= val; this.setZ(this.a); this.setN(this.a); this.cycles += 6; break;

      case 0x27: addr = this.read(this.pc++); val = this.read(addr); temp = (val << 1) | (this.flags & 0x01); this.setC((temp & 0x100) !== 0); val = temp & 0xff; this.write(addr, val); this.a &= val; this.setZ(this.a); this.setN(this.a); this.cycles += 3; break;
      case 0x37: addr = (this.read(this.pc++) + this.x) & 0xff; val = this.read(addr); temp = (val << 1) | (this.flags & 0x01); this.setC((temp & 0x100) !== 0); val = temp & 0xff; this.write(addr, val); this.a &= val; this.setZ(this.a); this.setN(this.a); this.cycles += 4; break;
      case 0x2F: addr = this.read16(this.pc); this.pc += 2; val = this.read(addr); temp = (val << 1) | (this.flags & 0x01); this.setC((temp & 0x100) !== 0); val = temp & 0xff; this.write(addr, val); this.a &= val; this.setZ(this.a); this.setN(this.a); this.cycles += 4; break;
      case 0x3F: addr = this.read16(this.pc) + this.x; this.pc += 2; val = this.read(addr); temp = (val << 1) | (this.flags & 0x01); this.setC((temp & 0x100) !== 0); val = temp & 0xff; this.write(addr, val); this.a &= val; this.setZ(this.a); this.setN(this.a); this.cycles += 5; break;
      case 0x3B: addr = this.read16(this.pc) + this.y; this.pc += 2; val = this.read(addr); temp = (val << 1) | (this.flags & 0x01); this.setC((temp & 0x100) !== 0); val = temp & 0xff; this.write(addr, val); this.a &= val; this.setZ(this.a); this.setN(this.a); this.cycles += 5; break;
      case 0x23: temp = (this.read(this.pc++) + this.x) & 0xff; addr = this.read(temp) | (this.read((temp + 1) & 0xff) << 8); val = this.read(addr); temp = (val << 1) | (this.flags & 0x01); this.setC((temp & 0x100) !== 0); val = temp & 0xff; this.write(addr, val); this.a &= val; this.setZ(this.a); this.setN(this.a); this.cycles += 6; break;
      case 0x33: temp = this.read(this.pc++); addr = (this.read(temp) | (this.read((temp + 1) & 0xff) << 8)) + this.y; val = this.read(addr); temp = (val << 1) | (this.flags & 0x01); this.setC((temp & 0x100) !== 0); val = temp & 0xff; this.write(addr, val); this.a &= val; this.setZ(this.a); this.setN(this.a); this.cycles += 6; break;

      case 0x47: addr = this.read(this.pc++); val = this.read(addr); this.setC((val & 0x01) !== 0); val = (val >> 1) & 0xff; this.write(addr, val); this.a ^= val; this.setZ(this.a); this.setN(this.a); this.cycles += 3; break;
      case 0x57: addr = (this.read(this.pc++) + this.x) & 0xff; val = this.read(addr); this.setC((val & 0x01) !== 0); val = (val >> 1) & 0xff; this.write(addr, val); this.a ^= val; this.setZ(this.a); this.setN(this.a); this.cycles += 4; break;
      case 0x4F: addr = this.read16(this.pc); this.pc += 2; val = this.read(addr); this.setC((val & 0x01) !== 0); val = (val >> 1) & 0xff; this.write(addr, val); this.a ^= val; this.setZ(this.a); this.setN(this.a); this.cycles += 4; break;
      case 0x5F: addr = this.read16(this.pc) + this.x; this.pc += 2; val = this.read(addr); this.setC((val & 0x01) !== 0); val = (val >> 1) & 0xff; this.write(addr, val); this.a ^= val; this.setZ(this.a); this.setN(this.a); this.cycles += 5; break;
      case 0x5B: addr = this.read16(this.pc) + this.y; this.pc += 2; val = this.read(addr); this.setC((val & 0x01) !== 0); val = (val >> 1) & 0xff; this.write(addr, val); this.a ^= val; this.setZ(this.a); this.setN(this.a); this.cycles += 5; break;
      case 0x43: temp = (this.read(this.pc++) + this.x) & 0xff; addr = this.read(temp) | (this.read((temp + 1) & 0xff) << 8); val = this.read(addr); this.setC((val & 0x01) !== 0); val = (val >> 1) & 0xff; this.write(addr, val); this.a ^= val; this.setZ(this.a); this.setN(this.a); this.cycles += 6; break;
      case 0x53: temp = this.read(this.pc++); addr = (this.read(temp) | (this.read((temp + 1) & 0xff) << 8)) + this.y; val = this.read(addr); this.setC((val & 0x01) !== 0); val = (val >> 1) & 0xff; this.write(addr, val); this.a ^= val; this.setZ(this.a); this.setN(this.a); this.cycles += 6; break;

      case 0x67: addr = this.read(this.pc++); val = this.read(addr); temp = (val >> 1) | ((this.flags & 0x01) << 7); this.setC((val & 0x01) !== 0); val = temp & 0xff; this.write(addr, val); this.adc(val); this.cycles += 3; break;
      case 0x77: addr = (this.read(this.pc++) + this.x) & 0xff; val = this.read(addr); temp = (val >> 1) | ((this.flags & 0x01) << 7); this.setC((val & 0x01) !== 0); val = temp & 0xff; this.write(addr, val); this.adc(val); this.cycles += 4; break;
      case 0x6F: addr = this.read16(this.pc); this.pc += 2; val = this.read(addr); temp = (val >> 1) | ((this.flags & 0x01) << 7); this.setC((val & 0x01) !== 0); val = temp & 0xff; this.write(addr, val); this.adc(val); this.cycles += 4; break;
      case 0x7F: addr = this.read16(this.pc) + this.x; this.pc += 2; val = this.read(addr); temp = (val >> 1) | ((this.flags & 0x01) << 7); this.setC((val & 0x01) !== 0); val = temp & 0xff; this.write(addr, val); this.adc(val); this.cycles += 5; break;
      case 0x7B: addr = this.read16(this.pc) + this.y; this.pc += 2; val = this.read(addr); temp = (val >> 1) | ((this.flags & 0x01) << 7); this.setC((val & 0x01) !== 0); val = temp & 0xff; this.write(addr, val); this.adc(val); this.cycles += 5; break;
      case 0x63: temp = (this.read(this.pc++) + this.x) & 0xff; addr = this.read(temp) | (this.read((temp + 1) & 0xff) << 8); val = this.read(addr); temp = (val >> 1) | ((this.flags & 0x01) << 7); this.setC((val & 0x01) !== 0); val = temp & 0xff; this.write(addr, val); this.adc(val); this.cycles += 6; break;
      case 0x73: temp = this.read(this.pc++); addr = (this.read(temp) | (this.read((temp + 1) & 0xff) << 8)) + this.y; val = this.read(addr); temp = (val >> 1) | ((this.flags & 0x01) << 7); this.setC((val & 0x01) !== 0); val = temp & 0xff; this.write(addr, val); this.adc(val); this.cycles += 6; break;

      case 0x1A: case 0x3A: case 0x5A: case 0x7A: case 0xDA: case 0xFA:
        break;

      case 0x80: case 0x82: case 0x89: case 0xC2: case 0xE2:
      case 0x04: case 0x14: case 0x34: case 0x44: case 0x54: case 0x64: case 0x74: case 0xD4: case 0xF4:
        this.pc++; this.cycles += 1;
        break;

      case 0x0C: case 0x1C: case 0x3C: case 0x5C: case 0x7C: case 0xDC: case 0xFC:
        this.pc += 2; this.cycles += 2;
        break;

      default:
        throw new Error(`Unsupported 6502 opcode $${opcode.toString(16).toUpperCase().padStart(2, '0')} at $${((this.pc - 1) & 0xFFFF).toString(16).toUpperCase().padStart(4, '0')}`);
    }
  }

  private adc(val: number) {
    if ((this.flags & 0x08) !== 0) {
        // Decimal Mode (MOS 6510 specific)
        let low = (this.a & 0x0F) + (val & 0x0F) + (this.flags & 0x01);
        let halfCarry = 0;
        if (low > 9) {
            low += 6; // Decimal adjust
            low &= 0x0F;
            halfCarry = 1;
        }
        let high = (this.a >> 4) + (val >> 4) + halfCarry;
        this.setZ((this.a + val + (this.flags & 0x01)) & 0xFF); // Z is based on binary sum result in NMOS 6502
        this.setN((high << 4) | low); // N is also based on binary result often, but for simulation let's be approximate or strict

        // Accurate V flag calculation for decimal is complex on NMOS, often invalid.
        // We will stick to binary V calculation as it's rarely used in decimal math on C64.
        const sumBinary = this.a + val + (this.flags & 0x01);
        if (!((this.a ^ val) & 0x80) && ((this.a ^ sumBinary) & 0x80)) this.flags |= 0x40;
        else this.flags &= ~0x40;

        if (high > 9) {
            high += 6;
        }
        this.setC(high > 15);
        this.a = ((high << 4) | low) & 0xFF;
    } else {
        const sum = this.a + val + (this.flags & 0x01);
        if (!((this.a ^ val) & 0x80) && ((this.a ^ sum) & 0x80)) this.flags |= 0x40;
        else this.flags &= ~0x40;

        this.setC(sum > 0xff);
        this.a = sum & 0xff;
        this.setZ(this.a); this.setN(this.a);
    }
  }

  private sbc(val: number) {
    if ((this.flags & 0x08) !== 0) {
        // Decimal Mode SBC
        let low = (this.a & 0x0F) - (val & 0x0F) - ((this.flags & 0x01) ? 0 : 1);
        let halfCarry = 0;
        if (low < 0) {
            low -= 6;
            low &= 0x0F;
            halfCarry = 1;
        }
        let high = (this.a >> 4) - (val >> 4) - halfCarry;
        if (high < 0) {
            high -= 6;
        }

        const sumBinary = this.a - val - ((this.flags & 0x01) ? 0 : 1);
        this.setC(sumBinary >= 0);
        this.setZ(sumBinary & 0xFF);
        this.setN(sumBinary & 0xFF);

        // Overflow
        const valInverted = val ^ 0xFF;
        if (!((this.a ^ valInverted) & 0x80) && ((this.a ^ sumBinary) & 0x80)) this.flags |= 0x40;
        else this.flags &= ~0x40;

        this.a = ((high << 4) | low) & 0xFF;
    } else {
        this.adc(val ^ 0xff);
    }
  }

  private cmp(reg: number, val: number) {
    const res = reg - val;
    this.setC(res >= 0);
    this.setZ(res & 0xff);
    this.setN(res & 0xff);
  }

  private branch(cond: boolean) {
    if (cond) {
      let offset = this.read(this.pc++);
      if (offset & 0x80) offset -= 0x100;

      const oldPc = this.pc;
      this.pc = (this.pc + offset) & 0xffff;
      this.cycles += 1;

      // Page crossing penalty
      if ((this.pc & 0xFF00) !== (oldPc & 0xFF00)) {
          this.cycles += 1;
      }
    } else {
      this.pc++;
    }
  }
}
