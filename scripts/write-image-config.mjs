import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const imagePath = path.join(root, 'public', 'webshell.ext2');
const generatedPath = path.join(root, 'src', 'image.generated.js');

function sha256File(filePath) {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    const input = createReadStream(filePath);
    input.on('data', (chunk) => hash.update(chunk));
    input.on('error', reject);
    input.on('end', () => resolve(hash.digest('hex')));
  });
}

export async function writeLocalImageConfig() {
  const sha256 = await sha256File(imagePath);
  const source = `// Generated at build time. Do not edit.\nexport const IMAGE_MODE = 'bytes';\nexport const IMAGE_URL = '/webshell.ext2';\nexport const OVERLAY_ID = 'webshell-root-${sha256.slice(0, 16)}';\n`;
  await writeFile(generatedPath, source, 'utf8');
  console.log(`==> Using bundled ext2 (${sha256})`);
}

export async function writeCloudDevConfig() {
  const source = `// Generated for no-image development. Do not edit.\nexport const IMAGE_MODE = 'cloud';\nexport const IMAGE_URL = 'wss://disks.webvm.io/alpine_20251007.ext2';\nexport const OVERLAY_ID = 'webshell-dev-alpine-20251007';\n`;
  await writeFile(generatedPath, source, 'utf8');
  console.log('==> Using Alpine cloud image for development');
}
