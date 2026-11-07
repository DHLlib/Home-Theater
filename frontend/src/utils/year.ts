/**
 * 年份展示守卫。
 *
 * 资源站常把未定档的片子写成 2028 / 2030 之类的占位年份（真实数据里 40 余条）。
 * 后端 `_safe_year` 已经在上游把它拦成 None，但历史聚合行仍可能带着旧值，
 * 所以展示层再守一道：只认「今年 + 1」以内的年份，超出就当作未知，不显示。
 */
export function displayYear(year?: number | null): number | null {
  if (year == null) return null;
  const max = new Date().getFullYear() + 1;
  if (year < 1900 || year > max) return null;
  return year;
}
