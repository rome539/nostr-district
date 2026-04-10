/**
 * LinkPreview.ts — Fetches oEmbed metadata and renders a link preview card.
 * Uses noembed.com (free, no auth, CORS-friendly) which supports YouTube,
 * Vimeo, SoundCloud, Twitter/X, and other oEmbed-compatible sites.
 * Falls back to a plain clickable link for unsupported URLs.
 * Results are cached in-memory for the session.
 */

interface OEmbedData {
  title?: string;
  thumbnail_url?: string;
  provider_name?: string;
  author_name?: string;
}

const _cache = new Map<string, OEmbedData | null>();

async function fetchOEmbed(url: string): Promise<OEmbedData | null> {
  if (_cache.has(url)) return _cache.get(url)!;

  try {
    const res = await fetch(
      `https://noembed.com/embed?url=${encodeURIComponent(url)}`,
      { signal: AbortSignal.timeout(5000) },
    );
    if (!res.ok) { _cache.set(url, null); return null; }
    const data = await res.json();
    // noembed returns { error: '...' } for unsupported URLs
    if (data.error || !data.title) { _cache.set(url, null); return null; }
    const og: OEmbedData = {
      title:         data.title,
      thumbnail_url: data.thumbnail_url,
      provider_name: data.provider_name,
      author_name:   data.author_name,
    };
    _cache.set(url, og);
    return og;
  } catch {
    _cache.set(url, null);
    return null;
  }
}

/** Returns true if the message is a plain standalone URL */
export function isPlainUrl(text: string): boolean {
  return /^https?:\/\/[^\s]+$/i.test(text.trim());
}

/**
 * Renders a clickable link with an async oEmbed preview card below it.
 * Returns an HTMLElement — the preview card is appended after the fetch resolves.
 */
export function renderLinkWithPreview(url: string, isOwn: boolean): HTMLElement {
  const wrap = document.createElement('div');
  wrap.style.cssText = `max-width:260px;`;

  // Plain link shown immediately
  const link = document.createElement('a');
  link.href = url;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  link.textContent = url.length > 55 ? url.slice(0, 52) + '…' : url;
  link.style.cssText = 'color:var(--nd-accent);opacity:0.8;font-size:12px;word-break:break-all;display:block;';
  wrap.appendChild(link);

  // Fetch oEmbed and append preview card if data comes back
  fetchOEmbed(url).then(og => {
    if (!og) return;

    const card = document.createElement('a');
    card.href = url;
    card.target = '_blank';
    card.rel = 'noopener noreferrer';
    card.style.cssText = `
      display:block; margin-top:6px; border-radius:8px; overflow:hidden;
      border:1px solid color-mix(in srgb,var(--nd-dpurp) 40%,transparent);
      background:color-mix(in srgb,var(--nd-navy) 80%,transparent);
      text-decoration:none; cursor:pointer; transition:border-color 0.15s;
    `;
    card.onmouseenter = () => card.style.borderColor = 'color-mix(in srgb,var(--nd-accent) 40%,transparent)';
    card.onmouseleave = () => card.style.borderColor = 'color-mix(in srgb,var(--nd-dpurp) 40%,transparent)';

    if (og.thumbnail_url) {
      const img = document.createElement('img');
      img.src = og.thumbnail_url;
      img.style.cssText = 'width:100%;max-height:140px;object-fit:cover;display:block;';
      img.onerror = () => img.remove();
      card.appendChild(img);
    }

    const info = document.createElement('div');
    info.style.cssText = 'padding:8px 10px;';

    if (og.provider_name) {
      const site = document.createElement('div');
      site.textContent = og.provider_name;
      site.style.cssText = 'font-size:10px;color:var(--nd-accent);opacity:0.7;margin-bottom:2px;';
      info.appendChild(site);
    }

    if (og.title) {
      const title = document.createElement('div');
      title.textContent = og.title.length > 80 ? og.title.slice(0, 77) + '…' : og.title;
      title.style.cssText = 'font-size:12px;color:var(--nd-text);font-weight:bold;line-height:1.3;';
      info.appendChild(title);
    }

    if (og.author_name) {
      const author = document.createElement('div');
      author.textContent = og.author_name;
      author.style.cssText = 'font-size:11px;color:var(--nd-subtext);opacity:0.7;margin-top:3px;';
      info.appendChild(author);
    }

    card.appendChild(info);
    wrap.appendChild(card);
  }).catch(() => {});

  return wrap;
}
