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
 *   * `icon-maskable-512` — full-bleed, artwork at full size. Android crops a
 *     maskable icon to whatever shape the launcher uses, and anything outside
 *     the middle-80% safe circle may be cut — so what has to sit inside that
 *     circle is the artwork's *meaning*, not the artwork's *edges*. Scaling the
 *     whole tile down to 80% to dodge the crop is what made this icon read as a
 *     different logo from the other two: the bars stopped running off the edge,
 *     which is the one thing the mark is about. They bleed here and the crop
 *     takes their ends, which is what bleeding is supposed to look like. The
 *     rounded corners still have to go: cropping a rounded square to a circle
 *     leaves the background showing through at the diagonals.
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
 * How deep the header band runs, in the 64-unit grid the artwork is drawn on.
 *
 * This number is load-bearing and it is not a matter of taste. Every home
 * screen masks the tile, and the deepest bite any of them takes is iOS's
 * squircle at roughly 22.4% of the icon's height. At the band's original 14
 * (21.9%) the band was shorter than the bite: both of its top corners fell
 * inside the curve, nothing of its top edge survived, and the band arrived on
 * the phone as a dome. The logo looked like it was missing its top — because it
 * was, on exactly the surfaces that crop hardest, which is why the browser tab
 * still looked right and the Home Screen did not.
 *
 * 19 is 29.7%, clearing the deepest mask by about eight points. That leaves a
 * full-width flat run of band below the curve on every platform, which is the
 * thing that reads as a calendar header. Do not take this back below ~17
 * without re-checking it against a squircle.
 *
 * Keep in sync with `public/logo.svg` and `src/app/icon.svg`, which draw the
 * same mark by hand.
 */
const BAND_DEPTH = 19;

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
    <rect width="64" height="${BAND_DEPTH}" fill="${BAND}"/>
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

  // Full-bleed at full size, flattened onto the background so a launcher has no
  // transparent edge to fill with white. The safe zone is respected by where
  // the artwork puts its meaning, not by shrinking the artwork: the band and
  // both bars cross the middle-80% circle, so every launcher shape keeps the
  // parts that carry the logo and takes only the bar ends, which are drawn to
  // run off the edge anyway.
  await write(
    join(root, 'public/icon-maskable-512.png'),
    await sharp(Buffer.from(square), { density: 512 })
      .resize(512, 512)
      .flatten({ background: VOID })
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
