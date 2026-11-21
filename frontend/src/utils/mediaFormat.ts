export interface FormatInfo {
  isM3u8: boolean;
  isDirectVideo: boolean;
}

const UNSUPPORTED_SUFFIXES = new Set([
  "flv",
  "rmvb",
  "rm",
  "avi",
  "wmv",
  "mpeg",
  "mpg",
  "dat",
  "vob",
  "swf",
]);

export function analyzeFormat(src: string, suffix: string): FormatInfo {
  const suffixLower = suffix.toLowerCase();
  const urlLower = src.toLowerCase();
  const isM3u8 =
    suffixLower.endsWith("m3u8") ||
    suffixLower.endsWith("yun") ||
    suffixLower === "360zy" ||
    suffixLower === "ckplayer" ||
    urlLower.endsWith(".m3u8") ||
    urlLower.includes(".m3u8?");
  const isDirectVideo =
    suffixLower === "" ||
    (!isM3u8 && !UNSUPPORTED_SUFFIXES.has(suffixLower));
  return { isM3u8, isDirectVideo };
}
