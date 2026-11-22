/**
 * Stage 8 — Specialized agents for Tasks, Contacts, Maps, and YouTube.
 * Adheres to the established BaseAgent interface, validation with Zod,
 * and gated execution for consequential actions.
 */
import { z } from "zod";
import { BaseAgent, type AgentContext, type AgentOutput, type AgentTools } from "./agent";
import { clip } from "./text-utils";
import type {
  ContactSummary,
  DirectionRoute,
  PlaceDetails,
  PlaceSummary,
  TaskSummary,
  YouTubePlaylistItem,
  YouTubePlaylistSummary,
  YouTubeVideoDetails,
  YouTubeVideoSummary,
} from "../google/types";
import type { TaskPayload } from "./types";

function plural(count: number, word: string) {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

/* ------------------------------------------------------------------ */
/* GoogleTasksAgent                                                   */
/* ------------------------------------------------------------------ */

const TasksInput = z.object({
  action: z.enum(["list", "create", "complete", "delete"]).default("list"),
  taskListId: z.string().trim().default("@default"),
  taskId: z.string().trim().optional(),
  title: z.string().trim().max(300).optional(),
  notes: z.string().trim().max(2000).optional(),
  due: z.string().trim().optional(),
  limit: z.number().int().min(1).max(50).default(10),
});

export class GoogleTasksAgent extends BaseAgent {
  readonly name = "tasks";
  readonly description =
    "Manages user tasks in Google Tasks: lists pending items, creates tasks with due dates, completes or deletes tasks.";
  readonly capabilities = [
    "list pending tasks",
    "create a task with due date",
    "mark task completed",
    "delete a task",
  ] as const;
  readonly allowedTools = ["tasks.list", "tasks.create", "tasks.complete", "tasks.delete"] as const;

  protected async execute(
    task: TaskPayload,
    ctx: AgentContext,
    tools: AgentTools,
  ): Promise<AgentOutput> {
    const input = TasksInput.parse(task.input);

    if (input.action === "create") {
      const title =
        input.title ||
        (ctx.page.selection.trim() ? clip(ctx.page.selection.trim(), 100) : null) ||
        (ctx.page.title ? `Review: ${clip(ctx.page.title, 80)}` : "Task from MindSpace");

      const created = (await tools.call("tasks.create", {
        taskListId: input.taskListId,
        title,
        notes: input.notes || (ctx.page.url ? `From: ${ctx.page.url}` : undefined),
        due: input.due,
      })) as TaskSummary;

      return {
        summary: `Created Google Task: "${clip(created.title, 60)}"${created.due ? ` due ${created.due}` : ""}.`,
        output: { task: created },
      };
    }

    if (input.action === "complete") {
      if (!input.taskId) throw new Error("Completing a task requires taskId.");
      const completed = (await tools.call("tasks.complete", {
        taskListId: input.taskListId,
        taskId: input.taskId,
      })) as TaskSummary;
      return {
        summary: `Marked task "${clip(completed.title, 60)}" as completed.`,
        output: { task: completed },
      };
    }

    if (input.action === "delete") {
      if (!input.taskId) throw new Error("Deleting a task requires taskId.");
      await tools.call("tasks.delete", {
        taskListId: input.taskListId,
        taskId: input.taskId,
      });
      return {
        summary: `Deleted task ${input.taskId} from Google Tasks.`,
        output: { deleted: true, taskId: input.taskId },
      };
    }

    // Default: list tasks
    const tasks = (await tools.call("tasks.list", {
      taskListId: input.taskListId,
      showCompleted: true,
      limit: input.limit,
    })) as TaskSummary[];

    return {
      summary: tasks.length
        ? `Found ${plural(tasks.length, "task")} in Google Tasks.`
        : "No tasks found in Google Tasks.",
      output: { tasks },
    };
  }
}
export { GoogleTasksAgent as TasksAgent };

/* ------------------------------------------------------------------ */
/* GoogleContactsAgent                                                */
/* ------------------------------------------------------------------ */

const ContactsInput = z.object({
  action: z.enum(["search", "list", "create", "delete"]).default("search"),
  query: z.string().trim().max(200).optional(),
  limit: z.number().int().min(1).max(20).default(5),
  givenName: z.string().trim().max(100).optional(),
  familyName: z.string().trim().max(100).optional(),
  email: z.string().trim().email().optional(),
  phone: z.string().trim().max(50).optional(),
  resourceName: z.string().trim().optional(),
});

export class GoogleContactsAgent extends BaseAgent {
  readonly name = "contacts";
  readonly description =
    "Finds and organizes people and connections via Google Contacts (People API).";
  readonly capabilities = [
    "search contacts by name or email",
    "list recent connections",
    "create a new contact",
    "delete a contact",
  ] as const;
  readonly allowedTools = [
    "contacts.search",
    "contacts.list",
    "contacts.create",
    "contacts.delete",
  ] as const;

  protected async execute(
    task: TaskPayload,
    _ctx: AgentContext,
    tools: AgentTools,
  ): Promise<AgentOutput> {
    const input = ContactsInput.parse(task.input);

    if (input.action === "create") {
      if (!input.givenName) throw new Error("Creating a contact requires at least a given name.");
      const contact = (await tools.call("contacts.create", {
        givenName: input.givenName,
        familyName: input.familyName,
        email: input.email,
        phone: input.phone,
      })) as ContactSummary;
      return {
        summary: `Created contact for "${contact.displayName}".`,
        output: { contact },
      };
    }

    if (input.action === "delete") {
      if (!input.resourceName) throw new Error("Deleting a contact requires resourceName.");
      await tools.call("contacts.delete", { resourceName: input.resourceName });
      return {
        summary: `Deleted contact ${input.resourceName}.`,
        output: { deleted: true, resourceName: input.resourceName },
      };
    }

    if (input.action === "list") {
      const contacts = (await tools.call("contacts.list", {
        limit: input.limit,
      })) as ContactSummary[];
      return {
        summary: contacts.length
          ? `Found ${plural(contacts.length, "contact")} in Google Contacts.`
          : "No contacts found.",
        output: { contacts },
      };
    }

    // Default: search contacts
    const q = input.query || "";
    if (!q) throw new Error("Searching contacts requires a query or name.");
    const results = (await tools.call("contacts.search", {
      query: q,
      limit: input.limit,
    })) as ContactSummary[];

    return {
      summary: results.length
        ? `Found ${plural(results.length, "matching contact")} for "${clip(q, 40)}".`
        : `No contacts found matching "${clip(q, 40)}".`,
      output: { contacts: results },
    };
  }
}
export { GoogleContactsAgent as ContactsAgent };

/* ------------------------------------------------------------------ */
/* GoogleMapsAgent                                                    */
/* ------------------------------------------------------------------ */

const MapsInput = z.object({
  action: z.enum(["search", "details", "geocode", "directions"]).default("search"),
  query: z.string().trim().max(300).optional(),
  placeId: z.string().trim().optional(),
  address: z.string().trim().max(300).optional(),
  origin: z.string().trim().max(300).optional(),
  destination: z.string().trim().max(300).optional(),
});

export class GoogleMapsAgent extends BaseAgent {
  readonly name = "maps";
  readonly description =
    "Discovers places, geocodes addresses, and calculates routes using Google Maps Platform APIs.";
  readonly capabilities = [
    "search places nearby or by query",
    "get place details and ratings",
    "geocode address to coordinates",
    "get directions and route navigation",
  ] as const;
  readonly allowedTools = [
    "maps.search_places",
    "maps.place_details",
    "maps.geocode",
    "maps.directions",
  ] as const;

  protected async execute(
    task: TaskPayload,
    _ctx: AgentContext,
    tools: AgentTools,
  ): Promise<AgentOutput> {
    const input = MapsInput.parse(task.input);

    if (input.action === "directions") {
      if (!input.origin || !input.destination) {
        throw new Error("Getting directions requires both origin and destination.");
      }
      const routes = (await tools.call("maps.directions", {
        origin: input.origin,
        destination: input.destination,
      })) as DirectionRoute[];

      const first = routes[0];
      return {
        summary: first
          ? `Route from ${input.origin} to ${input.destination}: ${first.distanceText}, ~${first.durationText}.`
          : "No routes found.",
        output: { routes },
      };
    }

    if (input.action === "details") {
      if (!input.placeId) throw new Error("Getting place details requires placeId.");
      const details = (await tools.call("maps.place_details", {
        placeId: input.placeId,
      })) as PlaceDetails;
      return {
        summary: `Place: ${details.name} (${details.formattedAddress}). Rating: ${details.rating ?? "N/A"}.`,
        output: { details },
      };
    }

    if (input.action === "geocode") {
      if (!input.address) throw new Error("Geocoding requires an address.");
      const coords = (await tools.call("maps.geocode", { address: input.address })) as unknown[];
      return {
        summary: `Geocoded "${clip(input.address, 50)}".`,
        output: { results: coords },
      };
    }

    // Default: search places
    const q = input.query || "";
    if (!q) throw new Error("Searching places requires a query.");
    const places = (await tools.call("maps.search_places", { query: q })) as PlaceSummary[];

    return {
      summary: places.length
        ? `Found ${plural(places.length, "place")} for "${clip(q, 40)}": ${places
            .slice(0, 3)
            .map((p) => p.name)
            .join(", ")}.`
        : `No places found for "${clip(q, 40)}".`,
      output: { places },
    };
  }
}
export { GoogleMapsAgent as MapsAgent };

/* ------------------------------------------------------------------ */
/* YouTubeAgent                                                       */
/* ------------------------------------------------------------------ */

const YouTubeInput = z.object({
  action: z.enum(["search", "details", "playlists", "create_playlist"]).default("search"),
  query: z.string().trim().max(300).optional(),
  videoId: z.string().trim().optional(),
  channelId: z.string().trim().default("mine"),
  title: z.string().trim().max(150).optional(),
  description: z.string().trim().max(1000).optional(),
  limit: z.number().int().min(1).max(25).default(5),
});

export class YouTubeAgent extends BaseAgent {
  readonly name = "youtube";
  readonly description =
    "Searches video tutorials, inspects lectures, and manages playlists via YouTube Data API v3.";
  readonly capabilities = [
    "search videos and tutorials",
    "inspect video details and metrics",
    "list educational playlists",
    "create a playlist",
  ] as const;
  readonly allowedTools = [
    "youtube.search",
    "youtube.video_details",
    "youtube.playlists",
    "youtube.create_playlist",
  ] as const;

  protected async execute(
    task: TaskPayload,
    _ctx: AgentContext,
    tools: AgentTools,
  ): Promise<AgentOutput> {
    const input = YouTubeInput.parse(task.input);

    if (input.action === "create_playlist") {
      if (!input.title) throw new Error("Creating a playlist requires a title.");
      const pl = (await tools.call("youtube.create_playlist", {
        title: input.title,
        description: input.description ?? "",
      })) as YouTubePlaylistSummary;
      return {
        summary: `Created YouTube playlist: "${clip(pl.title, 60)}".`,
        output: { playlist: pl },
      };
    }

    if (input.action === "details") {
      if (!input.videoId) throw new Error("Getting video details requires videoId.");
      const vid = (await tools.call("youtube.video_details", {
        videoId: input.videoId,
      })) as YouTubeVideoDetails;
      return {
        summary: `Video: "${clip(vid.title, 60)}" by ${vid.channelTitle} (${vid.viewCount ?? 0} views).`,
        output: { video: vid },
      };
    }

    if (input.action === "playlists") {
      const playlists = (await tools.call("youtube.playlists", {
        channelId: input.channelId,
        limit: input.limit,
      })) as YouTubePlaylistSummary[];
      return {
        summary: playlists.length
          ? `Found ${plural(playlists.length, "playlist")}.`
          : "No playlists found.",
        output: { playlists },
      };
    }

    // Default: search videos
    const q = input.query || "";
    if (!q) throw new Error("Searching YouTube requires a query.");
    const videos = (await tools.call("youtube.search", {
      query: q,
      limit: input.limit,
    })) as YouTubeVideoSummary[];

    return {
      summary: videos.length
        ? `Found ${plural(videos.length, "YouTube video")} for "${clip(q, 40)}": ${videos
            .slice(0, 2)
            .map((v) => `"${clip(v.title, 40)}"`)
            .join(", ")}.`
        : `No YouTube videos found for "${clip(q, 40)}".`,
      output: { videos },
    };
  }
}
export { YouTubeAgent as GoogleYouTubeAgent };
