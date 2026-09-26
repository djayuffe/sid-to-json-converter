#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises';
import { basename, extname, resolve } from 'node:path';
import { JsonToMidiConverter, MidiConversionOptions } from '../services/sid/JsonToMidi';
import { parseSidHeader } from '../services/sid/SidParser';
import { SidPlayer } from '../services/sid/SidPlayer';
import { SidDump } from '../services/sid/SidTypes';

type ParsedOptions = { out?: string; jsonOut?: string; compact: boolean; seconds: number; song: number; midi: MidiConversionOptions };

const usage = `SID to JSON Converter CLI

Usage:
  sid-json sid-to-json <input.sid> [-o dump.json] [--seconds 60] [--song 1]
  sid-json json-to-midi <input.json> [-o output.mid] [MIDI options]
  sid-json sid-to-midi <input.sid> [-o output.mid] [--json-out dump.json] [capture and MIDI options]
  sid-json inspect <input.sid>
  sid-json validate-json <input.json>

MIDI options:
  --quantize none|auto|1/32|1/16|1/16T|1/8|1/8T|1/4
  --octave-shift -4..4 --min-note-frames N
  --note-duration gate|audible|smart
  --no-expression --minimal-automation --no-merge-gaps
  --no-drums --arps-to-chords

JSON options:
  --compact                 Write JSON without indentation.
  --json-out <path>         Also write the SID capture during sid-to-midi.
`;

function fail(message: string): never { throw new Error(`${message}\n\n${usage}`); }
function inputArrayBuffer(data: Buffer): ArrayBuffer { return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer; }
function defaultOutput(input: string, extension: '.json' | '.mid'): string { const source = resolve(input); return source.slice(0, source.length - extname(source).length) + extension; }
function positiveInteger(value: string, name: string): number { const parsed = Number(value); if (!Number.isInteger(parsed) || parsed < 1) fail(`${name} must be a positive integer`); return parsed; }
function positiveSeconds(value: string): number { const parsed = Number(value); if (!Number.isFinite(parsed) || parsed <= 0 || parsed > 3600) fail('--seconds must be between 0 and 3600'); return parsed; }

function parseOptions(args: string[]): { input: string; options: ParsedOptions } {
  let input: string | undefined;
  const options: ParsedOptions = { seconds: 60, song: 1, compact: false, midi: {} };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const next = () => { const value = args[index + 1]; if (!value || value.startsWith('-')) fail(`${arg} requires a value`); index += 1; return value; };
    switch (arg) {
      case '-o': case '--out': options.out = next(); break;
      case '--json-out': options.jsonOut = next(); break;
      case '--compact': options.compact = true; break;
      case '--seconds': options.seconds = positiveSeconds(next()); break;
      case '--song': options.song = positiveInteger(next(), '--song'); break;
      case '--quantize': { const value = next(); if (!['none', 'auto', '1/32', '1/16', '1/16T', '1/8', '1/8T', '1/4'].includes(value)) fail('Unsupported quantize value'); options.midi.quantize = value as MidiConversionOptions['quantize']; break; }
      case '--octave-shift': { const value = Number(next()); if (!Number.isInteger(value) || value < -4 || value > 4) fail('--octave-shift must be an integer between -4 and 4'); options.midi.octaveShift = value; break; }
      case '--min-note-frames': options.midi.minNoteFrames = positiveInteger(next(), '--min-note-frames'); break;
      case '--note-duration': { const value = next(); if (!['gate', 'audible', 'smart'].includes(value)) fail('Unsupported note duration'); options.midi.noteDuration = value as MidiConversionOptions['noteDuration']; break; }
      case '--no-expression': options.midi.useExpression = false; break;
      case '--minimal-automation': options.midi.fullAutomation = false; break;
      case '--no-merge-gaps': options.midi.mergeGaps = false; break;
      case '--no-drums': options.midi.detectDrums = false; break;
      case '--arps-to-chords': options.midi.convertArpsToChords = true; break;
      default: if (arg.startsWith('-')) fail(`Unknown option: ${arg}`); if (input) fail(`Unexpected argument: ${arg}`); input = arg;
    }
  }
  if (!input) fail('An input file is required');
  return { input, options };
}

function validateDump(value: unknown): asserts value is SidDump {
  if (!value || typeof value !== 'object') throw new Error('Invalid JSON: expected a SID dump object');
  const dump = value as Partial<SidDump>;
  if (!dump.metadata || typeof dump.metadata.magic !== 'string' || !Array.isArray(dump.frames)) throw new Error('Invalid JSON: metadata and frames are required');
  for (const [index, frame] of dump.frames.entries()) {
    if (!Array.isArray(frame.registers) || frame.registers.length !== 25 || !frame.registers.every((value) => Number.isInteger(value) && value >= 0 && value <= 255) || !Array.isArray(frame.voices) || frame.voices.length !== 3 || !frame.filter) throw new Error(`Invalid JSON: frame ${index} is not a compatible SID capture`);
  }
}

async function writeDump(output: string, dump: SidDump, compact: boolean): Promise<void> {
  await writeFile(output, `${JSON.stringify(dump, null, compact ? undefined : 2)}\n`, 'utf8');
}

async function sidToJson(input: string, options: ParsedOptions): Promise<void> {
  const source = await readFile(input);
  const dump = new SidPlayer().convertToJSON(inputArrayBuffer(source), options.seconds, options.song);
  const output = options.out ?? defaultOutput(input, '.json');
  await writeDump(output, dump, options.compact);
  console.log(`Wrote ${output}: ${dump.frameCount} frames, ${dump.totalDuration.toFixed(2)} seconds`);
}

async function jsonToMidi(input: string, options: ParsedOptions): Promise<void> {
  const parsed: unknown = JSON.parse(await readFile(input, 'utf8'));
  validateDump(parsed);
  const output = options.out ?? defaultOutput(input, '.mid');
  const midi = new JsonToMidiConverter().convert(parsed, options.midi);
  await writeFile(output, midi);
  console.log(`Wrote ${output}: ${midi.byteLength} MIDI bytes from ${parsed.frames.length} frames`);
}

async function sidToMidi(input: string, options: ParsedOptions): Promise<void> {
  const source = await readFile(input);
  const dump = new SidPlayer().convertToJSON(inputArrayBuffer(source), options.seconds, options.song);
  if (options.jsonOut) await writeDump(options.jsonOut, dump, options.compact);
  const output = options.out ?? defaultOutput(input, '.mid');
  const midi = new JsonToMidiConverter().convert(dump, options.midi);
  await writeFile(output, midi);
  console.log(`Wrote ${output}: ${midi.byteLength} MIDI bytes from ${dump.frameCount} frames${options.jsonOut ? `; JSON ${options.jsonOut}` : ''}`);
}

async function inspect(input: string): Promise<void> {
  const { header, sidData } = parseSidHeader(inputArrayBuffer(await readFile(input)));
  console.log(JSON.stringify({ file: basename(input), header, programBytes: sidData.byteLength }, null, 2));
}

async function validateJson(input: string): Promise<void> {
  const parsed: unknown = JSON.parse(await readFile(input, 'utf8'));
  validateDump(parsed);
  console.log(`JSON OK: ${parsed.metadata.magic} ${parsed.metadata.title || ''}, ${parsed.frames.length} frames`);
}

async function main(): Promise<void> {
  const [command, ...arguments_] = process.argv.slice(2);
  if (!command || command === '--help' || command === '-h' || command === 'help') { console.log(usage); return; }
  if (command === '--version' || command === '-V') { console.log('sid-json 0.0.0'); return; }
  const { input, options } = parseOptions(arguments_);
  if (command === 'sid-to-json') return sidToJson(input, options);
  if (command === 'json-to-midi') return jsonToMidi(input, options);
  if (command === 'sid-to-midi') return sidToMidi(input, options);
  if (command === 'inspect') return inspect(input);
  if (command === 'validate-json') return validateJson(input);
  fail(`Unknown command: ${command}`);
}

main().catch((error: unknown) => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
