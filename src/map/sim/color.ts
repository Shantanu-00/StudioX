// "#RRGGBB" at an alpha, for fills drawn from a theme colour.
export function withAlpha(hex: string, a: number): string {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m) {
    return hex;
  }
  const c = (i: number) => parseInt(m[1].slice(i, i + 2), 16);
  return `rgba(${c(0)},${c(2)},${c(4)},${a})`;
}
