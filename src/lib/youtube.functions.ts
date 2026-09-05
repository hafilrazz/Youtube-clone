import { createServerFn } from "@tanstack/react-start";
import { setResponseHeader } from "@tanstack/react-start/server";
import type { Video } from "./faketube-data";

// ============================================================
// This module fetches YouTube data WITHOUT using the official
// YouTube Data API. All requests go through public open-source
// frontends (Piped → Invidious), which act as unauthenticated
// proxies. No API key, no quota.
// ============================================================

function formatViews(nStr: string | undefined): string {
  const n = Number(nStr ?? 0);
  if (!n) return "0";
  if (n >= 1e9) return (n / 1e9).toFixed(1).replace(/\.0$/, "") + "B";
  if (n >= 1e6) return (n / 1e6).toFixed(1).replace(/\.0$/, "") + "M";
  if (n >= 1e3) return (n / 1e3).toFixed(1).replace(/\.0$/, "") + "K";
  return String(n);
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const s = Math.floor(diff / 1000);
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  const d = Math.floor(h / 24);
  const mo = Math.floor(d / 30);
  const y = Math.floor(d / 365);
  const p = (n: number, unit: string) => `${n} ${unit}${n > 1 ? "s" : ""} ago`;
  if (y) return p(y, "year");
  if (mo) return p(mo, "month");
  if (d) return p(d, "day");
  if (h) return p(h, "hour");
  if (m) return p(m, "minute");
  return "just now";
}

function avatar(seed: string): string {
  return `https://i.pravatar.cc/80?u=${encodeURIComponent(seed)}`;
}

function formatSeconds(sec: number): string {
  if (!sec || sec < 0) return "LIVE";
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

function stripHtml(s: string): string {
  return (s ?? "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

// ================== Piped (primary source) ==================

const PIPED_INSTANCES = [
  "https://pipedapi.kavin.rocks",
  "https://api.piped.private.coffee",
  "https://pipedapi.wireway.ch",
  "https://pipedapi.reallyaweso.me",
  "https://pipedapi.adminforge.de",
  "https://pipedapi.leptons.xyz",
  "https://pipedapi.drgns.space",
];


interface PipedItem {
  url?: string;
  type?: string;
  title?: string;
  thumbnail?: string;
  uploaderName?: string;
  uploaderUrl?: string;
  uploaderAvatar?: string;
  uploadedDate?: string;
  uploaded?: number;
  duration?: number;
  views?: number;
  shortDescription?: string;
  isShort?: boolean;
}

function pipedIdFromUrl(u: string | undefined): string {
  if (!u) return "";
  const m = u.match(/[?&]v=([\w-]{6,})/);
  return m ? m[1] : "";
}

function channelIdFromUrl(u: string | undefined): string {
  if (!u) return "";
  const m = u.match(/\/channel\/([\w-]+)/);
  return m ? m[1] : "";
}

function pipedToVideo(it: PipedItem): Video | null {
  const id = pipedIdFromUrl(it.url);
  if (!id) return null;
  const posted = it.uploadedDate
    ? it.uploadedDate
    : it.uploaded
      ? timeAgo(new Date(it.uploaded).toISOString())
      : "";
  return {
    id,
    title: it.title ?? "",
    channel: it.uploaderName ?? "",
    channelAvatar: it.uploaderAvatar || avatar(it.uploaderName ?? id),
    channelId: channelIdFromUrl(it.uploaderUrl),
    views: typeof it.views === "number" && it.views >= 0 ? formatViews(String(it.views)) : "—",
    posted,
    duration: formatSeconds(it.duration ?? 0),
    thumbnail: it.thumbnail || `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
    description: it.shortDescription ?? "",
  };
}

// In-memory cache shared across piped() and invidious() calls.
// Server functions run per-request; this cache lives for the lifetime of the
// worker instance and dramatically reduces repeat fetches to public mirrors.
const memCache = new Map<string, { at: number; ttl: number; value: unknown }>();
function cacheGet<T>(key: string): T | null {
  const hit = memCache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at > hit.ttl) {
    memCache.delete(key);
    return null;
  }
  return hit.value as T;
}
function cacheSet(key: string, value: unknown, ttlMs: number): void {
  memCache.set(key, { at: Date.now(), ttl: ttlMs, value });
  if (memCache.size > 500) {
    // Evict oldest ~100 entries
    const keys = Array.from(memCache.keys()).slice(0, 100);
    for (const k of keys) memCache.delete(k);
  }
}

async function raceFetch(bases: string[], path: string, timeoutMs = 3500): Promise<unknown> {
  const attempts = bases.map(async (base) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(`${base}${path}`, {
        headers: { "user-agent": "Mozilla/5.0" },
        signal: controller.signal,
      });
      if (!res.ok) throw new Error(`${base} → ${res.status}`);
      return await res.json();
    } finally {
      clearTimeout(timer);
    }
  });
  return Promise.any(attempts);
}

async function piped<T>(path: string, ttlMs = 5 * 60_000): Promise<T> {
  const key = `piped:${path}`;
  const cached = cacheGet<T>(key);
  if (cached) return cached;
  const value = (await raceFetch(PIPED_INSTANCES, path)) as T;
  cacheSet(key, value, ttlMs);
  return value;
}


// ================== Invidious (secondary fallback) ==================

const INVIDIOUS_INSTANCES: string[] = [
  "https://inv.nadeko.net",
  "https://invidious.nerdvpn.de",
  "https://invidious.privacyredirect.com",
  "https://iv.datura.network",
  "https://invidious.f5.si",
];


interface InvVideoItem {
  type?: string;
  videoId?: string;
  title?: string;
  author?: string;
  authorId?: string;
  authorUrl?: string;
  authorThumbnails?: { url: string; width: number }[];
  videoThumbnails?: { url: string; quality?: string; width?: number }[];
  viewCount?: number;
  viewCountText?: string;
  publishedText?: string;
  published?: number;
  lengthSeconds?: number;
  description?: string;
  descriptionHtml?: string;
  liveNow?: boolean;
  isUpcoming?: boolean;
}

function invAvatar(list: { url: string; width: number }[] | undefined, seed: string): string {
  if (!list || !list.length) return avatar(seed);
  const sorted = [...list].sort((a, b) => (b.width ?? 0) - (a.width ?? 0));
  const u = sorted[0].url;
  return u.startsWith("//") ? `https:${u}` : u;
}

function invThumb(list: { url: string; quality?: string; width?: number }[] | undefined, id: string): string {
  if (!list || !list.length) return `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;
  const pick =
    list.find((t) => t.quality === "maxresdefault") ??
    list.find((t) => t.quality === "hqdefault") ??
    list.find((t) => t.quality === "high") ??
    list[0];
  const u = pick.url;
  return u.startsWith("//") ? `https:${u}` : u;
}

function invToVideo(it: InvVideoItem): Video | null {
  const id = it.videoId;
  if (!id) return null;
  return {
    id,
    title: it.title ?? "",
    channel: it.author ?? "",
    channelAvatar: invAvatar(it.authorThumbnails, it.author ?? id),
    channelId: it.authorId ?? "",
    views:
      typeof it.viewCount === "number" && it.viewCount >= 0
        ? formatViews(String(it.viewCount))
        : it.viewCountText ?? "—",
    posted: it.publishedText ?? (it.published ? timeAgo(new Date(it.published * 1000).toISOString()) : ""),
    duration: it.liveNow ? "LIVE" : formatSeconds(it.lengthSeconds ?? 0),
    thumbnail: invThumb(it.videoThumbnails, id),
    description: it.description ?? "",
  };
}

async function invidious<T>(path: string, ttlMs = 5 * 60_000): Promise<T> {
  const key = `inv:${path}`;
  const cached = cacheGet<T>(key);
  if (cached) return cached;
  const value = (await raceFetch(INVIDIOUS_INSTANCES, path)) as T;
  cacheSet(key, value, ttlMs);
  return value;
}

// ================== YouTube Data API v3 (final fallback) ==================
// Used only when Piped and Invidious both fail. Requires YOUTUBE_API_KEY.

interface YTSearchItem {
  id?: { videoId?: string };
  snippet?: {
    title?: string;
    description?: string;
    channelTitle?: string;
    channelId?: string;
    publishedAt?: string;
    thumbnails?: { high?: { url?: string }; medium?: { url?: string }; default?: { url?: string } };
    liveBroadcastContent?: string;
  };
}
interface YTVideoItem {
  id?: string;
  snippet?: YTSearchItem["snippet"];
  contentDetails?: { duration?: string };
  statistics?: { viewCount?: string };
  liveStreamingDetails?: unknown;
}

function ytKey(): string | null {
  const k = process.env.YOUTUBE_API_KEY || process.env.GOOGLE_API_KEY;
  return k && k.length > 10 ? k : null;
}

async function ytFetch<T>(path: string): Promise<T> {
  const key = ytKey();
  if (!key) throw new Error("YouTube API key not configured");
  const sep = path.includes("?") ? "&" : "?";
  const url = `https://www.googleapis.com/youtube/v3${path}${sep}key=${key}`;
  const cacheKey = `yt:${path}`;
  const cached = cacheGet<T>(cacheKey);
  if (cached) return cached;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`YT API ${res.status}`);
  const j = (await res.json()) as T;
  cacheSet(cacheKey, j, 5 * 60_000);
  return j;
}

function parseIsoDuration(iso: string | undefined): number {
  if (!iso) return 0;
  const m = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!m) return 0;
  return (Number(m[1] ?? 0) * 3600) + (Number(m[2] ?? 0) * 60) + Number(m[3] ?? 0);
}

function ytSearchToVideo(it: YTSearchItem): Video | null {
  const id = it.id?.videoId;
  if (!id) return null;
  const sn = it.snippet ?? {};
  const isLive = sn.liveBroadcastContent === "live";
  return {
    id,
    title: sn.title ?? "",
    channel: sn.channelTitle ?? "",
    channelAvatar: avatar(sn.channelId ?? sn.channelTitle ?? id),
    channelId: sn.channelId ?? "",
    views: "—",
    posted: sn.publishedAt ? timeAgo(sn.publishedAt) : "",
    duration: isLive ? "LIVE" : "",
    thumbnail: sn.thumbnails?.high?.url || sn.thumbnails?.medium?.url || `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
    description: sn.description ?? "",
  };
}

function ytVideoToVideo(it: YTVideoItem): Video | null {
  const id = it.id;
  if (!id) return null;
  const sn = it.snippet ?? {};
  const isLive = sn.liveBroadcastContent === "live" || Boolean(it.liveStreamingDetails);
  const dur = parseIsoDuration(it.contentDetails?.duration);
  return {
    id,
    title: sn.title ?? "",
    channel: sn.channelTitle ?? "",
    channelAvatar: avatar(sn.channelId ?? sn.channelTitle ?? id),
    channelId: sn.channelId ?? "",
    views: it.statistics?.viewCount ? formatViews(it.statistics.viewCount) : "—",
    posted: sn.publishedAt ? timeAgo(sn.publishedAt) : "",
    duration: isLive ? "LIVE" : formatSeconds(dur),
    thumbnail: sn.thumbnails?.high?.url || `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
    description: sn.description ?? "",
  };
}


// ================== InnerTube (YouTube's own guest API) ==================
// Keyless from our side: uses YouTube's public web-client key that ships in
// every youtube.com page. No API-key registration, no per-project quota — this
// is the same endpoint the youtube.com web app itself calls.

const INNERTUBE_KEY = "AIzaSyAO_FL9IsIrOS3wgxHhpkGkY74dxHb0X8Y";
const INNERTUBE_CLIENT_VERSION = "2.20240726.00.00";

const INNERTUBE_CONTEXT = {
  client: {
    clientName: "WEB",
    clientVersion: "2.20240726.00.00",
    hl: "en",
    gl: "US",
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Safari/537.36,gzip(gfe)",
  },
};

async function innertube<T = unknown>(endpoint: string, body: Record<string, unknown>): Promise<T | null> {
  const cacheKey = `it:${endpoint}:${JSON.stringify(body)}`;
  const cached = cacheGet<T>(cacheKey);
  if (cached) return cached;
  try {
    const res = await fetch(
      `https://www.youtube.com/youtubei/v1/${endpoint}?key=${INNERTUBE_KEY}&prettyPrint=false`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-youtube-client-name": "1",
          "x-youtube-client-version": "2.20240726.00.00",
          "accept-language": "en-US,en;q=0.9",
          origin: "https://www.youtube.com",
          referer: "https://www.youtube.com/",
          "user-agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Safari/537.36",
        },
        body: JSON.stringify({ context: INNERTUBE_CONTEXT, ...body }),
      },
    );
    if (!res.ok) return null;
    const j = (await res.json()) as T;
    cacheSet(cacheKey, j, 5 * 60_000);
    return j;
  } catch {
    return null;
  }
}

function findContinuationToken(node: unknown): string | undefined {
  if (!node) return undefined;
  if (Array.isArray(node)) {
    for (const n of node) {
      const t = findContinuationToken(n);
      if (t) return t;
    }
    return undefined;
  }
  if (typeof node !== "object") return undefined;
  const obj = node as Record<string, unknown>;
  // Only the "load more results" token lives inside continuationItemRenderer.
  // Other continuationCommand tokens (chip filters, menus) must be ignored.
  const cir = obj.continuationItemRenderer as
    | { continuationEndpoint?: { continuationCommand?: { token?: string } } }
    | undefined;
  const t = cir?.continuationEndpoint?.continuationCommand?.token;
  if (t) return t;
  for (const k in obj) {
    const found = findContinuationToken(obj[k]);
    if (found) return found;
  }
  return undefined;
}

async function innertubeSearch(q: string, continuation?: string, params?: string): Promise<{ items: Video[]; nextPageToken?: string }> {
  const body: Record<string, unknown> = continuation
    ? { continuation }
    : { query: q, params: params || "EgIQAQ%3D%3D" }; // default filter: videos

  const j = await innertube<unknown>("search", body);
  if (!j) return { items: [] };
  const renderers: YtVideoRenderer[] = [];
  walkVideoRenderers(j, renderers);
  const seen = new Set<string>();
  const out: Video[] = [];
  for (const r of renderers) {
    const v = ytRendererToVideo(r);
    if (v && !seen.has(v.id)) { seen.add(v.id); out.push(v); }
  }
  return { items: out, nextPageToken: findContinuationToken(j) };
}

async function innertubeTrending(): Promise<Video[]> {
  const j = await innertube<unknown>("browse", { browseId: "FEtrending" });
  if (!j) return [];
  const renderers: YtVideoRenderer[] = [];
  walkVideoRenderers(j, renderers);
  const seen = new Set<string>();
  const out: Video[] = [];
  for (const r of renderers) {
    const v = ytRendererToVideo(r);
    if (v && !seen.has(v.id)) { seen.add(v.id); out.push(v); }
  }
  return out;
}

interface ItNextResponse {
  contents?: {
    twoColumnWatchNextResults?: {
      results?: { results?: { contents?: unknown[] } };
      secondaryResults?: { secondaryResults?: { results?: unknown[] } };
    };
  };
  videoDetails?: {
    videoId?: string;
    title?: string;
    shortDescription?: string;
    lengthSeconds?: string;
    viewCount?: string;
    author?: string;
    channelId?: string;
    thumbnail?: { thumbnails?: YtThumb[] };
  };
}

async function innertubeWatch(id: string): Promise<{ video: Video | null; related: Video[] }> {
  const j = await innertube<ItNextResponse>("next", { videoId: id });
  if (!j) return { video: null, related: [] };
  let video: Video | null = null;
  const vd = j.videoDetails;
  if (vd?.videoId) {
    const thumbs = vd.thumbnail?.thumbnails ?? [];
    video = {
      id: vd.videoId,
      title: vd.title ?? "",
      channel: vd.author ?? "",
      channelAvatar: avatar(vd.author ?? vd.videoId),
      channelId: vd.channelId ?? "",
      views: vd.viewCount ? formatViews(vd.viewCount) : "—",
      posted: "",
      duration: vd.lengthSeconds ? formatSeconds(Number(vd.lengthSeconds)) : "",
      thumbnail: thumbs.length ? thumbs[thumbs.length - 1].url! : `https://i.ytimg.com/vi/${vd.videoId}/hqdefault.jpg`,
      description: vd.shortDescription ?? "",
    };
  }
  const secondary = j.contents?.twoColumnWatchNextResults?.secondaryResults?.secondaryResults?.results ?? [];
  const renderers: YtVideoRenderer[] = [];
  walkVideoRenderers(secondary, renderers);
  const seen = new Set<string>();
  const related: Video[] = [];
  for (const r of renderers) {
    const v = ytRendererToVideo(r);
    if (v && v.id !== id && !seen.has(v.id)) { seen.add(v.id); related.push(v); }
  }
  return { video, related: related.slice(0, 20) };
}





// ================== Keyless YouTube HTML scrape ==================
// Parses ytInitialData from youtube.com search HTML. No API key, no quota.

interface YtRun { text?: string }
interface YtRuns { runs?: YtRun[]; simpleText?: string }
interface YtThumb { url?: string; width?: number }
interface YtVideoRenderer {
  videoId?: string;
  title?: YtRuns;
  longBylineText?: { runs?: { text?: string; navigationEndpoint?: { browseEndpoint?: { browseId?: string } } }[] };
  shortBylineText?: { runs?: { text?: string }[] };
  publishedTimeText?: YtRuns;
  lengthText?: YtRuns;
  viewCountText?: YtRuns;
  shortViewCountText?: YtRuns;
  thumbnail?: { thumbnails?: YtThumb[] };
  channelThumbnailSupportedRenderers?: {
    channelThumbnailWithLinkRenderer?: { thumbnail?: { thumbnails?: YtThumb[] } };
  };
  descriptionSnippet?: YtRuns;
  badges?: unknown;
  ownerBadges?: unknown;
}

function runsToText(r: YtRuns | undefined): string {
  if (!r) return "";
  if (r.simpleText) return r.simpleText;
  return (r.runs ?? []).map((x) => x.text ?? "").join("");
}

function parseViews(s: string): string {
  const m = s.match(/([\d,.]+)\s*([KMB]?)/i);
  if (!m) return s || "—";
  const n = Number(m[1].replace(/,/g, ""));
  if (!isFinite(n)) return s;
  const mul = m[2].toUpperCase() === "K" ? 1e3 : m[2].toUpperCase() === "M" ? 1e6 : m[2].toUpperCase() === "B" ? 1e9 : 1;
  return formatViews(String(Math.round(n * mul)));
}

function ytRendererToVideo(r: YtVideoRenderer): Video | null {
  const id = r.videoId;
  if (!id) return null;
  const channel = runsToText(r.longBylineText as YtRuns | undefined) || (r.shortBylineText?.runs?.[0]?.text ?? "");
  const chAvatar =
    r.channelThumbnailSupportedRenderers?.channelThumbnailWithLinkRenderer?.thumbnail?.thumbnails?.[0]?.url;
  const chId = r.longBylineText?.runs?.find((x) => x.navigationEndpoint?.browseEndpoint?.browseId)
    ?.navigationEndpoint?.browseEndpoint?.browseId ?? "";
  const thumbs = r.thumbnail?.thumbnails ?? [];
  const thumb = thumbs.length ? thumbs[thumbs.length - 1].url : `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;
  const viewsRaw = runsToText(r.viewCountText) || runsToText(r.shortViewCountText);
  const duration = runsToText(r.lengthText);
  return {
    id,
    title: runsToText(r.title),
    channel,
    channelAvatar: chAvatar || avatar(channel || id),
    channelId: chId,
    views: viewsRaw ? parseViews(viewsRaw.replace(/\s*views?/i, "")) : "—",
    posted: runsToText(r.publishedTimeText),
    duration: duration || "",
    thumbnail: thumb ?? `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
    description: runsToText(r.descriptionSnippet),
  };
}

async function ytScrapeHtml(url: string): Promise<unknown | null> {
  const cacheKey = `scrape:${url}`;
  const cached = cacheGet<unknown>(cacheKey);
  if (cached) return cached;
  try {
    const res = await fetch(url, {
      headers: {
        "user-agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Safari/537.36",
        "accept-language": "en-US,en;q=0.9",
        cookie: "CONSENT=YES+cb; SOCS=CAI",
      },
    });
    if (!res.ok) return null;
    const html = await res.text();
    const m = html.match(/var\s+ytInitialData\s*=\s*(\{.+?\});\s*<\/script>/s);
    if (!m) return null;
    const data = JSON.parse(m[1]);
    cacheSet(cacheKey, data, 5 * 60_000);
    return data;
  } catch {
    return null;
  }
}

function walkVideoRenderers(node: unknown, out: YtVideoRenderer[]): void {
  if (!node) return;
  if (Array.isArray(node)) { for (const n of node) walkVideoRenderers(n, out); return; }
  if (typeof node !== "object") return;
  const obj = node as Record<string, unknown>;
  if (obj.videoRenderer) out.push(obj.videoRenderer as YtVideoRenderer);
  if (obj.compactVideoRenderer) out.push(obj.compactVideoRenderer as YtVideoRenderer);
  for (const k in obj) walkVideoRenderers(obj[k], out);
}

async function ytScrapeSearch(q: string): Promise<Video[]> {
  const data = await ytScrapeHtml(`https://www.youtube.com/results?search_query=${encodeURIComponent(q)}&hl=en&gl=US`);
  if (!data) return [];
  const renderers: YtVideoRenderer[] = [];
  walkVideoRenderers(data, renderers);
  const seen = new Set<string>();
  const videos: Video[] = [];
  for (const r of renderers) {
    const v = ytRendererToVideo(r);
    if (v && !seen.has(v.id)) { seen.add(v.id); videos.push(v); }
  }
  return videos;
}

async function ytScrapeTrending(): Promise<Video[]> {
  const data = await ytScrapeHtml(`https://www.youtube.com/feed/trending?hl=en&gl=US`);
  if (!data) return [];
  const renderers: YtVideoRenderer[] = [];
  walkVideoRenderers(data, renderers);
  const seen = new Set<string>();
  const videos: Video[] = [];
  for (const r of renderers) {
    const v = ytRendererToVideo(r);
    if (v && !seen.has(v.id)) { seen.add(v.id); videos.push(v); }
  }
  return videos;
}


// ================== Trending ==================

export const getTrending = createServerFn({ method: "GET" })
  .inputValidator((d: { category?: string; region?: string }) => ({
    category: d?.category ?? "All",
    region: d?.region ?? "US",
  }))
  .handler(async ({ data }): Promise<Video[]> => {
    setResponseHeader("cache-control", "public, max-age=300, s-maxage=600, stale-while-revalidate=1800");

    const isTrending = data.category === "All" || data.category === "Trending";

    // Primary: InnerTube (YouTube's own guest API — single fast endpoint, no key, no quota)
    try {
      const it = isTrending ? await innertubeTrending() : (await innertubeSearch(data.category)).items;
      if (it.length) return it.slice(0, 32);
    } catch (e) {
      console.warn("InnerTube trending failed:", (e as Error).message);
    }

    // Secondary: Piped (raced across mirrors)
    try {
      if (isTrending) {
        const items = await piped<PipedItem[]>(`/trending?region=${encodeURIComponent(data.region)}`);
        const videos = items.map(pipedToVideo).filter((v): v is Video => Boolean(v));
        if (videos.length) return videos.slice(0, 32);
      } else {
        const res = await piped<{ items?: PipedItem[] }>(
          `/search?q=${encodeURIComponent(data.category)}&filter=videos`,
        );
        const videos = (res.items ?? []).map(pipedToVideo).filter((v): v is Video => Boolean(v));
        if (videos.length) return videos.slice(0, 32);
      }
    } catch (e) {
      console.warn("Piped trending failed:", (e as Error).message);
    }

    // Tertiary: Invidious
    try {
      if (isTrending) {
        const items = await invidious<InvVideoItem[]>(
          `/api/v1/trending?region=${encodeURIComponent(data.region)}`,
        );
        const videos = items.map(invToVideo).filter((v): v is Video => Boolean(v));
        if (videos.length) return videos.slice(0, 32);
      } else {
        const items = await invidious<InvVideoItem[]>(
          `/api/v1/search?q=${encodeURIComponent(data.category)}&type=video&sort_by=relevance`,
        );
        const videos = items.map(invToVideo).filter((v): v is Video => Boolean(v));
        if (videos.length) return videos.slice(0, 32);
      }
    } catch (e) {
      console.warn("Invidious trending failed:", (e as Error).message);
    }

    // Quaternary: keyless YouTube HTML scrape
    try {
      const scraped = isTrending
        ? await ytScrapeTrending()
        : await ytScrapeSearch(data.category);
      if (scraped.length) return scraped.slice(0, 32);
    } catch (e) {
      console.warn("YT scrape trending failed:", (e as Error).message);
    }



    // Tertiary: YouTube Data API
    try {
      if (isTrending) {
        const j = await ytFetch<{ items?: YTVideoItem[] }>(
          `/videos?part=snippet,contentDetails,statistics&chart=mostPopular&maxResults=32&regionCode=${encodeURIComponent(data.region)}`,
        );
        const videos = (j.items ?? []).map(ytVideoToVideo).filter((v): v is Video => Boolean(v));
        if (videos.length) return videos;
      } else {
        const s = await ytFetch<{ items?: YTSearchItem[] }>(
          `/search?part=snippet&type=video&maxResults=32&q=${encodeURIComponent(data.category)}`,
        );
        const ids = (s.items ?? []).map((it) => it.id?.videoId).filter((x): x is string => Boolean(x));
        if (ids.length) {
          const d = await ytFetch<{ items?: YTVideoItem[] }>(
            `/videos?part=snippet,contentDetails,statistics&id=${encodeURIComponent(ids.join(","))}`,
          );
          const videos = (d.items ?? []).map(ytVideoToVideo).filter((v): v is Video => Boolean(v));
          if (videos.length) return videos;
        }
      }
    } catch (e) {
      console.warn("YT API trending failed:", (e as Error).message);
    }

    return [];
  });


// ================== Search ==================

export const searchYouTube = createServerFn({ method: "GET" })
  .inputValidator((d: { q: string; limit?: number; pageToken?: string; params?: string }) => ({
    q: String(d?.q ?? "").slice(0, 120),
    limit: Math.min(Math.max(Number(d?.limit ?? 20), 1), 50),
    pageToken: d?.pageToken ? String(d.pageToken) : "",
    params: d?.params ? String(d.params) : "",
  }))

  .handler(async ({ data }): Promise<{ items: Video[]; nextPageToken?: string; prevPageToken?: string; quotaExceeded?: boolean }> => {
    if (!data.q.trim()) return { items: [] };
    setResponseHeader("cache-control", "public, max-age=600, s-maxage=1800, stale-while-revalidate=3600");

    // Primary: InnerTube (fastest — one direct call to youtube.com, no key, no quota).
    // Supports pagination via continuation tokens prefixed with "it:".
    try {
      const isIt = !data.pageToken || data.pageToken.startsWith("it:");
      if (isIt) {
        const cont = data.pageToken ? data.pageToken.slice(3) : undefined;
        const it = await innertubeSearch(data.q, cont);
        if (it.items.length) {
          return {
            items: it.items.slice(0, data.limit),
            nextPageToken: it.nextPageToken ? `it:${it.nextPageToken}` : undefined,
          };
        }
      }
    } catch (e) {
      console.warn("InnerTube search failed:", (e as Error).message);
    }

    // Secondary: Piped (supports pagination)
    try {
      const path = data.pageToken
        ? `/nextpage/search?nextpage=${encodeURIComponent(data.pageToken)}&q=${encodeURIComponent(data.q)}&filter=videos`
        : `/search?q=${encodeURIComponent(data.q)}&filter=videos`;
      const res = await piped<{ items?: PipedItem[]; nextpage?: string | null }>(path);
      const items = (res.items ?? [])
        .filter((it) => !it.type || it.type === "stream")
        .map(pipedToVideo)
        .filter((v): v is Video => Boolean(v))
        .slice(0, data.limit);
      if (items.length) {
        return {
          items,
          nextPageToken: res.nextpage ? String(res.nextpage) : undefined,
        };
      }
    } catch (e) {
      console.warn("Piped search failed:", (e as Error).message);
    }

    // Tertiary: Invidious (first page only)
    if (!data.pageToken) {
      try {
        const items = await invidious<InvVideoItem[]>(
          `/api/v1/search?q=${encodeURIComponent(data.q)}&type=video`,
        );
        const mapped = items
          .filter((it) => !it.type || it.type === "video")
          .map(invToVideo)
          .filter((v): v is Video => Boolean(v))
          .slice(0, data.limit);
        if (mapped.length) return { items: mapped };
      } catch (e) {
        console.warn("Invidious search failed:", (e as Error).message);
      }
    }

    // Quaternary: keyless YouTube HTML scrape
    if (!data.pageToken) {
      try {
        const scraped = await ytScrapeSearch(data.q);
        if (scraped.length) return { items: scraped.slice(0, data.limit) };
      } catch (e) {
        console.warn("YT scrape search failed:", (e as Error).message);
      }
    }



    // Tertiary: YouTube Data API
    try {
      const s = await ytFetch<{ items?: YTSearchItem[]; nextPageToken?: string; prevPageToken?: string }>(
        `/search?part=snippet&type=video&maxResults=${data.limit}&q=${encodeURIComponent(data.q)}${data.pageToken ? `&pageToken=${encodeURIComponent(data.pageToken)}` : ""}`,
      );
      const ids = (s.items ?? []).map((it) => it.id?.videoId).filter((x): x is string => Boolean(x));
      if (ids.length) {
        const d = await ytFetch<{ items?: YTVideoItem[] }>(
          `/videos?part=snippet,contentDetails,statistics&id=${encodeURIComponent(ids.join(","))}`,
        );
        const map = new Map<string, Video>();
        for (const it of d.items ?? []) {
          const v = ytVideoToVideo(it);
          if (v) map.set(v.id, v);
        }
        const items = ids.map((id) => map.get(id)).filter((v): v is Video => Boolean(v));
        if (items.length) return { items, nextPageToken: s.nextPageToken, prevPageToken: s.prevPageToken };
      }
    } catch (e) {
      const msg = (e as Error).message;
      console.warn("YT API search failed:", msg);
      if (/403|429|quota/i.test(msg)) return { items: [], quotaExceeded: true };
    }

    return { items: [] };

  });

// ================== Search suggestions ==================

export const suggestSearch = createServerFn({ method: "GET" })
  .inputValidator((d: { q: string }) => ({ q: String(d?.q ?? "").slice(0, 100) }))
  .handler(async ({ data }): Promise<string[]> => {
    const q = data.q.trim();
    if (!q) return [];
    setResponseHeader("cache-control", "public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800");
    const url = `https://suggestqueries.google.com/complete/search?client=firefox&ds=yt&q=${encodeURIComponent(q)}`;
    try {
      const res = await fetch(url, { headers: { "user-agent": "Mozilla/5.0" } });
      if (!res.ok) return [];
      const j = (await res.json()) as [string, string[]];
      return Array.isArray(j?.[1]) ? j[1].slice(0, 10) : [];
    } catch {
      return [];
    }
  });

// ================== Watch page (video + related) ==================

export const getYouTubeVideo = createServerFn({ method: "GET" })
  .inputValidator((d: { id: string }) => ({ id: String(d?.id ?? "") }))
  .handler(async ({ data }): Promise<{ video: Video | null; related: Video[] }> => {
    if (!data.id) return { video: null, related: [] };
    setResponseHeader("cache-control", "public, max-age=600, s-maxage=3600, stale-while-revalidate=86400");

    // Primary: InnerTube (fastest — YouTube's own guest API, no key, no quota)
    try {
      const r = await innertubeWatch(data.id);
      if (r.video || r.related.length) return r;
    } catch (e) {
      console.warn("InnerTube watch failed:", (e as Error).message);
    }

    // Secondary: Piped /streams/{id}
    try {
      const s = await piped<{
        title?: string;
        description?: string;
        uploadDate?: string;
        uploader?: string;
        uploaderUrl?: string;
        uploaderAvatar?: string;
        duration?: number;
        views?: number;
        thumbnailUrl?: string;
        relatedStreams?: PipedItem[];
        livestream?: boolean;
      }>(`/streams/${encodeURIComponent(data.id)}`);

      const video: Video = {
        id: data.id,
        title: s.title ?? "",
        channel: s.uploader ?? "",
        channelAvatar: s.uploaderAvatar || avatar(s.uploader ?? data.id),
        channelId: channelIdFromUrl(s.uploaderUrl),
        views: typeof s.views === "number" && s.views >= 0 ? formatViews(String(s.views)) : "—",
        posted: s.uploadDate ?? "",
        duration: s.livestream ? "LIVE" : formatSeconds(s.duration ?? 0),
        thumbnail: s.thumbnailUrl || `https://i.ytimg.com/vi/${data.id}/hqdefault.jpg`,
        description: stripHtml(s.description ?? ""),
      };

      const related = (s.relatedStreams ?? [])
        .filter((it) => !it.type || it.type === "stream")
        .map(pipedToVideo)
        .filter((v): v is Video => Boolean(v) && v!.id !== data.id)
        .slice(0, 20);

      return { video, related };
    } catch (e) {
      console.warn("Piped /streams failed:", (e as Error).message);
    }

    // Tertiary: Invidious /api/v1/videos/{id}
    try {
      const s = await invidious<{
        title?: string;
        description?: string;
        descriptionHtml?: string;
        publishedText?: string;
        author?: string;
        authorId?: string;
        authorThumbnails?: { url: string; width: number }[];
        lengthSeconds?: number;
        viewCount?: number;
        videoThumbnails?: { url: string; quality?: string; width?: number }[];
        recommendedVideos?: InvVideoItem[];
        liveNow?: boolean;
      }>(`/api/v1/videos/${encodeURIComponent(data.id)}`);

      const video: Video = {
        id: data.id,
        title: s.title ?? "",
        channel: s.author ?? "",
        channelAvatar: invAvatar(s.authorThumbnails, s.author ?? data.id),
        channelId: s.authorId ?? "",
        views:
          typeof s.viewCount === "number" && s.viewCount >= 0
            ? formatViews(String(s.viewCount))
            : "—",
        posted: s.publishedText ?? "",
        duration: s.liveNow ? "LIVE" : formatSeconds(s.lengthSeconds ?? 0),
        thumbnail: invThumb(s.videoThumbnails, data.id),
        description: stripHtml(s.description ?? ""),
      };

      const related = (s.recommendedVideos ?? [])
        .map(invToVideo)
        .filter((v): v is Video => v !== null && v.id !== data.id)
        .slice(0, 20);

      return { video, related };
    } catch (e) {
      console.warn("Invidious /videos failed:", (e as Error).message);
    }


    // Quaternary: YouTube Data API
    try {
      const d = await ytFetch<{ items?: YTVideoItem[] }>(
        `/videos?part=snippet,contentDetails,statistics,liveStreamingDetails&id=${encodeURIComponent(data.id)}`,
      );
      const it = d.items?.[0];
      if (it) {
        const video = ytVideoToVideo(it);
        if (video) {
          let related: Video[] = [];
          try {
            const q = video.title.split(/\s+/).slice(0, 5).join(" ");
            const s = await ytFetch<{ items?: YTSearchItem[] }>(
              `/search?part=snippet&type=video&maxResults=20&q=${encodeURIComponent(q)}`,
            );
            related = (s.items ?? [])
              .map(ytSearchToVideo)
              .filter((v): v is Video => Boolean(v) && v!.id !== data.id);
          } catch {}
          return { video, related };
        }
      }
    } catch (e) {
      console.warn("YT API video failed:", (e as Error).message);
    }

    return { video: null, related: [] };

  });

// ================== Comments ==================

export interface WatchComment {
  id: string;
  author: string;
  avatar: string;
  text: string;
  time: string;
  likes: number;
  replies: number;
  pinned: boolean;
  hearted: boolean;
  verified: boolean;
  repliesData?: WatchComment[];
}

export const getCommentReplies = createServerFn({ method: "GET" })
  .inputValidator((d: { videoId: string; commentId: string }) => ({
    videoId: String(d?.videoId ?? ""),
    commentId: String(d?.commentId ?? ""),
  }))
  .handler(async ({ data }): Promise<WatchComment[]> => {
    if (!data.videoId || !data.commentId) return [];
    setResponseHeader("cache-control", "public, max-age=300, s-maxage=1800, stale-while-revalidate=3600");

    try {
      // Piped replies
      const res = await piped<{ comments?: any[] }>(`/comments/${encodeURIComponent(data.videoId)}?replyTo=${encodeURIComponent(data.commentId)}`);
      return (res.comments ?? []).map((c: any) => ({
        id: c.commentId ?? Math.random().toString(36).slice(2),
        author: c.author ?? "",
        avatar: c.thumbnail || avatar(c.author ?? "user"),
        text: stripHtml(c.commentText ?? ""),
        time: c.commentedTime ?? "",
        likes: typeof c.likeCount === "number" ? c.likeCount : 0,
        replies: 0,
        pinned: false,
        hearted: Boolean(c.hearted),
        verified: Boolean(c.verified),
      }));
    } catch (e) {
      console.warn("Piped replies failed:", (e as Error).message);
      return [];
    }
  });

export const getComments = createServerFn({ method: "GET" })
  .inputValidator((d: { id: string; pageToken?: string }) => ({
    id: String(d?.id ?? ""),
    pageToken: d?.pageToken ? String(d.pageToken) : "",
  }))
  .handler(async ({ data }): Promise<{ comments: WatchComment[]; nextPageToken?: string; disabled?: boolean }> => {
    if (!data.id) return { comments: [] };
    setResponseHeader("cache-control", "public, max-age=300, s-maxage=1800, stale-while-revalidate=3600");

    interface PipedComment {
      commentId?: string;
      author?: string;
      thumbnail?: string;
      commentText?: string;
      commentedTime?: string;
      likeCount?: number;
      replyCount?: number;
      hearted?: boolean;
      pinned?: boolean;
      verified?: boolean;
    }

    try {
      const path = data.pageToken
        ? `/nextpage/comments/${encodeURIComponent(data.id)}?nextpage=${encodeURIComponent(data.pageToken)}`
        : `/comments/${encodeURIComponent(data.id)}`;
      const res = await piped<{ comments?: PipedComment[]; nextpage?: string | null; disabled?: boolean }>(path);
      if (res.disabled) return { comments: [], disabled: true };
      const comments: WatchComment[] = (res.comments ?? []).map((c) => ({
        id: c.commentId ?? Math.random().toString(36).slice(2),
        author: c.author ?? "",
        avatar: c.thumbnail || avatar(c.author ?? "user"),
        text: stripHtml(c.commentText ?? ""),
        time: c.commentedTime ?? "",
        likes: typeof c.likeCount === "number" ? c.likeCount : 0,
        replies: typeof c.replyCount === "number" ? c.replyCount : 0,
        pinned: Boolean(c.pinned),
        hearted: Boolean(c.hearted),
        verified: Boolean(c.verified),
      }));
      if (comments.length) {
        return { comments, nextPageToken: res.nextpage ? String(res.nextpage) : undefined };
      }
    } catch (e) {
      console.warn("Piped comments failed, trying Invidious:", (e as Error).message);
    }

    // Secondary: Invidious
    try {
      interface InvComment {
        commentId?: string;
        author?: string;
        authorThumbnails?: { url: string; width: number }[];
        content?: string;
        publishedText?: string;
        likeCount?: number;
        replies?: { replyCount?: number };
        isPinned?: boolean;
        creatorHeart?: unknown;
        verified?: boolean;
      }
      const res = await invidious<{ comments?: InvComment[]; continuation?: string }>(
        `/api/v1/comments/${encodeURIComponent(data.id)}?source=youtube`,
      );
      const comments: WatchComment[] = (res.comments ?? []).map((c) => ({
        id: c.commentId ?? Math.random().toString(36).slice(2),
        author: c.author ?? "",
        avatar: invAvatar(c.authorThumbnails, c.author ?? "user"),
        text: stripHtml(c.content ?? ""),
        time: c.publishedText ?? "",
        likes: typeof c.likeCount === "number" ? c.likeCount : 0,
        replies: typeof c.replies?.replyCount === "number" ? c.replies.replyCount : 0,
        pinned: Boolean(c.isPinned),
        hearted: Boolean(c.creatorHeart),
        verified: Boolean(c.verified),
      }));
      return { comments, nextPageToken: res.continuation };
    } catch (e) {
      console.warn("Invidious comments failed:", (e as Error).message);
      return { comments: [] };
    }
  });

// ================== Batch video lookup ==================

export const getVideosByIds = createServerFn({ method: "GET" })
  .inputValidator((d: { ids: string[] }) => ({
    ids: (Array.isArray(d?.ids) ? d.ids : []).slice(0, 50).map(String).filter(Boolean),
  }))
  .handler(async ({ data }): Promise<Video[]> => {
    if (!data.ids.length) return [];
    setResponseHeader("cache-control", "public, max-age=600, s-maxage=3600, stale-while-revalidate=86400");

    const synthetic = (id: string): Video => ({
      id,
      title: "YouTube video",
      channel: "",
      channelAvatar: avatar(id),
      views: "—",
      posted: "",
      duration: "",
      thumbnail: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
      description: "",
    });

    const map = new Map<string, Video>();

    // Fast path: single batched YouTube Data API call for up to 50 ids.
    if (ytKey()) {
      try {
        const j = await ytFetch<{ items?: YTVideoItem[] }>(
          `/videos?part=snippet,contentDetails,statistics&id=${encodeURIComponent(data.ids.join(","))}`,
        );
        for (const it of j.items ?? []) {
          const v = ytVideoToVideo(it);
          if (v) map.set(v.id, v);
        }
        if (map.size === data.ids.length) {
          return data.ids.map((id) => map.get(id)!);
        }
      } catch (e) {
        console.warn("YT API batch lookup failed:", (e as Error).message);
      }
    }

    // Fill remaining ids via Piped/Invidious in parallel, with synthetic fallback.
    const missing = data.ids.filter((id) => !map.has(id));
    const results = await Promise.allSettled(
      missing.map(async (id): Promise<Video> => {
        try {
          const s = await piped<{
            title?: string;
            uploader?: string;
            uploaderAvatar?: string;
            duration?: number;
            views?: number;
            thumbnailUrl?: string;
            uploadDate?: string;
            livestream?: boolean;
            description?: string;
            error?: string;
          }>(`/streams/${encodeURIComponent(id)}`);
          if (s?.error || !s?.title) throw new Error(s?.error || "piped-empty");
          return {
            id,
            title: s.title ?? "",
            channel: s.uploader ?? "",
            channelAvatar: s.uploaderAvatar || avatar(s.uploader ?? id),
            views: typeof s.views === "number" && s.views >= 0 ? formatViews(String(s.views)) : "—",
            posted: s.uploadDate ?? "",
            duration: s.livestream ? "LIVE" : formatSeconds(s.duration ?? 0),
            thumbnail: s.thumbnailUrl || `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
            description: stripHtml(s.description ?? ""),
          };
        } catch {
          try {
            const s = await invidious<{
              title?: string;
              author?: string;
              authorThumbnails?: { url: string; width: number }[];
              lengthSeconds?: number;
              viewCount?: number;
              videoThumbnails?: { url: string; quality?: string; width?: number }[];
              publishedText?: string;
              liveNow?: boolean;
              description?: string;
            }>(`/api/v1/videos/${encodeURIComponent(id)}`);
            if (!s?.title) throw new Error("inv-empty");
            return {
              id,
              title: s.title ?? "",
              channel: s.author ?? "",
              channelAvatar: invAvatar(s.authorThumbnails, s.author ?? id),
              views:
                typeof s.viewCount === "number" && s.viewCount >= 0
                  ? formatViews(String(s.viewCount))
                  : "—",
              posted: s.publishedText ?? "",
              duration: s.liveNow ? "LIVE" : formatSeconds(s.lengthSeconds ?? 0),
              thumbnail: invThumb(s.videoThumbnails, id),
              description: stripHtml(s.description ?? ""),
            };
          } catch {
            return synthetic(id);
          }
        }
      }),
    );

    for (let i = 0; i < results.length; i++) {
      const r = results[i];
      const id = missing[i];
      map.set(id, r.status === "fulfilled" ? r.value : synthetic(id));
    }

    return data.ids.map((id) => map.get(id)!).filter(Boolean);
  });


// Shorts functionality removed per request


// ================== Recommendations from likes + searches ==================

export const getRecommendedFromLikes = createServerFn({ method: "GET" })
  .inputValidator((d: { ids?: string[]; queries?: string[] }) => ({
    ids: (Array.isArray(d?.ids) ? d.ids : []).slice(0, 5).map(String).filter(Boolean),
    queries: (Array.isArray(d?.queries) ? d.queries : []).slice(0, 5).map((q) => String(q).slice(0, 80)).filter(Boolean),
  }))
  .handler(async ({ data }): Promise<Video[]> => {
    if (!data.ids.length && !data.queries.length) return [];
    setResponseHeader("cache-control", "private, max-age=300, stale-while-revalidate=1800");

    const stop = new Set([
      "the","a","an","of","and","or","to","in","on","for","with","is","are","was",
      "were","this","that","by","at","from","how","why","what","official","video",
      "feat","ft","vs","new","best","top","full","hd","4k","live","2024","2025","2026",
    ]);

    // Fetch each liked video via Piped /streams to get title + channel id
    const seeds = await Promise.allSettled(
      data.ids.map((id) =>
        piped<{ title?: string; uploaderUrl?: string; relatedStreams?: PipedItem[] }>(
          `/streams/${encodeURIComponent(id)}`,
        ),
      ),
    );

    const titleQueries: string[] = [];
    const channelIds: string[] = [];
    const relatedFromSeeds: Video[] = [];

    for (const r of seeds) {
      if (r.status !== "fulfilled") continue;
      const s = r.value;
      if (s.title) {
        const words = s.title
          .toLowerCase()
          .replace(/[^\p{L}\p{N}\s]/gu, " ")
          .split(/\s+/)
          .filter((w) => w.length > 2 && !stop.has(w));
        const q = words.slice(0, 4).join(" ");
        if (q) titleQueries.push(q);
      }
      const cid = channelIdFromUrl(s.uploaderUrl);
      if (cid) channelIds.push(cid);
      // Use related streams from the seed video as a cheap recommendation source
      for (const it of s.relatedStreams ?? []) {
        const v = pipedToVideo(it);
        if (v && !data.ids.includes(v.id)) relatedFromSeeds.push(v);
      }
    }

    const queries = Array.from(new Set([...titleQueries, ...data.queries].map((q) => q.trim()).filter(Boolean))).slice(0, 6);
    const uniqueChannels = Array.from(new Set(channelIds)).slice(0, 3);

    // Fan out keyword searches + channel uploads
    const [keywordResults, channelResults] = await Promise.all([
      Promise.allSettled(
        queries.map((q) =>
          piped<{ items?: PipedItem[] }>(`/search?q=${encodeURIComponent(q)}&filter=videos`),
        ),
      ),
      Promise.allSettled(
        uniqueChannels.map((cid) =>
          piped<{ relatedStreams?: PipedItem[] }>(`/channel/${encodeURIComponent(cid)}`),
        ),
      ),
    ]);

    const collected: Video[] = [...relatedFromSeeds];
    for (const r of keywordResults) {
      if (r.status !== "fulfilled") continue;
      for (const it of r.value.items ?? []) {
        const v = pipedToVideo(it);
        if (v && !data.ids.includes(v.id)) collected.push(v);
      }
    }
    for (const r of channelResults) {
      if (r.status !== "fulfilled") continue;
      for (const it of r.value.relatedStreams ?? []) {
        const v = pipedToVideo(it);
        if (v && !data.ids.includes(v.id)) collected.push(v);
      }
    }

    // Dedupe and shuffle
    const seen = new Set<string>();
    const unique: Video[] = [];
    for (const v of collected) {
      if (seen.has(v.id)) continue;
      seen.add(v.id);
      unique.push(v);
    }
    for (let i = unique.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [unique[i], unique[j]] = [unique[j], unique[i]];
    }
    return unique.slice(0, 24);
  });

// ================== Live ==================

export const getLive = createServerFn({ method: "GET" })
  .inputValidator((d: { q?: string }) => ({
    q: String(d?.q ?? "").slice(0, 80),
  }))
  .handler(async ({ data }): Promise<Video[]> => {
    setResponseHeader("cache-control", "public, max-age=60, s-maxage=120, stale-while-revalidate=300");
    const q = data.q || "live";

    // Primary: Invidious has a proper live filter (features=live)
    try {
      const items = await invidious<InvVideoItem[]>(
        `/api/v1/search?q=${encodeURIComponent(q)}&type=video&features=live&sort_by=view_count`,
      );
      const mapped = items
        .filter((it) => it.liveNow)
        .map(invToVideo)
        .filter((v): v is Video => Boolean(v))
        .map((v) => ({ ...v, duration: "LIVE" }))
        .slice(0, 24);
      if (mapped.length) return mapped;
    } catch (e) {
      console.warn("Invidious live search failed:", (e as Error).message);
    }

    // Secondary: Piped search — no strict live filter, so infer from duration<=0
    try {
      const res = await piped<{ items?: PipedItem[] }>(
        `/search?q=${encodeURIComponent(q + " live")}&filter=videos`,
      );
      const items = (res.items ?? [])
        .filter((it) => !it.duration || it.duration <= 0)
        .map(pipedToVideo)
        .filter((v): v is Video => Boolean(v))
        .map((v) => ({ ...v, duration: "LIVE" }))
        .slice(0, 24);
      return items;
    } catch (e) {
      console.warn("Piped live search failed:", (e as Error).message);
    }

    // Tertiary: YouTube Data API
    try {
      const s = await ytFetch<{ items?: YTSearchItem[] }>(
        `/search?part=snippet&type=video&eventType=live&maxResults=24&q=${encodeURIComponent(q)}`,
      );
      return (s.items ?? [])
        .map(ytSearchToVideo)
        .filter((v): v is Video => Boolean(v))
        .map((v) => ({ ...v, duration: "LIVE" }));
    } catch (e) {
      console.warn("YT API live failed:", (e as Error).message);
      return [];
    }

  });

// ================== Subscriptions feed ==================

export const getSubscriptionsFeed = createServerFn({ method: "GET" })
  .inputValidator((d: { channelIds: string[] }) => ({
    channelIds: (Array.isArray(d?.channelIds) ? d.channelIds : [])
      .slice(0, 30)
      .map((x) => String(x))
      .filter((x) => /^[\w-]{10,}$/.test(x)),
  }))
  .handler(async ({ data }): Promise<Video[]> => {
    if (!data.channelIds.length) return [];
    setResponseHeader("cache-control", "private, max-age=300, stale-while-revalidate=1800");

    const results = await Promise.allSettled(
      data.channelIds.map(async (cid) => {
        // Piped channel endpoint returns relatedStreams (recent uploads)
        try {
          const r = await piped<{ relatedStreams?: PipedItem[] }>(
            `/channel/${encodeURIComponent(cid)}`,
          );
          return (r.relatedStreams ?? [])
            .map(pipedToVideo)
            .filter((v): v is Video => Boolean(v))
            .map((v) => ({ ...v, channelId: v.channelId || cid }));
        } catch {}
        try {
          const r = await invidious<{ latestVideos?: InvVideoItem[] }>(
            `/api/v1/channels/${encodeURIComponent(cid)}`,
          );
          return (r.latestVideos ?? [])
            .map(invToVideo)
            .filter((v): v is Video => Boolean(v))
            .map((v) => ({ ...v, channelId: v.channelId || cid }));
        } catch {}
        return [] as Video[];
      }),
    );

    const collected: Video[] = [];
    for (const r of results) {
      if (r.status === "fulfilled") collected.push(...r.value);
    }

    // Sort roughly by posted recency using the human "posted" string, fallback to shuffle
    // We just dedupe and interleave — no reliable timestamp — then cap.
    const seen = new Set<string>();
    const unique: Video[] = [];
    for (const v of collected) {
      if (seen.has(v.id)) continue;
      seen.add(v.id);
      unique.push(v);
    }
    // Interleave by channel so no single channel dominates the top
    const byChannel = new Map<string, Video[]>();
    for (const v of unique) {
      const k = v.channelId || "_";
      if (!byChannel.has(k)) byChannel.set(k, []);
      byChannel.get(k)!.push(v);
    }
    const buckets = Array.from(byChannel.values());
    const interleaved: Video[] = [];
    let i = 0;
    while (interleaved.length < 60 && buckets.some((b) => b.length)) {
      const b = buckets[i % buckets.length];
      if (b.length) interleaved.push(b.shift()!);
      i++;
    }
    return interleaved;
  });



// ================== Channel Data ==================

export interface ChannelInfo {
  id: string;
  name: string;
  avatar: string;
  banner?: string;
  subscribers?: string;
  description?: string;
  videos: Video[];
  nextPageToken?: string;
}

export const getChannel = createServerFn({ method: "GET" })
  .inputValidator((d: { id: string; pageToken?: string }) => ({
    id: String(d?.id ?? ""),
    pageToken: d?.pageToken ? String(d.pageToken) : "",
  }))
  .handler(async ({ data }): Promise<ChannelInfo> => {
    if (!data.id) throw new Error("Missing channel id");
    setResponseHeader("cache-control", "public, max-age=600, s-maxage=1800, stale-while-revalidate=3600");

    try {
      // Primary: Piped
      const path = `/channel/${encodeURIComponent(data.id)}`;
      const res = await piped<{
        id?: string;
        name?: string;
        avatarUrl?: string;
        bannerUrl?: string;
        subscriberCount?: number;
        description?: string;
        relatedStreams?: PipedItem[];
        nextpage?: string;
      }>(path);

      if (res.name) {
        return {
          id: data.id,
          name: res.name,
          avatar: res.avatarUrl || avatar(res.name),
          banner: res.bannerUrl || undefined,
          subscribers: typeof res.subscriberCount === "number" ? formatViews(String(res.subscriberCount)) : undefined,
          description: stripHtml(res.description ?? ""),
          videos: (res.relatedStreams ?? []).map(pipedToVideo).filter((v): v is Video => Boolean(v)),
          nextPageToken: res.nextpage,
        };
      }
    } catch (e) {
      console.warn("Piped channel failed:", (e as Error).message);
    }

    try {
      // Secondary: Invidious
      const res = await invidious<{
        author?: string;
        authorId?: string;
        authorThumbnails?: { url: string; width: number }[];
        authorBanners?: { url: string; width: number }[];
        subCount?: number;
        description?: string;
        latestVideos?: InvVideoItem[];
      }>(`/api/v1/channels/${encodeURIComponent(data.id)}`);

      if (res.author) {
        return {
          id: data.id,
          name: res.author,
          avatar: invAvatar(res.authorThumbnails, res.author),
          banner: res.authorBanners?.[0]?.url,
          subscribers: typeof res.subCount === "number" ? formatViews(String(res.subCount)) : undefined,
          description: stripHtml(res.description ?? ""),
          videos: (res.latestVideos ?? []).map(invToVideo).filter((v): v is Video => Boolean(v)),
        };
      }
    } catch (e) {
      console.warn("Invidious channel failed:", (e as Error).message);
    }

    throw new Error("Channel not found or API error");
  });
