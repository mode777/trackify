#!/usr/bin/env node

import fs from 'node:fs/promises';
import path from 'node:path';

const CODEC_NAMES = new Map([
  [0, 'PSX'],
  [1, 'XBOX'],
  [2, 'NGC_DTK'],
  [3, 'PCM16BE'],
  [4, 'PCM16LE'],
  [5, 'PCM8'],
  [6, 'SDX2'],
  [7, 'DVI_IMA'],
  [8, 'MPEG'],
  [9, 'IMA'],
  [10, 'AICA'],
  [11, 'MSADPCM'],
  [12, 'NGC_DSP'],
  [13, 'PCM8_U_int'],
  [14, 'PSX_bf'],
  [15, 'MS_IMA'],
  [16, 'PCM8_U'],
  [17, 'APPLE_IMA4'],
  [18, 'ATRAC3'],
  [19, 'ATRAC3PLUS'],
  [20, 'XMA1'],
  [21, 'XMA2'],
  [22, 'FFMPEG'],
  [23, 'AC3'],
  [24, 'PCFX'],
  [25, 'PCM4'],
  [26, 'PCM4_U'],
  [27, 'OKI16'],
  [28, 'AAC'],
]);

const CODEC = Object.freeze({
  XBOX: 1,
  ATRAC3: 18,
  ATRAC3PLUS: 19,
  XMA1: 20,
  XMA2: 21,
});

function readU32LE(buffer, offset) {
  return buffer.readUInt32LE(offset);
}

function readI32LE(buffer, offset) {
  return buffer.readInt32LE(offset);
}

function readU8(buffer, offset) {
  return buffer.readUInt8(offset);
}

function parseGenh(buffer) {
  if (buffer.length < 0x24) {
    throw new Error('File is too small to contain a valid GENH header.');
  }

  const magic = buffer.toString('ascii', 0x00, 0x04);
  if (magic !== 'GENH') {
    throw new Error(`Invalid magic at 0x00: expected GENH, got ${JSON.stringify(magic)}.`);
  }

  const header = {
    magic,
    channels: readI32LE(buffer, 0x04),
    interleave: readU32LE(buffer, 0x08),
    sampleRate: readI32LE(buffer, 0x0c),
    loopStartSample: readI32LE(buffer, 0x10),
    loopEndSample: readI32LE(buffer, 0x14),
    codec: readI32LE(buffer, 0x18),
    codecName: null,
    startOffset: readU32LE(buffer, 0x1c),
    headerSize: readU32LE(buffer, 0x20),

    coefOffset: 0,
    coefSpacing: 0,
    coefInterleaveType: 0,
    coefType: 0,
    coefBigEndian: true,
    coefSplitOffset: 0,
    coefSplitSpacing: 0,

    numSamples: 0,
    skipSamples: 0,
    skipSamplesMode: 0,
    codecMode: 0,
    dataSize: 0,
    interleaveLast: 0,

    loopFlag: false,
  };

  if (header.headerSize === 0) {
    header.startOffset = 0x800;
    header.headerSize = 0x800;
  }

  if (header.headerSize > header.startOffset) {
    throw new Error(
      `Invalid header: headerSize (0x${header.headerSize.toString(16)}) is greater than startOffset (0x${header.startOffset.toString(16)}).`
    );
  }

  if (header.headerSize < 0x24) {
    throw new Error(`Invalid header: headerSize must be >= 0x24 (got 0x${header.headerSize.toString(16)}).`);
  }

  if (header.headerSize >= 0x30) {
    header.coefOffset = readU32LE(buffer, 0x24);
    if (header.channels === 2) {
      header.coefSpacing = readU32LE(buffer, 0x28) - header.coefOffset;
    } else if (header.channels > 2) {
      header.coefSpacing = readU32LE(buffer, 0x28);
    }
    header.coefInterleaveType = readU32LE(buffer, 0x2c);
  }

  if (header.headerSize >= 0x34) {
    header.coefType = readU32LE(buffer, 0x30);
    header.coefBigEndian = (header.coefType & 2) === 0;
  }

  if (header.headerSize >= 0x3c) {
    header.coefSplitOffset = readU32LE(buffer, 0x34);
    if (header.channels === 2) {
      header.coefSplitSpacing = readU32LE(buffer, 0x38) - header.coefSplitOffset;
    } else if (header.channels > 2) {
      header.coefSplitSpacing = readU32LE(buffer, 0x38);
    }
  }

  if (header.headerSize >= 0x100) {
    header.numSamples = readI32LE(buffer, 0x40);
    header.skipSamples = readI32LE(buffer, 0x44);
    header.skipSamplesMode = readU8(buffer, 0x48);
    header.codecMode = readU8(buffer, 0x4b);

    if ((header.codec === CODEC.ATRAC3 || header.codec === CODEC.ATRAC3PLUS) && header.codecMode === 0) {
      header.codecMode = readU8(buffer, 0x49);
    }
    if ((header.codec === CODEC.XMA1 || header.codec === CODEC.XMA2) && header.codecMode === 0) {
      header.codecMode = readU8(buffer, 0x4a);
    }

    header.dataSize = readU32LE(buffer, 0x50);
    header.interleaveLast = readU32LE(buffer, 0x54);
  }

  if (header.dataSize === 0) {
    header.dataSize = Math.max(0, buffer.length - header.startOffset);
  }

  if (header.numSamples <= 0) {
    header.numSamples = header.loopEndSample;
  }

  header.loopFlag = header.loopStartSample !== -1;

  if (header.codec === CODEC.XBOX && header.interleave < 0x24) {
    header.interleave = 0;
  }

  header.codecName = CODEC_NAMES.get(header.codec) || `UNKNOWN_${header.codec}`;

  return header;
}

function toHex(value) {
  if (value < 0) {
    return `-0x${Math.abs(value).toString(16)}`;
  }
  return `0x${value.toString(16)}`;
}

function printReport(filePath, fileSize, header) {
  const lines = [
    `File: ${filePath}`,
    `Size: ${fileSize} bytes`,
    '',
    'GENH Header',
    `  magic: ${header.magic}`,
    `  codec: ${header.codec} (${header.codecName})`,
    `  channels: ${header.channels}`,
    `  sample_rate: ${header.sampleRate}`,
    `  num_samples: ${header.numSamples}`,
    `  loop_flag: ${header.loopFlag ? 1 : 0}`,
    `  loop_start_sample: ${header.loopStartSample}`,
    `  loop_end_sample: ${header.loopEndSample}`,
    `  start_offset: ${header.startOffset} (${toHex(header.startOffset)})`,
    `  header_size: ${header.headerSize} (${toHex(header.headerSize)})`,
    `  data_size: ${header.dataSize} (${toHex(header.dataSize)})`,
    `  interleave: ${header.interleave} (${toHex(header.interleave)})`,
    `  interleave_last: ${header.interleaveLast} (${toHex(header.interleaveLast)})`,
    `  codec_mode: ${header.codecMode}`,
    `  skip_samples_mode: ${header.skipSamplesMode}`,
    `  skip_samples: ${header.skipSamples}`,
    '',
    'DSP Coefficients',
    `  coef_offset: ${header.coefOffset} (${toHex(header.coefOffset)})`,
    `  coef_spacing: ${header.coefSpacing}`,
    `  coef_interleave_type: ${header.coefInterleaveType}`,
    `  coef_type: ${header.coefType} (${toHex(header.coefType)})`,
    `  coef_big_endian: ${header.coefBigEndian ? 1 : 0}`,
    `  coef_split_offset: ${header.coefSplitOffset} (${toHex(header.coefSplitOffset)})`,
    `  coef_split_spacing: ${header.coefSplitSpacing}`,
  ];

  process.stdout.write(`${lines.join('\n')}\n`);
}

async function main() {
  const input = process.argv[2];
  if (!input) {
    process.stderr.write('Usage: node tools/inspect-genh.mjs <file.genh>\n');
    process.exitCode = 1;
    return;
  }

  const filePath = path.resolve(process.cwd(), input);
  const buffer = await fs.readFile(filePath);
  const header = parseGenh(buffer);
  printReport(filePath, buffer.length, header);
}

main().catch((error) => {
  process.stderr.write(`${String(error.message || error)}\n`);
  process.exitCode = 1;
});