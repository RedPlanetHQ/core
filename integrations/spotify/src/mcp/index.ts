/* eslint-disable @typescript-eslint/no-explicit-any */
import axios, { AxiosInstance } from 'axios';
import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';

// ─── Auth & Client ────────────────────────────────────────────────────────────

async function refreshAccessToken(
  clientId: string,
  clientSecret: string,
  refreshToken: string,
): Promise<string> {
  const response = await axios.post(
    'https://accounts.spotify.com/api/token',
    new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken }),
    {
      headers: {
        Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
    },
  );
  return response.data.access_token as string;
}

async function buildClient(
  clientId: string,
  clientSecret: string,
  config: Record<string, string>,
): Promise<AxiosInstance> {
  let accessToken = config.access_token;
  const expiresAt = config.expires_at ? parseInt(config.expires_at) : 0;

  // Refresh if expired or expiring within 60 seconds
  if (expiresAt && Date.now() > expiresAt - 60_000 && config.refresh_token) {
    accessToken = await refreshAccessToken(clientId, clientSecret, config.refresh_token);
  }

  return axios.create({
    baseURL: 'https://api.spotify.com/v1',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
  });
}

// ─── Schemas ──────────────────────────────────────────────────────────────────

// User-specific
const GetRecentlyPlayedSchema = z.object({
  limit: z.number().optional().default(20).describe('Number of items to return (1-50)'),
});

const GetSavedTracksSchema = z.object({
  limit: z.number().optional().default(20).describe('Number of saved tracks to return (1-50)'),
  offset: z.number().optional().default(0).describe('Offset for pagination'),
});

const GetUserPlaylistsSchema = z.object({
  limit: z.number().optional().default(20).describe('Number of playlists to return (1-50)'),
  offset: z.number().optional().default(0).describe('Offset for pagination'),
});

// Catalog
const SearchTracksSchema = z.object({
  query: z.string().describe('Search query string (e.g. "bohemian rhapsody" or "artist:Queen")'),
  limit: z.number().optional().default(10).describe('Number of results to return (1-50)'),
  offset: z.number().optional().default(0).describe('Offset for pagination'),
});

const GetTrackSchema = z.object({
  track_id: z.string().describe('Spotify track ID'),
});

const SearchArtistsSchema = z.object({
  query: z.string().describe('Artist name to search for'),
  limit: z.number().optional().default(10).describe('Number of results to return (1-50)'),
});

const GetArtistSchema = z.object({
  artist_id: z.string().describe('Spotify artist ID'),
});

const GetArtistTopTracksSchema = z.object({
  artist_id: z.string().describe('Spotify artist ID'),
  market: z.string().optional().default('US').describe('ISO 3166-1 alpha-2 country code'),
});

const SearchAlbumsSchema = z.object({
  query: z.string().describe('Album or artist name to search for'),
  limit: z.number().optional().default(10).describe('Number of results to return (1-50)'),
});

const GetAlbumSchema = z.object({
  album_id: z.string().describe('Spotify album ID'),
});

const GetAlbumTracksSchema = z.object({
  album_id: z.string().describe('Spotify album ID'),
  limit: z.number().optional().default(20).describe('Number of tracks to return'),
});

// ─── Tool Definitions ─────────────────────────────────────────────────────────

export function getTools() {
  return [
    // User-specific tools
    {
      name: 'get_user_profile',
      description: "Get the current user's Spotify profile",
      inputSchema: zodToJsonSchema(z.object({})),
    },
    {
      name: 'get_currently_playing',
      description: "Get the track currently playing on the user's Spotify account",
      inputSchema: zodToJsonSchema(z.object({})),
    },
    {
      name: 'get_playback_state',
      description:
        "Get the user's current playback state including device, track, progress, shuffle, and repeat status",
      inputSchema: zodToJsonSchema(z.object({})),
    },
    {
      name: 'get_recently_played',
      description: 'Get tracks recently played by the user',
      inputSchema: zodToJsonSchema(GetRecentlyPlayedSchema),
    },
    {
      name: 'get_saved_tracks',
      description: "Get tracks saved in the user's Spotify library",
      inputSchema: zodToJsonSchema(GetSavedTracksSchema),
    },
    {
      name: 'get_user_playlists',
      description: "Get the current user's playlists",
      inputSchema: zodToJsonSchema(GetUserPlaylistsSchema),
    },
    // Catalog tools
    {
      name: 'search_tracks',
      description: 'Search for tracks in the Spotify catalog',
      inputSchema: zodToJsonSchema(SearchTracksSchema),
    },
    {
      name: 'get_track',
      description: 'Get details of a specific track by Spotify track ID',
      inputSchema: zodToJsonSchema(GetTrackSchema),
    },
    {
      name: 'search_artists',
      description: 'Search for artists in the Spotify catalog',
      inputSchema: zodToJsonSchema(SearchArtistsSchema),
    },
    {
      name: 'get_artist',
      description: 'Get details of a specific artist by Spotify artist ID',
      inputSchema: zodToJsonSchema(GetArtistSchema),
    },
    {
      name: 'get_artist_top_tracks',
      description: "Get an artist's top tracks",
      inputSchema: zodToJsonSchema(GetArtistTopTracksSchema),
    },
    {
      name: 'search_albums',
      description: 'Search for albums in the Spotify catalog',
      inputSchema: zodToJsonSchema(SearchAlbumsSchema),
    },
    {
      name: 'get_album',
      description: 'Get details of a specific album by Spotify album ID',
      inputSchema: zodToJsonSchema(GetAlbumSchema),
    },
    {
      name: 'get_album_tracks',
      description: 'Get the tracks of a specific album',
      inputSchema: zodToJsonSchema(GetAlbumTracksSchema),
    },
  ];
}

// ─── Tool Dispatcher ──────────────────────────────────────────────────────────

export async function callTool(
  name: string,
  args: Record<string, any>,
  clientId: string,
  clientSecret: string,
  _redirectUri: string,
  config: Record<string, string>,
) {
  let client: AxiosInstance;

  try {
    client = await buildClient(clientId, clientSecret, config);
  } catch {
    return {
      content: [{ type: 'text', text: 'Failed to authenticate with Spotify' }],
      isError: true,
    };
  }

  try {
    let result: any = null;

    switch (name) {
      // ── User-specific ──────────────────────────────────────────────────────

      case 'get_user_profile': {
        const res = await client.get('/me');
        result = res.data;
        break;
      }

      case 'get_currently_playing': {
        const res = await client.get('/me/player/currently-playing');
        result =
          res.status === 204
            ? { playing: false, message: 'Nothing is currently playing' }
            : res.data;
        break;
      }

      case 'get_playback_state': {
        const res = await client.get('/me/player');
        result =
          res.status === 204
            ? { active: false, message: 'No active playback device found' }
            : res.data;
        break;
      }

      case 'get_recently_played': {
        const parsed = GetRecentlyPlayedSchema.parse(args);
        const res = await client.get('/me/player/recently-played', {
          params: { limit: parsed.limit },
        });
        result = res.data;
        break;
      }

      case 'get_saved_tracks': {
        const parsed = GetSavedTracksSchema.parse(args);
        const res = await client.get('/me/tracks', {
          params: { limit: parsed.limit, offset: parsed.offset },
        });
        result = res.data;
        break;
      }

      case 'get_user_playlists': {
        const parsed = GetUserPlaylistsSchema.parse(args);
        const res = await client.get('/me/playlists', {
          params: { limit: parsed.limit, offset: parsed.offset },
        });
        result = res.data;
        break;
      }

      // ── Catalog ────────────────────────────────────────────────────────────

      case 'search_tracks': {
        const parsed = SearchTracksSchema.parse(args);
        const res = await client.get('/search', {
          params: { q: parsed.query, type: 'track', limit: parsed.limit, offset: parsed.offset },
        });
        result = res.data.tracks;
        break;
      }

      case 'get_track': {
        const parsed = GetTrackSchema.parse(args);
        const res = await client.get(`/tracks/${parsed.track_id}`);
        result = res.data;
        break;
      }

      case 'search_artists': {
        const parsed = SearchArtistsSchema.parse(args);
        const res = await client.get('/search', {
          params: { q: parsed.query, type: 'artist', limit: parsed.limit },
        });
        result = res.data.artists;
        break;
      }

      case 'get_artist': {
        const parsed = GetArtistSchema.parse(args);
        const res = await client.get(`/artists/${parsed.artist_id}`);
        result = res.data;
        break;
      }

      case 'get_artist_top_tracks': {
        const parsed = GetArtistTopTracksSchema.parse(args);
        const res = await client.get(`/artists/${parsed.artist_id}/top-tracks`, {
          params: { market: parsed.market },
        });
        result = res.data;
        break;
      }

      case 'search_albums': {
        const parsed = SearchAlbumsSchema.parse(args);
        const res = await client.get('/search', {
          params: { q: parsed.query, type: 'album', limit: parsed.limit },
        });
        result = res.data.albums;
        break;
      }

      case 'get_album': {
        const parsed = GetAlbumSchema.parse(args);
        const res = await client.get(`/albums/${parsed.album_id}`);
        result = res.data;
        break;
      }

      case 'get_album_tracks': {
        const parsed = GetAlbumTracksSchema.parse(args);
        const res = await client.get(`/albums/${parsed.album_id}/tracks`, {
          params: { limit: parsed.limit },
        });
        result = res.data;
        break;
      }

      default:
        return {
          content: [{ type: 'text', text: `Unknown tool: ${name}` }],
          isError: true,
        };
    }

    return {
      content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
    };
  } catch (error: any) {
    const message =
      error.response?.data?.error?.message ||
      error.response?.data?.message ||
      error.message ||
      'Unknown error';
    return {
      content: [{ type: 'text', text: `Error calling ${name}: ${message}` }],
      isError: true,
    };
  }
}
