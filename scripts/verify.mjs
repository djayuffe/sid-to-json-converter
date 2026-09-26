import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = new URL('..', import.meta.url).pathname;
const cli = join(root, 'dist-cli', 'sid-json.mjs');

function writeText(buffer, offset, value) {
  Buffer.from(value, 'latin1').copy(buffer, offset, 0, 32);
}

function makeFixture() {
  const header = Buffer.alloc(0x7C);
  header.write('PSID', 0, 'ascii');
  header.writeUInt16BE(2, 4);
  header.writeUInt16BE(0x7C, 6);
  header.writeUInt16BE(0x1000, 8);
  header.writeUInt16BE(0x1000, 10);
  header.writeUInt16BE(0x100B, 12);
  header.writeUInt16BE(1, 14);
  header.writeUInt16BE(1, 16);
  writeText(header, 0x16, 'CLI Smoke');
  writeText(header, 0x36, 'SID to JSON');
  writeText(header, 0x56, '2026');
  header.writeUInt16BE(0x24, 0x76); // PAL + MOS8580 preference
  // $1000 init installs a custom IRQ vector then returns. $100B play sets voice 1 frequency/gate then returns.
  // A PSID with a nonzero play address must remain direct-call driven despite that custom vector.
  const program = Buffer.from([0xA9, 0x00, 0x8D, 0xFE, 0xFF, 0xA9, 0x20, 0x8D, 0xFF, 0xFF, 0x60, 0xA9, 0x11, 0x8D, 0x00, 0xD4, 0xA9, 0x02, 0x8D, 0x01, 0xD4, 0xA9, 0x41, 0x8D, 0x04, 0xD4, 0x60]);
  return Buffer.concat([header, program]);
}

function makeRsidFixture() {
  const header = Buffer.alloc(0x7C);
  header.write('RSID', 0, 'ascii');
  header.writeUInt16BE(2, 4);
  header.writeUInt16BE(0x7C, 6);
  header.writeUInt16BE(0x1000, 8);
  header.writeUInt16BE(0x1000, 10);
  header.writeUInt16BE(0, 12); // IRQ-driven RSID has no direct play routine.
  header.writeUInt16BE(1, 14);
  header.writeUInt16BE(1, 16);
  header.writeUInt16BE(0x14, 0x76); // PAL
  // INIT installs a CIA1 Timer-A handler at $101F. The handler clears CIA1,
  // writes a gated SID voice, then RTI. This exercises the KERNAL $0314
  // indirection, CIA ICR mask/latch behavior, IRQ delivery, and RTI path.
  const init = Buffer.from([
    0xA9, 0x1F, 0x8D, 0x14, 0x03, 0xA9, 0x10, 0x8D, 0x15, 0x03,
    0xA9, 0x20, 0x8D, 0x04, 0xDC, 0xA9, 0x00, 0x8D, 0x05, 0xDC,
    0xA9, 0x81, 0x8D, 0x0D, 0xDC, 0xA9, 0x11, 0x8D, 0x0E, 0xDC,
    0x60,
    0xAD, 0x0D, 0xDC, 0xA9, 0x34, 0x8D, 0x00, 0xD4,
    0xA9, 0x03, 0x8D, 0x01, 0xD4, 0xA9, 0x41, 0x8D, 0x04, 0xD4, 0x40,
  ]);
  return Buffer.concat([header, init]);
}

function run(...args) {
  const result = spawnSync(process.execPath, [cli, ...args], { cwd: root, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr || result.stdout);
}

function runFails(...args) {
  const result = spawnSync(process.execPath, [cli, ...args], { cwd: root, encoding: 'utf8' });
  assert.notEqual(result.status, 0, 'command should reject invalid input');
}

function verifyMidi(data) {
  assert.equal(data.subarray(0, 4).toString('ascii'), 'MThd');
  assert.equal(data.readUInt32BE(4), 6);
  const tracks = data.readUInt16BE(10);
  let offset = 14;
  for (let index = 0; index < tracks; index += 1) {
    assert.equal(data.subarray(offset, offset + 4).toString('ascii'), 'MTrk');
    const length = data.readUInt32BE(offset + 4);
    const end = offset + 8 + length;
    assert.ok(end <= data.length, `track ${index} is truncated`);
    assert.deepEqual([...data.subarray(end - 3, end)], [0xFF, 0x2F, 0x00]);
    offset = end;
  }
  assert.equal(offset, data.length);
}

const folder = await mkdtemp(join(tmpdir(), 'sid-json-verify-'));
try {
  const sid = join(folder, 'fixture.sid');
  const firstJson = join(folder, 'first.json');
  const secondJson = join(folder, 'second.json');
  const midi = join(folder, 'fixture.mid');
  const rsid = join(folder, 'irq-driver.rsid');
  const rsidJson = join(folder, 'irq-driver.json');
  await writeFile(sid, makeFixture());
  run('sid-to-json', sid, '--seconds', '1', '-o', firstJson);
  run('sid-to-json', sid, '--seconds', '1', '-o', secondJson);
  assert.deepEqual(await readFile(firstJson), await readFile(secondJson), 'SID JSON output must be deterministic');
  const dump = JSON.parse(await readFile(firstJson, 'utf8'));
  assert.equal(dump.frames.length, 50);
  assert.ok(dump.frames.every((frame) => frame.cycles === 19704));
  assert.ok(dump.frames.every((frame) => frame.registers.length === 25));

  await writeFile(rsid, makeRsidFixture());
  run('sid-to-json', rsid, '--seconds', '1', '-o', rsidJson);
  const rsidDump = JSON.parse(await readFile(rsidJson, 'utf8'));
  assert.equal(rsidDump.frames.length, 50);
  assert.ok(rsidDump.frames.some((frame) => frame.registers[4] === 0x41), 'CIA IRQ-driven RSID handler must update SID registers');

  run('json-to-midi', firstJson, '-o', midi);
  verifyMidi(await readFile(midi));
  await writeFile(join(folder, 'bad.sid'), Buffer.from('PSID'));
  runFails('inspect', join(folder, 'bad.sid'));
  const malformedDump = { ...dump, frameCount: dump.frameCount + 1 };
  const badJson = join(folder, 'bad.json');
  await writeFile(badJson, JSON.stringify(malformedDump));
  runFails('validate-json', badJson);
  runFails('json-to-midi', badJson, '-o', midi);
  console.log('Verification OK: PSID/RSID timing, IRQ paths, SID/JSON validation, and MIDI structure');
} finally {
  await rm(folder, { recursive: true, force: true });
}
