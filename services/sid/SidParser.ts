import { SidHeader } from './SidTypes';

export function parseSidHeader(data: ArrayBuffer): { header: SidHeader; sidData: Uint8Array } {
  const minimumHeaderSize = 0x76;
  if (data.byteLength < minimumHeaderSize) {
    throw new Error(`Invalid SID file: header is truncated (${data.byteLength} bytes)`);
  }
  const view = new DataView(data);
  const rawData = new Uint8Array(data);
  const magicId = String.fromCharCode(...rawData.slice(0, 4));

  if (magicId !== 'PSID' && magicId !== 'RSID') {
    throw new Error('Invalid SID file: Magic ID mismatch');
  }

  const version = view.getUint16(4, false); // Big endian
  const dataOffset = view.getUint16(6, false);
  const requiredHeaderSize = version >= 2 ? 0x7C : minimumHeaderSize;
  if (data.byteLength < requiredHeaderSize || dataOffset < requiredHeaderSize || dataOffset > data.byteLength) {
    throw new Error('Invalid SID file: data offset is outside the declared header');
  }
  let loadAddress = view.getUint16(8, false);
  const initAddress = view.getUint16(10, false);
  const playAddress = view.getUint16(12, false);
  const songs = view.getUint16(14, false);
  const startSong = view.getUint16(16, false);
  const speed = view.getUint32(18, false);

  if (version < 1 || version > 4) {
    throw new Error(`Unsupported SID file version: ${version}`);
  }
  if (songs < 1 || startSong < 1 || startSong > songs) {
    throw new Error('Invalid SID file: song count or start song is invalid');
  }

  const decoder = new TextDecoder('iso-8859-1');
  const title = decoder.decode(rawData.slice(0x16, 0x36)).replace(/\0/g, '');
  const author = decoder.decode(rawData.slice(0x36, 0x56)).replace(/\0/g, '');
  const released = decoder.decode(rawData.slice(0x56, 0x76)).replace(/\0/g, '');

  let flags = 0;
  if (version >= 2) {
    flags = view.getUint16(0x76, false);
  }

  // PSID v2NG clock bits are 2..3: 00 unknown, 01 PAL, 10 NTSC, 11 either.
  // Unknown/either use PAL as the deterministic fallback.
  const clockFlag = (flags >> 2) & 0x03;
  const isNtsc = clockFlag === 0x02;
  // Standard clocks
  const PAL_CLOCK = 985248;
  const NTSC_CLOCK = 1022730;

  const clockFreq = isNtsc ? NTSC_CLOCK : PAL_CLOCK;

  let memoryData = rawData.slice(dataOffset);

  // If loadAddress is 0, it is the first 2 bytes of the data
  if (loadAddress === 0) {
    if (memoryData.length < 2) {
      throw new Error('Invalid SID file: missing embedded load address');
    }
    loadAddress = memoryData[0] | (memoryData[1] << 8);
    memoryData = memoryData.slice(2);
  }
  if (memoryData.length === 0) {
    throw new Error('Invalid SID file: no C64 program data');
  }
  if (loadAddress + memoryData.length > 0x10000) {
    throw new Error('Invalid SID file: program data exceeds C64 address space');
  }

  return {
    header: {
      magic: magicId,
      version,
      dataOffset,
      loadAddress,
      initAddress,
      playAddress,
      songs,
      startSong,
      speed,
      title,
      author,
      released,
      flags,
      isNtsc,
      clockFreq,
    },
    sidData: memoryData,
  };
}
