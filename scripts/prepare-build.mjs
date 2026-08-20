import { spawnSync } from 'node:child_process';
import { stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { writeLocalImageConfig } from './write-image-config.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const imagePath = path.join(root, 'public', 'webshell.ext2');

async function hasImage() {
  try {
    const info = await stat(imagePath);
    return info.size >= 4 * 1024 * 1024;
  } catch {
    return false;
  }
}

if (!(await hasImage())) {
  if (process.platform === 'win32') {
    console.error('\nA bundled ext2 image is required for a production build.');
    console.error('Use WSL/Linux to run `npm run image`, or let Vercel build it on Linux.');
    console.error('`npm run dev` works without WSL by using the Alpine cloud fallback.\n');
    process.exit(1);
  }

  const shell = spawnSync('bash', ['scripts/build-image.sh'], {
    cwd: root,
    stdio: 'inherit',
    env: process.env
  });
  if (shell.status !== 0) process.exit(shell.status ?? 1);
}

await writeLocalImageConfig();
