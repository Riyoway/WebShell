import { stat } from 'node:fs/promises';

const imagePath = new URL('../public/webshell.ext2', import.meta.url);
const generatedPath = new URL('../src/image.generated.js', import.meta.url);

try {
  const info = await stat(imagePath);
  if (info.size < 4 * 1024 * 1024) throw new Error('disk image is unexpectedly small');
  await stat(generatedPath);
} catch (error) {
  console.error('\nMissing or incomplete WebShell disk build.');
  console.error('Run `npm run image` on Linux/WSL, or let `npm run build` generate it.\n');
  console.error(error.message);
  process.exit(1);
}
