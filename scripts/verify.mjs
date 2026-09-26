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

function run(...args) {
  const result = spawnSync(process.execPath, [cli, ...args], { cwd: root, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr || result.stdout);
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
  await writeFile(sid, makeFixture());
  run('sid-to-json', sid, '--seconds', '1', '-o', firstJson);
  run('sid-to-json', sid, '--seconds', '1', '-o', secondJson);
  assert.deepEqual(await readFile(firstJson), await readFile(secondJson), 'SID JSON output must be deterministic');
  const dump = JSON.parse(await readFile(firstJson, 'utf8'));
  assert.equal(dump.frames.length, 50);
  assert.ok(dump.frames.every((frame) => frame.cycles === 19704));
  assert.ok(dump.frames.every((frame) => frame.registers.length === 25));
  run('json-to-midi', firstJson, '-o', midi);
  verifyMidi(await readFile(midi));
  await writeFile(join(folder, 'bad.sid'), Buffer.from('PSID'));
  const invalid = spawnSync(process.execPath, [cli, 'inspect', join(folder, 'bad.sid')], { cwd: root, encoding: 'utf8' });
  assert.notEqual(invalid.status, 0, 'truncated SID input must fail');
  console.log('Verification OK: deterministic JSON, PAL timing, SID validation, and MIDI structure');
} finally {
  await rm(folder, { recursive: true, force: true });
}
