/**
 * Stage 8 — Google Maps Platform APIs service adapter.
 * Uses the official Google Maps Web Services:
 * - Places API (Text Search, Place Details)
 * - Geocoding API (Geocode, Reverse Geocode)
 * - Distance Matrix API
 * - Directions API
 *
 * All requests use a backend-controlled API key (GOOGLE_MAPS_API_KEY).
 * Keys are never exposed to the frontend or extension side panel.
 */
import { GoogleApiError } from "./types";
import type {
  DirectionRoute,
  DistanceResult,
  GeocodeResult,
  PlaceDetails,
  PlaceSummary,
} from "./types";

const MAPS_BASE = "https://maps.googleapis.com/maps/api";

function getApiKey(customKey?: string): string {
  const key = customKey || process.env["GOOGLE_MAPS_API_KEY"] || process.env["GOOGLE_API_KEY"];
  if (!key) {
    // If running in development/demo without an active Maps API key,
    // throw standard informative error explaining backend key configuration.
    throw new GoogleApiError(
      "Google Maps requires GOOGLE_MAPS_API_KEY configured in backend environment variables.",
      401,
    );
  }
  return key;
}

async function fetchMapsApi<T>(endpoint: string, params: Record<string, string>): Promise<T> {
  const url = new URL(`${MAPS_BASE}/${endpoint}`);
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, v);
  }
  const response = await fetch(url.toString(), {
    headers: { Accept: "application/json" },
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new GoogleApiError(
      `Google Maps API error (${response.status}): ${text.slice(0, 300)}`,
      response.status,
    );
  }
  const data = (await response.json()) as { status?: string; error_message?: string };
  if (data.status && data.status !== "OK" && data.status !== "ZERO_RESULTS") {
    throw new GoogleApiError(
      `Google Maps API status: ${data.status}. ${data.error_message || ""}`.trim(),
      400,
    );
  }
  return data as T;
}

/**
 * Searches for places matching a text query.
 */
export async function searchPlaces(query: string, apiKey?: string): Promise<PlaceSummary[]> {
  const key = getApiKey(apiKey);
  const data = await fetchMapsApi<{
    results?: {
      place_id: string;
      name: string;
      formatted_address?: string;
      geometry?: { location: { lat: number; lng: number } };
      rating?: number;
    }[];
  }>("place/textsearch/json", {
    query,
    key,
  });

  return (data.results ?? []).map((p) => ({
    placeId: p.place_id,
    name: p.name,
    formattedAddress: p.formatted_address || "",
    location: p.geometry?.location || { lat: 0, lng: 0 },
    rating: p.rating,
  }));
}

/**
 * Retrieves detailed information about a place by place_id.
 */
export async function getPlaceDetails(placeId: string, apiKey?: string): Promise<PlaceDetails> {
  const key = getApiKey(apiKey);
  const data = await fetchMapsApi<{
    result?: {
      place_id: string;
      name: string;
      formatted_address?: string;
      formatted_phone_number?: string;
      website?: string;
      rating?: number;
      geometry?: { location: { lat: number; lng: number } };
    };
  }>("place/details/json", {
    place_id: placeId,
    fields: "place_id,name,formatted_address,formatted_phone_number,website,rating,geometry",
    key,
  });

  const res = data.result;
  if (!res) throw new GoogleApiError(`Place not found: ${placeId}`, 404);

  return {
    placeId: res.place_id,
    name: res.name,
    formattedAddress: res.formatted_address || "",
    phone: res.formatted_phone_number,
    website: res.website,
    rating: res.rating,
    location: res.geometry?.location || { lat: 0, lng: 0 },
  };
}

/**
 * Geocodes an address string to geographic coordinates.
 */
export async function geocode(address: string, apiKey?: string): Promise<GeocodeResult[]> {
  const key = getApiKey(apiKey);
  const data = await fetchMapsApi<{
    results?: {
      formatted_address: string;
      place_id: string;
      geometry: { location: { lat: number; lng: number } };
    }[];
  }>("geocode/json", {
    address,
    key,
  });

  return (data.results ?? []).map((r) => ({
    formattedAddress: r.formatted_address,
    placeId: r.place_id,
    location: r.geometry.location,
  }));
}

/**
 * Reverse geocodes coordinates (lat, lng) to human-readable addresses.
 */
export async function reverseGeocode(
  lat: number,
  lng: number,
  apiKey?: string,
): Promise<GeocodeResult[]> {
  const key = getApiKey(apiKey);
  const data = await fetchMapsApi<{
    results?: {
      formatted_address: string;
      place_id: string;
      geometry: { location: { lat: number; lng: number } };
    }[];
  }>("geocode/json", {
    latlng: `${lat},${lng}`,
    key,
  });

  return (data.results ?? []).map((r) => ({
    formattedAddress: r.formatted_address,
    placeId: r.place_id,
    location: r.geometry.location,
  }));
}

/**
 * Calculates travel distance and duration between origins and destinations.
 */
export async function calculateDistance(
  origins: string[],
  destinations: string[],
  apiKey?: string,
): Promise<DistanceResult[]> {
  const key = getApiKey(apiKey);
  const data = await fetchMapsApi<{
    origin_addresses: string[];
    destination_addresses: string[];
    rows: {
      elements: {
        status: string;
        distance: { text: string; value: number };
        duration: { text: string; value: number };
      }[];
    }[];
  }>("distancematrix/json", {
    origins: origins.join("|"),
    destinations: destinations.join("|"),
    key,
  });

  const results: DistanceResult[] = [];
  data.rows.forEach((row, i) => {
    row.elements.forEach((elem, j) => {
      if (elem.status === "OK") {
        results.push({
          origin: data.origin_addresses[i] || origins[i],
          destination: data.destination_addresses[j] || destinations[j],
          distanceText: elem.distance.text,
          distanceMeters: elem.distance.value,
          durationText: elem.duration.text,
          durationSeconds: elem.duration.value,
        });
      }
    });
  });
  return results;
}

/**
 * Retrieves route directions between origin and destination.
 */
export async function getDirections(
  origin: string,
  destination: string,
  apiKey?: string,
): Promise<DirectionRoute[]> {
  const key = getApiKey(apiKey);
  const data = await fetchMapsApi<{
    routes?: {
      summary: string;
      legs: {
        distance: { text: string };
        duration: { text: string };
        steps: { html_instructions: string }[];
      }[];
    }[];
  }>("directions/json", {
    origin,
    destination,
    key,
  });

  return (data.routes ?? []).map((route) => {
    const leg = route.legs?.[0];
    const steps = (leg?.steps ?? []).map((s) => s.html_instructions.replace(/<[^>]*>/g, ""));
    return {
      summary: route.summary || "Recommended Route",
      distanceText: leg?.distance?.text || "N/A",
      durationText: leg?.duration?.text || "N/A",
      steps,
    };
  });
}
