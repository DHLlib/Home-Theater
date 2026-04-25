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
