import { usePlaylistCovers } from "./usePlaylistCovers";
import type { PlaylistCovers } from "./usePlaylistCovers";

/** Song overrides remain separate from imported audio and its original embedded artwork. */
export function useSongCovers(): PlaylistCovers {
  return usePlaylistCovers("song");
}
