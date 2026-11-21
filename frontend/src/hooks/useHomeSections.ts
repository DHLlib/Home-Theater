import { useQuery } from "@tanstack/react-query";
import { getHomeSections } from "../api/videos";

export function useHomeSections(enabled = true) {
  return useQuery({
    queryKey: ["homeSections"],
    queryFn: getHomeSections,
    enabled,
    retry: false,
  });
}
