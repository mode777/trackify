import fs from 'node:fs/promises';
import path from 'node:path';
import { inflateRawSync } from 'node:zlib';

const REPO_API_LATEST =
  'https://api.github.com/repos/pocketbase/pocketbase/releases/latest';

function parseArguments() {
  const args = process.argv.slice(2);
  const result = { platform: null, arch: null };

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--platform' && i + 1 < args.length) {
      result.platform = args[++i];
    } else if (args[i] === '--arch' && i + 1 < args.length) {
      result.arch = args[++i];
    }
  }

  return result;
}

function resolveTarget(overridePlatform = null, overrideArch = null) {
  const platformMap = {
    win32: 'windows',
    linux: 'linux',
    darwin: 'darwin',
  };

  const archMap = {
    x64: 'amd64',
    arm64: 'arm64',
  };

  let platform, arch;

  if (overridePlatform) {
    if (!['windows', 'linux', 'darwin'].includes(overridePlatform)) {
      throw new Error(
        `Invalid platform: ${overridePlatform}. Must be one of: windows, linux, darwin`
      );
    }
    platform = overridePlatform;
  } else {
    platform = platformMap[process.platform];
    if (!platform) {
      throw new Error(`Unsupported platform: ${process.platform}`);
    }
  }

  if (overrideArch) {
    if (!['amd64', 'arm64'].includes(overrideArch)) {
      throw new Error(
        `Invalid architecture: ${overrideArch}. Must be one of: amd64, arm64`
      );
    }
    arch = overrideArch;
  } else {
    arch = archMap[process.arch];
    if (!arch) {
      throw new Error(`Unsupported architecture: ${process.arch}`);
    }
  }

  return { platform, arch };
}

async function fetchLatestRelease() {
  const response = await fetch(REPO_API_LATEST, {
    headers: {
      Accept: 'application/vnd.github+json',
      'User-Agent': 'trackify-download-pocketbase-script',
    },
  });

  if (!response.ok) {
    throw new Error(
      `Failed to fetch latest release metadata: ${response.status} ${response.statusText}`
    );
  }

  return response.json();
}

function findAsset(release, platform, arch) {
  const expectedNamePart = `_${platform}_${arch}.zip`;

  const asset = release.assets?.find((item) =>
    item.name?.includes(expectedNamePart)
  );

  if (!asset?.browser_download_url) {
    throw new Error(
      `No release asset found for platform=${platform}, arch=${arch}`
    );
  }

  return asset;
}

function findEndOfCentralDirectory(buffer) {
  // EOCD signature 0x06054b50 appears near the end of a ZIP archive.
  for (let i = buffer.length - 22; i >= Math.max(0, buffer.length - 65557); i--) {
    if (buffer.readUInt32LE(i) === 0x06054b50) {
      return i;
    }
  }

  throw new Error('Invalid ZIP: end of central directory not found');
}

function extractEntryBuffer(zipBuffer, entryNameMatcher) {
  const eocdOffset = findEndOfCentralDirectory(zipBuffer);
  const centralDirectorySize = zipBuffer.readUInt32LE(eocdOffset + 12);
  const centralDirectoryOffset = zipBuffer.readUInt32LE(eocdOffset + 16);

  let cursor = centralDirectoryOffset;
  const centralDirectoryEnd = centralDirectoryOffset + centralDirectorySize;

  while (cursor < centralDirectoryEnd) {
    const headerSignature = zipBuffer.readUInt32LE(cursor);
    if (headerSignature !== 0x02014b50) {
      throw new Error('Invalid ZIP: central directory header signature mismatch');
    }

    const compressionMethod = zipBuffer.readUInt16LE(cursor + 10);
    const compressedSize = zipBuffer.readUInt32LE(cursor + 20);
    const uncompressedSize = zipBuffer.readUInt32LE(cursor + 24);
    const fileNameLength = zipBuffer.readUInt16LE(cursor + 28);
    const extraLength = zipBuffer.readUInt16LE(cursor + 30);
    const commentLength = zipBuffer.readUInt16LE(cursor + 32);
    const localHeaderOffset = zipBuffer.readUInt32LE(cursor + 42);

    const fileNameStart = cursor + 46;
    const fileNameEnd = fileNameStart + fileNameLength;
    const entryName = zipBuffer.toString('utf8', fileNameStart, fileNameEnd);

    if (entryNameMatcher(entryName)) {
      const localHeaderSignature = zipBuffer.readUInt32LE(localHeaderOffset);
      if (localHeaderSignature !== 0x04034b50) {
        throw new Error('Invalid ZIP: local file header signature mismatch');
      }

      const localFileNameLength = zipBuffer.readUInt16LE(localHeaderOffset + 26);
      const localExtraLength = zipBuffer.readUInt16LE(localHeaderOffset + 28);
      const dataStart =
        localHeaderOffset + 30 + localFileNameLength + localExtraLength;
      const compressedData = zipBuffer.subarray(dataStart, dataStart + compressedSize);

      if (compressionMethod === 0) {
        return compressedData;
      }

      if (compressionMethod === 8) {
        const result = inflateRawSync(compressedData);
        if (result.length !== uncompressedSize) {
          throw new Error(
            `Invalid ZIP: unexpected uncompressed size for ${entryName}`
          );
        }
        return result;
      }

      throw new Error(
        `Unsupported ZIP compression method ${compressionMethod} for ${entryName}`
      );
    }

    cursor = fileNameEnd + extraLength + commentLength;
  }

  throw new Error('PocketBase binary not found in downloaded ZIP');
}

async function downloadAsset(url) {
  const response = await fetch(url, {
    headers: {
      Accept: 'application/octet-stream',
      'User-Agent': 'trackify-download-pocketbase-script',
    },
    redirect: 'follow',
  });

  if (!response.ok) {
    throw new Error(
      `Failed to download PocketBase binary: ${response.status} ${response.statusText}`
    );
  }

  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

async function main() {
  const args = parseArguments();
  const { platform, arch } = resolveTarget(args.platform, args.arch);
  const release = await fetchLatestRelease();
  const asset = findAsset(release, platform, arch);

  process.stdout.write(
    `Downloading ${asset.name} from release ${release.tag_name}...\n`
  );

  const zipBuffer = await downloadAsset(asset.browser_download_url);
  const binaryName = process.platform === 'win32' ? 'pocketbase.exe' : 'pocketbase';
  const binaryBuffer = extractEntryBuffer(zipBuffer, (entryName) =>
    entryName.endsWith(`/${binaryName}`) || entryName === binaryName
  );

  const binDir = path.join(process.cwd(), 'bin');
  await fs.mkdir(binDir, { recursive: true });

  const outputPath = path.join(binDir, binaryName);
  await fs.writeFile(outputPath, binaryBuffer);

  if (process.platform !== 'win32') {
    await fs.chmod(outputPath, 0o755);
  }

  process.stdout.write(`PocketBase installed at ${outputPath}\n`);
}

main().catch((error) => {
  process.stderr.write(String(error.stack || error) + '\n');
  process.exitCode = 1;
});
