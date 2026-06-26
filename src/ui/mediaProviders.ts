export type MediaProvider = "spotify" | "youtube" | "youtube-music" | "apple-music";

export interface MediaEmbed {
  provider: MediaProvider;
  label: string;
  embedUrl: string;
  externalUrl: string;
}

export function normalizeMediaEmbedUrl(input: string): string | null {
  return parseMediaUrl(input)?.embedUrl ?? null;
}

export function parseMediaUrl(input: string): MediaEmbed | null {
  const value = input.trim();
  if (!value) return null;

  try {
    const url = new URL(value);
    const host = url.hostname.replace(/^www\./, "");

    if (host === "open.spotify.com") return parseSpotify(url);
    if (host === "youtu.be" || host === "youtube.com" || host === "music.youtube.com") return parseYouTube(url);
    if (host === "music.apple.com" || host === "embed.music.apple.com") return parseAppleMusic(url);
  } catch {
    return null;
  }

  return null;
}

export function providerLabel(provider: MediaProvider) {
  if (provider === "youtube-music") return "YouTube Music";
  if (provider === "apple-music") return "Apple Music";
  if (provider === "youtube") return "YouTube";
  return "Spotify";
}

function parseSpotify(url: URL): MediaEmbed | null {
  const parts = url.pathname.split("/").filter(Boolean);
  const embedIndex = parts[0] === "embed" ? 1 : 0;
  const type = parts[embedIndex];
  const id = parts[embedIndex + 1];
  if (!type || !id) return null;

  const allowed = new Set(["album", "artist", "episode", "playlist", "show", "track"]);
  if (!allowed.has(type)) return null;

  const embed = new URL(`https://open.spotify.com/embed/${type}/${id}`);
  embed.searchParams.set("utm_source", "generator");
  embed.searchParams.set("theme", "0");
  return {
    provider: "spotify",
    label: `Spotify ${type}`,
    embedUrl: embed.toString(),
    externalUrl: `https://open.spotify.com/${type}/${id}`,
  };
}

function parseYouTube(url: URL): MediaEmbed | null {
  const host = url.hostname.replace(/^www\./, "");
  const isMusic = host === "music.youtube.com";
  const parts = url.pathname.split("/").filter(Boolean);
  const list = url.searchParams.get("list");
  let videoId = "";

  if (host === "youtu.be") {
    videoId = parts[0] ?? "";
  } else if (parts[0] === "watch") {
    videoId = url.searchParams.get("v") ?? "";
  } else if (["embed", "shorts", "live"].includes(parts[0] ?? "")) {
    videoId = parts[1] ?? "";
  } else if (parts[0] === "playlist" && list) {
    const embed = new URL("https://www.youtube.com/embed/videoseries");
    embed.searchParams.set("list", list);
    return {
      provider: isMusic ? "youtube-music" : "youtube",
      label: isMusic ? "YouTube Music playlist" : "YouTube playlist",
      embedUrl: embed.toString(),
      externalUrl: url.toString(),
    };
  }

  if (!videoId && list) {
    const embed = new URL("https://www.youtube.com/embed/videoseries");
    embed.searchParams.set("list", list);
    return {
      provider: isMusic ? "youtube-music" : "youtube",
      label: isMusic ? "YouTube Music playlist" : "YouTube playlist",
      embedUrl: embed.toString(),
      externalUrl: url.toString(),
    };
  }

  if (!videoId) return null;
  const embed = new URL(`https://www.youtube.com/embed/${videoId}`);
  if (list) embed.searchParams.set("list", list);
  embed.searchParams.set("rel", "0");
  return {
    provider: isMusic ? "youtube-music" : "youtube",
    label: isMusic ? "YouTube Music video" : "YouTube video",
    embedUrl: embed.toString(),
    externalUrl: url.toString(),
  };
}

function parseAppleMusic(url: URL): MediaEmbed | null {
  const path = url.pathname;
  if (!path || path === "/") return null;
  const embed = new URL(`https://embed.music.apple.com${path}`);
  url.searchParams.forEach((value, key) => embed.searchParams.set(key, value));
  return {
    provider: "apple-music",
    label: "Apple Music",
    embedUrl: embed.toString(),
    externalUrl: url.toString().replace("https://embed.music.apple.com", "https://music.apple.com"),
  };
}
