/**
 * Home-screen icons, from the one source in `public/logo.svg`.
 *
 * Run with `node scripts/generate-icons.mjs`. The PNGs it writes are committed,
 * so the build has no image pipeline and a clone needs nothing installed to
 * produce a correct install prompt. Re-run it only when the logo changes.
 *
 * Three shapes rather than one, because the platforms crop differently:
 *
 *   * `icon-192` / `icon-512` — the logo as drawn, rounded corners and all.
 *     What a browser shows in an install prompt and a task switcher.
 *
 *   * `icon-maskable-512` — full-bleed, artwork shrunk into the middle 80%.
 *     Android crops a maskable icon to whatever shape the launcher uses, and
 *     anything outside that safe circle is cut. The rounded corners have to go
 *     too: cropping a rounded square to a circle leaves the background showing
 *     through at the diagonals.
 *
 *   * `apple-icon` — full-bleed square, no rounding. iOS applies its own
 *     corner radius and does not remove the one already in the file, so a
 *     pre-rounded icon lands on the home screen with a dark halo at each
 *     corner.
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const VOID = '#08090a';
const BAND = '#2a2d33';

/**
 * The logo's artwork, parameterised by whether the tile is rounded.
 *
 * Inlined rather than read from `logo.svg` and patched, because the patch would
 * be a regex over markup — the thing that silently stops matching the first
 * time someone reformats the file.
 */
function tile({ rounded }) {
  const clip = rounded
    ? `<defs><clipPath id="t"><rect width="64" height="64" rx="13"/></clipPath></defs>`
    : '';
  const open = rounded ? '<g clip-path="url(#t)">' : '<g>';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64">
  ${clip}
  ${open}
    <rect width="64" height="64" fill="${VOID}"/>
    <rect width="64" height="14" fill="${BAND}"/>
    <g fill="#ffffff">
      <rect x="28" y="25" width="36" height="9"/>
      <rect y="42" width="36" height="9"/>
    </g>
  </g>
</svg>`;
}

const render = (svg, size) =>
  sharp(Buffer.from(svg), { density: 512 }).resize(size, size).png({ compressionLevel: 9 });

async function write(path, buffer) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, buffer);
  console.log(`  ${path.replace(root + '/', '')}  ${(buffer.length / 1024).toFixed(1)} kB`);
}

async function main() {
  console.log('icons:');

  const rounded = tile({ rounded: true });
  const square = tile({ rounded: false });

  await write(join(root, 'public/icon-192.png'), await render(rounded, 192).toBuffer());
  await write(join(root, 'public/icon-512.png'), await render(rounded, 512).toBuffer());

  // 80% of 512 is 410; the remaining 51px each side is the safe-zone margin
  // Android's mask eats. Composited onto the flat background rather than
  // padded, so there is no transparent edge for a launcher to fill with white.
  const inner = await render(square, 410).toBuffer();
  await write(
    join(root, 'public/icon-maskable-512.png'),
    await sharp({
      create: { width: 512, height: 512, channels: 4, background: VOID },
    })
      .composite([{ input: inner, top: 51, left: 51 }])
      .png({ compressionLevel: 9 })
      .toBuffer(),
  );

  // Next picks this up as `apple-touch-icon` from the app directory. 180 is
  // what current iPhones ask for.
  await write(join(root, 'src/app/apple-icon.png'), await render(square, 180).toBuffer());
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
