import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  getPlaybackFeatures,
  updatePlaybackFeatures,
} from "../api/settings";
import { toastError } from "../utils/toast";

const PLAYBACK_FEATURES_KEY = ["playback-features"] as const;

export function usePlaybackFeatures() {
  return useQuery({
    queryKey: PLAYBACK_FEATURES_KEY,
    queryFn: getPlaybackFeatures,
    retry: false,
    staleTime: 5000,
  });
}

export function useUpdatePlaybackFeatures() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: updatePlaybackFeatures,
    onSuccess: (data) => {
      queryClient.setQueryData(PLAYBACK_FEATURES_KEY, data);
    },
    onError: () => {
      toastError("保存播放与画质设置失败");
      void queryClient.invalidateQueries({ queryKey: PLAYBACK_FEATURES_KEY });
    },
  });
}
