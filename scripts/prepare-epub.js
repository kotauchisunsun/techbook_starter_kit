import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import config from '../vivliostyle.epub.config.js';

// Vivliostyle's EPUB writer requires the destination directory to exist.
for (const output of config.output) {
  await mkdir(dirname(output.path), { recursive: true });
}
