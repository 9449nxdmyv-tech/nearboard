/**
 * Rich previews without asking anyone.
 *
 * An earlier version fetched Open Graph tags through a third-party CORS proxy,
 * keystroke-debounced, before the user had decided to post. That handed every
 * URL someone typed to a stranger's server, in an app whose home screen
 * promises no cloud.
 *
 * The insight that makes rich previews compatible with that promise: for the
 * links people actually share, the interesting part is *in the URL*. A YouTube
 * video id, a GitHub repo, a Wikipedia article title, a Spotify track — all of
 * it can be recognised and rendered without a single request.
 *
 * So this is pure parsing. No fetch, no proxy, no third party learning what
 * someone is about to post, and it works with no internet at all — which
 * matters for an app built to work when there is none.
 *
 * Thumbnails are the one thing that cannot be derived, only referenced. Loading
 * one tells that host the viewer's IP, so remote images stay behind an explicit
 * tap rather than loading because someone scrolled past.
 */

export type LinkKind =
  | 'youtube'
  | 'vimeo'
  | 'spotify'
  | 'github'
  | 'wikipedia'
  | 'map'
  | 'image'
  | 'audio'
  | 'video'
  | 'pdf'
  | 'link';

export interface RichPreview {
  url: string;
  kind: LinkKind;
  /** Where it lives, for the user to recognise. */
  domain: string;
  title?: string;
  subtitle?: string;
  /**
   * Remote thumbnail. Referenced, never loaded automatically — fetching one
   * discloses the viewer's IP to that host.
   */
  thumbnailUrl?: string;
  /** Embeddable id, where the platform has one. */
  embedId?: string;
}

function domainOf(url: URL): string {
  return url.hostname.replace(/^www\./, '');
}

/** Turn a URL path into something readable: "/some-article_name" → "some article name". */
function humanise(segment: string): string {
  return decodeURIComponent(segment)
    .replace(/[-_+]+/g, ' ')
    .replace(/\.(html?|php|aspx?)$/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function extensionOf(url: URL): string {
  const match = url.pathname.match(/\.([a-z0-9]{1,5})$/i);
  return match ? match[1].toLowerCase() : '';
}

/** YouTube ids appear in several shapes; all of them are in the URL. */
function youtubeId(url: URL): string | null {
  const host = domainOf(url);
  if (host === 'youtu.be') return url.pathname.slice(1).split('/')[0] || null;
  if (!host.endsWith('youtube.com')) return null;

  const v = url.searchParams.get('v');
  if (v) return v;

  const match = url.pathname.match(/^\/(?:embed|shorts|live)\/([^/?#]+)/);
  return match ? match[1] : null;
}

/**
 * Build a preview from a URL alone.
 *
 * Never throws: a malformed URL in a post should render as plain text, not
 * break the feed.
 */
export function previewFor(rawUrl: string): RichPreview {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return { url: rawUrl, kind: 'link', domain: rawUrl };
  }

  const domain = domainOf(url);
  const segments = url.pathname.split('/').filter(Boolean);

  // --- video platforms ---

  const yt = youtubeId(url);
  if (yt) {
    return {
      url: rawUrl,
      kind: 'youtube',
      domain: 'youtube.com',
      title: 'YouTube video',
      embedId: yt,
      // Derivable, so no lookup needed — but still remote, so still opt-in.
      thumbnailUrl: `https://i.ytimg.com/vi/${yt}/hqdefault.jpg`,
      subtitle: url.searchParams.get('t') ? 'starts partway in' : undefined
    };
  }

  if (domain === 'vimeo.com' && /^\d+$/.test(segments[0] ?? '')) {
    return { url: rawUrl, kind: 'vimeo', domain, title: 'Vimeo video', embedId: segments[0] };
  }

  // --- music ---

  if (domain === 'open.spotify.com' && segments.length >= 2) {
    const [type, id] = segments;
    return {
      url: rawUrl,
      kind: 'spotify',
      domain,
      title: `Spotify ${type}`,
      embedId: id,
      subtitle: type
    };
  }

  // --- code ---

  if (domain === 'github.com' && segments.length >= 2) {
    const [owner, repo] = segments;
    const isIssue = segments[2] === 'issues' || segments[2] === 'pull';
    return {
      url: rawUrl,
      kind: 'github',
      domain,
      title: `${owner}/${repo}`,
      subtitle: isIssue ? `${segments[2]} #${segments[3] ?? ''}`.trim() : 'repository'
    };
  }

  // --- reference ---

  if (domain.endsWith('wikipedia.org') && segments[0] === 'wiki') {
    return {
      url: rawUrl,
      kind: 'wikipedia',
      domain,
      title: humanise(segments[1] ?? ''),
      subtitle: 'Wikipedia'
    };
  }

  // --- maps ---

  if (
    domain === 'maps.google.com' ||
    (domain === 'google.com' && segments[0] === 'maps') ||
    domain === 'openstreetmap.org' ||
    domain === 'maps.apple.com'
  ) {
    const query = url.searchParams.get('q') ?? url.searchParams.get('daddr') ?? '';
    return {
      url: rawUrl,
      kind: 'map',
      domain,
      title: query ? humanise(query) : 'Map location',
      subtitle: 'map'
    };
  }

  // --- media by extension ---

  const ext = extensionOf(url);
  if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'avif'].includes(ext)) {
    return { url: rawUrl, kind: 'image', domain, title: humanise(segments.at(-1) ?? ''), thumbnailUrl: rawUrl };
  }
  if (['mp3', 'ogg', 'wav', 'm4a', 'flac'].includes(ext)) {
    return { url: rawUrl, kind: 'audio', domain, title: humanise(segments.at(-1) ?? ''), subtitle: 'audio' };
  }
  if (['mp4', 'webm', 'mov', 'mkv'].includes(ext)) {
    return { url: rawUrl, kind: 'video', domain, title: humanise(segments.at(-1) ?? ''), subtitle: 'video' };
  }
  if (ext === 'pdf') {
    return { url: rawUrl, kind: 'pdf', domain, title: humanise(segments.at(-1) ?? ''), subtitle: 'PDF' };
  }

  // --- anything else ---

  const last = segments.at(-1);
  return {
    url: rawUrl,
    kind: 'link',
    domain,
    title: last ? humanise(last) || undefined : undefined
  };
}

/** A short label for the kind, for the badge on a preview card. */
export function kindLabel(kind: LinkKind): string {
  switch (kind) {
    case 'youtube':
      return 'video';
    case 'vimeo':
      return 'video';
    case 'spotify':
      return 'music';
    case 'github':
      return 'code';
    case 'wikipedia':
      return 'article';
    case 'map':
      return 'map';
    case 'image':
      return 'image';
    case 'audio':
      return 'audio';
    case 'video':
      return 'video';
    case 'pdf':
      return 'pdf';
    case 'link':
      return 'link';
  }
}
