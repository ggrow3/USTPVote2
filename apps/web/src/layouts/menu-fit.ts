/**
 * How many of the menu bar's links stay in its one row (design §10.5): all of them when they fit, otherwise as many as
 * fit, in order, beside the More button that lists the rest. Widths are as rendered, so enlarged text moves more links
 * behind More instead of wrapping the bar.
 */
export function linksInRow(linkWidths: readonly number[], moreWidth: number, available: number): number {
  // Rendered widths are fractional; half a pixel either way is rounding, not overflow.
  const fits = (width: number) => width <= available + 0.5;
  if (fits(linkWidths.reduce((sum, w) => sum + w, 0))) return linkWidths.length;
  let used = moreWidth;
  let count = 0;
  while (count < linkWidths.length && fits(used + linkWidths[count]!)) used += linkWidths[count++]!;
  return count;
}
