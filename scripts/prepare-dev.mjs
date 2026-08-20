import { stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { writeLocalImageConfig, writeCloudDevConfig } from './write-image-config.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const imagePath = path.join(root, 'public', 'webshell.ext2');

let hasImage = false;
try {
  const info = await stat(imagePath);
  hasImage = info.size >= 4 * 1024 * 1024;
} catch {}

if (hasImage) await writeLocalImageConfig();
else await writeCloudDevConfig();
