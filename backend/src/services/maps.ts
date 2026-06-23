import crypto from "node:crypto";
import { resolveConfig } from "./credentials.js";

export function originHash(origin: string) {
  return crypto.createHash("sha256").update(origin.trim().toLowerCase()).digest("hex");
}

export async function fetchGoogleDistanceMiles(origin: string, destination: string) {
  const key = (await resolveConfig("google_maps")).apiKey;
  if (!key) return null;
  const url = new URL("https://maps.googleapis.com/maps/api/distancematrix/json");
  url.searchParams.set("origins", origin);
  url.searchParams.set("destinations", destination);
  url.searchParams.set("units", "imperial");
  url.searchParams.set("key", key);
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Google Maps failed: ${response.status}`);
  const data = await response.json();
  const element = data.rows?.[0]?.elements?.[0];
  if (!element || element.status !== "OK") throw new Error(`Google Maps distance unavailable: ${element?.status ?? "unknown"}`);
  return {
    oneWayMiles: element.distance.value / 1609.344,
    oneWayMinutes: Math.round(element.duration.value / 60),
    source: "google_maps"
  };
}

