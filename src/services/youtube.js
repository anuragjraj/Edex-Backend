// ════════════════════════════════════════════════════════════════
//  YouTube search + transcript helpers
// ════════════════════════════════════════════════════════════════
let YoutubeTranscript;
try {
  ({ YoutubeTranscript } = require('youtube-transcript'));
} catch (e) {
  console.warn('[youtube-transcript] package not found — transcript features disabled');
  YoutubeTranscript = null;
}

async function ytSearch(query, n = 5) {
  if (!process.env.YOUTUBE_API_KEY) return [];
  try {
    const url = new URL('https://www.googleapis.com/youtube/v3/search');
    url.searchParams.set('part',            'snippet');
    url.searchParams.set('q',               query);
    url.searchParams.set('maxResults',      String(n));
    url.searchParams.set('type',            'video');
    url.searchParams.set('videoEmbeddable', 'true');
    url.searchParams.set('relevanceLanguage', 'en');
    url.searchParams.set('key',             process.env.YOUTUBE_API_KEY);

    const r    = await fetch(url.toString(), { signal: AbortSignal.timeout(8000) });
    const data = await r.json();
    if (!r.ok) { console.warn('[ytSearch]', data?.error?.message); return []; }

    return (data.items || []).map(item => ({
      videoId:   item.id.videoId,
      title:     item.snippet.title,
      channel:   item.snippet.channelTitle,
      thumbnail: item.snippet.thumbnails?.medium?.url
                 || `https://img.youtube.com/vi/${item.id.videoId}/mqdefault.jpg`,
      description: (item.snippet.description || '').slice(0, 160),
    }));
  } catch (e) {
    console.warn('[ytSearch error]', e.message?.slice(0, 80));
    return [];
  }
}

/**
 * Fetch transcript for a single video. Returns plain-text string or null.
 * Trims to maxChars to stay within Claude context limits.
 */
async function ytTranscript(videoId, maxChars = 8000) {
  if (!videoId || !YoutubeTranscript) return null;
  try {
    let segs;
    try { segs = await YoutubeTranscript.fetchTranscript(videoId, { lang: 'en' }); }
    catch { segs = await YoutubeTranscript.fetchTranscript(videoId); }
    if (!segs?.length) return null;
    const text = segs.map(s => s.text).join(' ').replace(/\s+/g, ' ').trim();
    return text.length > 200 ? text.slice(0, maxChars) : null;
  } catch {
    return null;
  }
}

/**
 * Try to get a good transcript from a list of videos.
 * Tries each video in order and returns the first one with ≥500 chars.
 */
async function getBestTranscript(videos) {
  for (const v of (videos || []).slice(0, 5)) {
    if (!v?.videoId) continue;
    const t = await ytTranscript(v.videoId);
    if (t && t.length >= 500) return { transcript: t, videoId: v.videoId };
  }
  return { transcript: null, videoId: videos?.[0]?.videoId || null };
}

module.exports = { ytSearch, ytTranscript, getBestTranscript };
