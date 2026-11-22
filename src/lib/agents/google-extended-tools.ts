/**
 * Stage 8 — Tools backing Google Tasks, Google Contacts, Google Maps, and YouTube agents.
 * Consequential tools that mutate user data have requiresConfirmation: true.
 * Read-only discovery and retrieval tools run immediately.
 */
import { z } from "zod";
import { defineTool } from "./tools";

/* ------------------------------------------------------------------ */
/* Google Tasks Tools                                                 */
/* ------------------------------------------------------------------ */

export const tasksListTool = defineTool({
  name: "tasks.list",
  description: "List tasks from the user's Google Tasks (read-only).",
  inputSchema: z.object({
    taskListId: z.string().trim().default("@default"),
    showCompleted: z.boolean().default(true),
    limit: z.number().int().min(1).max(50).default(10),
  }),
  mock: false,
  requiresConfirmation: false,
  execute: ({ taskListId, showCompleted, limit }, ctx) =>
    ctx.google.listTasks(taskListId, showCompleted, limit),
});

export const tasksCreateTool = defineTool({
  name: "tasks.create",
  description: "Create a real task in Google Tasks. Writes to the user's real account.",
  inputSchema: z.object({
    taskListId: z.string().trim().default("@default"),
    title: z.string().trim().min(1).max(300),
    notes: z.string().trim().max(2000).optional(),
    due: z.string().trim().optional(),
  }),
  mock: false,
  requiresConfirmation: true,
  execute: (input, ctx) => ctx.google.createTask(input),
});

export const tasksCompleteTool = defineTool({
  name: "tasks.complete",
  description: "Mark a task as completed in Google Tasks. Writes to user's real account.",
  inputSchema: z.object({
    taskListId: z.string().trim().default("@default"),
    taskId: z.string().trim().min(1),
  }),
  mock: false,
  requiresConfirmation: true,
  execute: ({ taskListId, taskId }, ctx) => ctx.google.completeTask(taskListId, taskId),
});

export const tasksDeleteTool = defineTool({
  name: "tasks.delete",
  description: "Delete a task from Google Tasks. Destructive action requiring confirmation.",
  inputSchema: z.object({
    taskListId: z.string().trim().default("@default"),
    taskId: z.string().trim().min(1),
  }),
  mock: false,
  requiresConfirmation: true,
  execute: ({ taskListId, taskId }, ctx) => ctx.google.deleteTask(taskListId, taskId),
});

/* ------------------------------------------------------------------ */
/* Google Contacts (People API) Tools                                  */
/* ------------------------------------------------------------------ */

export const contactsSearchTool = defineTool({
  name: "contacts.search",
  description: "Search Google Contacts by name or email address (read-only).",
  inputSchema: z.object({
    query: z.string().trim().min(1).max(200),
    limit: z.number().int().min(1).max(20).default(5),
  }),
  mock: false,
  requiresConfirmation: false,
  execute: ({ query, limit }, ctx) => ctx.google.searchContacts(query, limit),
});

export const contactsListTool = defineTool({
  name: "contacts.list",
  description: "List recent connections in Google Contacts (read-only).",
  inputSchema: z.object({
    limit: z.number().int().min(1).max(50).default(10),
  }),
  mock: false,
  requiresConfirmation: false,
  execute: ({ limit }, ctx) => ctx.google.listContacts(limit),
});

export const contactsCreateTool = defineTool({
  name: "contacts.create",
  description: "Create a new contact in Google Contacts. Writes to user's real account.",
  inputSchema: z.object({
    givenName: z.string().trim().min(1).max(100),
    familyName: z.string().trim().max(100).optional(),
    email: z.string().trim().email().optional(),
    phone: z.string().trim().max(50).optional(),
  }),
  mock: false,
  requiresConfirmation: true,
  execute: (input, ctx) => ctx.google.createContact(input),
});

export const contactsDeleteTool = defineTool({
  name: "contacts.delete",
  description: "Delete a contact from Google Contacts. Destructive action requiring confirmation.",
  inputSchema: z.object({
    resourceName: z.string().trim().min(1),
  }),
  mock: false,
  requiresConfirmation: true,
  execute: ({ resourceName }, ctx) => ctx.google.deleteContact(resourceName),
});

/* ------------------------------------------------------------------ */
/* Google Maps Platform Tools                                         */
/* ------------------------------------------------------------------ */

export const mapsSearchPlacesTool = defineTool({
  name: "maps.search_places",
  description: "Search for places, restaurants, or locations using Google Maps.",
  inputSchema: z.object({
    query: z.string().trim().min(1).max(200),
  }),
  mock: false,
  requiresConfirmation: false,
  execute: ({ query }, ctx) => ctx.google.searchPlaces(query),
});

export const mapsPlaceDetailsTool = defineTool({
  name: "maps.place_details",
  description: "Get detailed information about a place by placeId.",
  inputSchema: z.object({
    placeId: z.string().trim().min(1),
  }),
  mock: false,
  requiresConfirmation: false,
  execute: ({ placeId }, ctx) => ctx.google.getPlaceDetails(placeId),
});

export const mapsGeocodeTool = defineTool({
  name: "maps.geocode",
  description: "Convert a street address or location name to coordinates.",
  inputSchema: z.object({
    address: z.string().trim().min(1).max(300),
  }),
  mock: false,
  requiresConfirmation: false,
  execute: ({ address }, ctx) => ctx.google.geocode(address),
});

export const mapsDirectionsTool = defineTool({
  name: "maps.directions",
  description: "Get turn-by-turn directions and route between origin and destination.",
  inputSchema: z.object({
    origin: z.string().trim().min(1).max(300),
    destination: z.string().trim().min(1).max(300),
  }),
  mock: false,
  requiresConfirmation: false,
  execute: ({ origin, destination }, ctx) => ctx.google.getDirections(origin, destination),
});

/* ------------------------------------------------------------------ */
/* YouTube Data Tools                                                 */
/* ------------------------------------------------------------------ */

export const youtubeSearchTool = defineTool({
  name: "youtube.search",
  description: "Search YouTube for educational videos, tutorials, and lectures (read-only).",
  inputSchema: z.object({
    query: z.string().trim().min(1).max(200),
    limit: z.number().int().min(1).max(25).default(5),
  }),
  mock: false,
  requiresConfirmation: false,
  execute: ({ query, limit }, ctx) => ctx.google.searchYouTubeVideos(query, limit),
});

export const youtubeVideoDetailsTool = defineTool({
  name: "youtube.video_details",
  description: "Get metadata, duration, view and like counts for a YouTube video.",
  inputSchema: z.object({
    videoId: z.string().trim().min(1),
  }),
  mock: false,
  requiresConfirmation: false,
  execute: ({ videoId }, ctx) => ctx.google.getYouTubeVideoDetails(videoId),
});

export const youtubePlaylistsTool = defineTool({
  name: "youtube.playlists",
  description: "List playlists for a channel or the user's playlists (read-only).",
  inputSchema: z.object({
    channelId: z.string().trim().default("mine"),
    limit: z.number().int().min(1).max(25).default(5),
  }),
  mock: false,
  requiresConfirmation: false,
  execute: ({ channelId, limit }, ctx) => ctx.google.listYouTubePlaylists(channelId, limit),
});

export const youtubeCreatePlaylistTool = defineTool({
  name: "youtube.create_playlist",
  description: "Create a new private playlist on YouTube. Writes to user's real account.",
  inputSchema: z.object({
    title: z.string().trim().min(1).max(150),
    description: z.string().trim().max(1000).default(""),
  }),
  mock: false,
  requiresConfirmation: true,
  execute: ({ title, description }, ctx) => ctx.google.createYouTubePlaylist(title, description),
});

export function createGoogleExtendedTools() {
  return [
    tasksListTool,
    tasksCreateTool,
    tasksCompleteTool,
    tasksDeleteTool,
    contactsSearchTool,
    contactsListTool,
    contactsCreateTool,
    contactsDeleteTool,
    mapsSearchPlacesTool,
    mapsPlaceDetailsTool,
    mapsGeocodeTool,
    mapsDirectionsTool,
    youtubeSearchTool,
    youtubeVideoDetailsTool,
    youtubePlaylistsTool,
    youtubeCreatePlaylistTool,
  ];
}

export const CONSEQUENTIAL_EXTENDED_TOOLS = [
  "tasks.create",
  "tasks.complete",
  "tasks.delete",
  "contacts.create",
  "contacts.delete",
  "youtube.create_playlist",
] as const;
