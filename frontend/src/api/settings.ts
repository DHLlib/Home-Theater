import { get, put } from "./client";

export const getDownloadRoot = async (): Promise<string | null> => {
  try {
    const data = await get<{ value: string }>("/api/settings/download-root");
    return data.value;
  } catch (e: any) {
    if (e.status === 404) return null;
    throw e;
  }
};

export const setDownloadRoot = (path: string) =>
  put<{ value: string }>("/api/settings/download-root", { value: path });

export const getMaxConcurrentDownloads = async (): Promise<number> => {
  try {
    const data = await get<{ value: number }>(
      "/api/settings/max-concurrent-downloads"
    );
    return data.value;
  } catch {
    return 10;
  }
};

export const setMaxConcurrentDownloads = (value: number) =>
  put<{ value: number }>("/api/settings/max-concurrent-downloads", { value });

export const getAdFilterEnabled = async (): Promise<boolean> => {
  try {
    const data = await get<{ value: boolean }>("/api/settings/ad-filter-enabled");
    return data.value;
  } catch {
    return false;
  }
};

export const setAdFilterEnabled = (value: boolean) =>
  put<{ value: boolean }>("/api/settings/ad-filter-enabled", { value });
