/**
 * Stage 8 — YouTube Data API v3 service adapter.
 * Uses the official Google YouTube Data API v3.
 * Supports searching videos, retrieving video details, channel details,
 * playlists, playlist items, and creating playlists with explicit approval.
 */
import { googleApiFetch } from "./api-fetch.server";
import type {
  YouTubeChannelSummary,
  YouTubePlaylistItem,
  YouTubePlaylistSummary,
  YouTubeVideoDetails,
  YouTubeVideoSummary,
} from "./types";

const BASE = "https://www.googleapis.com/youtube/v3";

/**
 * Searches YouTube for videos matching query.
 */
export async function searchVideos(
  accessToken: string,
  query: string,
  limit: number = 10,
): Promise<YouTubeVideoSummary[]> {
  const result = await googleApiFetch<{
    items?: {
      id: { videoId?: string };
      snippet: {
        title: string;
        description: string;
        channelTitle: string;
        publishedAt: string;
        thumbnails?: { default?: { url: string }; medium?: { url: string } };
      };
    }[];
  }>(
    accessToken,
    `${BASE}/search?part=snippet&q=${encodeURIComponent(query)}&type=video&maxResults=${Math.min(limit, 25)}`,
  );

  return (result.items ?? [])
    .filter((item) => Boolean(item.id.videoId))
    .map((item) => ({
      id: item.id.videoId!,
      title: item.snippet.title,
      description: item.snippet.description,
      channelTitle: item.snippet.channelTitle,
      publishedAt: item.snippet.publishedAt,
      thumbnailUrl:
        item.snippet.thumbnails?.medium?.url ||
        item.snippet.thumbnails?.default?.url ||
        `https://img.youtube.com/vi/${item.id.videoId}/mqdefault.jpg`,
    }));
}

/**
 * Retrieves detailed metadata and statistics for a specific video.
 */
export async function getVideoDetails(
  accessToken: string,
  videoId: string,
): Promise<YouTubeVideoDetails> {
  const result = await googleApiFetch<{
    items?: {
      id: string;
      snippet: {
        title: string;
        description: string;
        channelId: string;
        channelTitle: string;
      };
      statistics?: {
        viewCount?: string;
        likeCount?: string;
      };
      contentDetails?: {
        duration?: string;
      };
    }[];
  }>(
    accessToken,
    `${BASE}/videos?part=snippet,contentDetails,statistics&id=${encodeURIComponent(videoId)}`,
  );

  const item = result.items?.[0];
  if (!item) throw new Error(`YouTube video not found: ${videoId}`);

  return {
    id: item.id,
    title: item.snippet.title,
    description: item.snippet.description,
    channelId: item.snippet.channelId,
    channelTitle: item.snippet.channelTitle,
    viewCount: item.statistics?.viewCount,
    likeCount: item.statistics?.likeCount,
    duration: item.contentDetails?.duration,
  };
}

/**
 * Retrieves channel information by channelId.
 */
export async function getChannelDetails(
  accessToken: string,
  channelId: string,
): Promise<YouTubeChannelSummary> {
  const result = await googleApiFetch<{
    items?: {
      id: string;
      snippet: { title: string; description: string };
      statistics?: { subscriberCount?: string; videoCount?: string };
    }[];
  }>(accessToken, `${BASE}/channels?part=snippet,statistics&id=${encodeURIComponent(channelId)}`);

  const item = result.items?.[0];
  if (!item) throw new Error(`YouTube channel not found: ${channelId}`);

  return {
    id: item.id,
    title: item.snippet.title,
    description: item.snippet.description,
    subscriberCount: item.statistics?.subscriberCount,
    videoCount: item.statistics?.videoCount,
  };
}

/**
 * Lists playlists for a channel, or the authenticated user's playlists (channelId="mine").
 */
export async function listPlaylists(
  accessToken: string,
  channelId: string = "mine",
  limit: number = 10,
): Promise<YouTubePlaylistSummary[]> {
  const param = channelId === "mine" ? "mine=true" : `channelId=${encodeURIComponent(channelId)}`;
  const result = await googleApiFetch<{
    items?: {
      id: string;
      snippet: { title: string; description: string };
      contentDetails?: { itemCount?: number };
    }[];
  }>(
    accessToken,
    `${BASE}/playlists?part=snippet,contentDetails&${param}&maxResults=${Math.min(limit, 50)}`,
  );

  return (result.items ?? []).map((item) => ({
    id: item.id,
    title: item.snippet.title,
    description: item.snippet.description,
    itemCount: item.contentDetails?.itemCount || 0,
  }));
}

/**
 * Lists items inside a playlist.
 */
export async function listPlaylistItems(
  accessToken: string,
  playlistId: string,
  limit: number = 20,
): Promise<YouTubePlaylistItem[]> {
  const result = await googleApiFetch<{
    items?: {
      id: string;
      snippet: {
        title: string;
        position: number;
        resourceId: { videoId?: string };
      };
    }[];
  }>(
    accessToken,
    `${BASE}/playlistItems?part=snippet&playlistId=${encodeURIComponent(playlistId)}&maxResults=${Math.min(limit, 50)}`,
  );

  return (result.items ?? []).map((item) => ({
    id: item.id,
    videoId: item.snippet.resourceId.videoId || "",
    title: item.snippet.title,
    position: item.snippet.position,
  }));
}

/**
 * Creates a new playlist for the authenticated user.
 * Callers must gate this behind explicit user approval.
 */
export async function createPlaylist(
  accessToken: string,
  title: string,
  description: string = "",
): Promise<YouTubePlaylistSummary> {
  const result = await googleApiFetch<{
    id: string;
    snippet: { title: string; description: string };
  }>(accessToken, `${BASE}/playlists?part=snippet,status`, {
    method: "POST",
    body: JSON.stringify({
      snippet: { title, description },
      status: { privacyStatus: "private" },
    }),
  });

  return {
    id: result.id,
    title: result.snippet.title,
    description: result.snippet.description,
    itemCount: 0,
  };
}
