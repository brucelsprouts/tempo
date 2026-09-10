import type { Category } from '@/lib/tempo/types';
import { barColors } from './tint';

/**
 * The category, by name, on the entry.
 *
 * Colour alone could not carry this: the palette repeats past ten, some of its
 * pairs are close as fills, and five entries called "Final Exam" in five course
 * categories have to be told apart without opening any of them. The chip is the
 * full category colour behind near-black text — 4.7:1 at worst, on plum — so it
 * stays a crisp label even on a bar tinted with the same colour.
 *
 * One component for the grid and the day panel, so the two cannot drift apart.
 * Its type is set in `globals.css` (`.bar-chip`), where the bar's width tiers
 * can resize it.
 */
export function CategoryChip({
  category,
  className = '',
}: {
  category: Category | null;
  className?: string;
}) {
  if (!category) return null;
  const { chip } = barColors(category.color);
  if (!chip) return null;
  return (
    <span
      className={`bar-chip ${className}`}
      style={{ background: chip.bg, color: chip.fg }}
      title={category.name}
    >
      {category.name}
    </span>
  );
}
