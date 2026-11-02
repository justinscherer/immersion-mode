import { wikiHostFromLang, wikimediaApiFetchHeaders } from '@/config'

import type { SlideshowImage } from './useImmersionReader'

/** Other editions to borrow images from, after English. Bigger galleries first. */
const EXTRA_LANGS = ['de', 'fr', 'es', 'ja', 'ru', 'it', 'zh', 'pt']
const MIN_ORIGINAL_WIDTH = 800
/**
 * Beyond these, phones stall downloading or fail to decode (Earth has a 279 MB,
 * 46k-px scan), so those files fall back to a standard-size thumbnail.
 */
const MAX_ORIGINAL_PIXELS = 50e6
const MAX_ORIGINAL_BYTES = 25e6
/** Must be one of the CDN's standard thumbnail widths; others are refused. */
const FALLBACK_WIDTH = 1920
const DISPLAYABLE_MIME = /^image\/(jpeg|png|gif|webp)$/
const IMAGEINFO_BATCH = 50

const headers = wikimediaApiFetchHeaders('immersion-mode slideshow')

/** `File:Foo bar.jpg`, `Datei:Foo_bar.jpg` → `Foo_bar.jpg` — the key shared across editions. */
function fileKey(title: string): string {
  const name = title.slice(title.indexOf(':') + 1)
  return name.replace(/ /g, '_').replace(/^./, (c) => c.toUpperCase())
}

async function getJson<T>(url: string, signal?: AbortSignal): Promise<T | null> {
  try {
    const res = await fetch(url, { headers, signal })
    return res.ok ? ((await res.json()) as T) : null
  } catch (err) {
    if (signal?.aborted) throw err
    return null
  }
}

async function mediaListFiles(host: string, title: string, signal?: AbortSignal) {
  const data = await getJson<{ items?: { type: string; title?: string }[] }>(
    `https://${host}/api/rest_v1/page/media-list/${encodeURIComponent(title)}`,
    signal,
  )
  return (data?.items ?? [])
    .filter((i) => i.type === 'image' && i.title)
    .map((i) => fileKey(i.title))
}

async function otherEditionTitles(title: string, signal?: AbortSignal) {
  const data = await getJson<{
    query?: { pages?: Record<string, { langlinks?: { lang: string; '*': string }[] }> }
  }>(
    `https://en.wikipedia.org/w/api.php?action=query&format=json&origin=*&prop=langlinks&lllimit=max&titles=${encodeURIComponent(title)}`,
    signal,
  )
  const links = Object.values(data?.query?.pages ?? {})[0]?.langlinks ?? []
  return EXTRA_LANGS.flatMap((lang) => {
    const link = links.find((l) => l.lang === lang)
    return link ? [{ lang, title: link['*'] }] : []
  })
}

interface ImageInfo {
  url: string
  width: number
  height: number
  /** Bytes. */
  size: number
  mime: string
  thumburl?: string
  thumbwidth?: number
  thumbheight?: number
}

/** The original when a phone can handle it, else the 1920px thumbnail. */
function displayVersion(ii: ImageInfo) {
  if (!DISPLAYABLE_MIME.test(ii.mime) || ii.width < MIN_ORIGINAL_WIDTH) return null
  if (ii.width * ii.height <= MAX_ORIGINAL_PIXELS && ii.size <= MAX_ORIGINAL_BYTES) {
    return { src: ii.url, width: ii.width, height: ii.height }
  }
  if (!ii.thumburl || !ii.thumbwidth || !ii.thumbheight) return null
  if (ii.thumbwidth * ii.thumbheight > MAX_ORIGINAL_PIXELS) return null
  return { src: ii.thumburl, width: ii.thumbwidth, height: ii.thumbheight }
}

/**
 * Looks files up on Commons only, so files hosted locally by one edition
 * (non-free images, local uploads) come back missing and drop out.
 */
async function commonsImageInfo(keys: string[], signal?: AbortSignal) {
  const info = new Map<string, ImageInfo>()
  for (let i = 0; i < keys.length; i += IMAGEINFO_BATCH) {
    const batch = keys.slice(i, i + IMAGEINFO_BATCH)
    const titles = batch.map((k) => `File:${k}`).join('|')
    const data = await getJson<{
      query?: {
        normalized?: { from: string; to: string }[]
        pages?: Record<string, { title: string; missing?: string; imageinfo?: ImageInfo[] }>
      }
    }>(
      `https://commons.wikimedia.org/w/api.php?action=query&format=json&origin=*&prop=imageinfo&iiprop=url|size|mime&iiurlwidth=${FALLBACK_WIDTH}&titles=${encodeURIComponent(titles)}`,
      signal,
    )
    for (const page of Object.values(data?.query?.pages ?? {})) {
      const ii = page.imageinfo?.[0]
      if (page.missing !== undefined || !ii) continue
      info.set(fileKey(page.title), ii)
    }
  }
  return info
}

/**
 * Full-resolution Commons originals for an article's images: English edition
 * first (in reading order), then extras from other editions. Duplicates are
 * removed by file name (and by final URL, for file redirects); SVGs, non-web
 * formats and originals under 800px are dropped. Originals too heavy for a
 * phone are swapped for their 1920px thumbnail.
 */
export async function fetchSlideshowImages(
  title: string,
  signal?: AbortSignal,
): Promise<SlideshowImage[]> {
  const [enFiles, editions] = await Promise.all([
    mediaListFiles(wikiHostFromLang('en'), title, signal),
    otherEditionTitles(title, signal),
  ])
  const extraFiles = await Promise.all(
    editions.map((e) => mediaListFiles(wikiHostFromLang(e.lang), e.title, signal)),
  )

  const keys = [...new Set([enFiles, ...extraFiles].flat())].filter((k) => !/\.svg$/i.test(k))
  const info = await commonsImageInfo(keys, signal)

  const seenUrls = new Set<string>()
  return keys.flatMap((key) => {
    const ii = info.get(key)
    const version = ii && displayVersion(ii)
    if (!version || seenUrls.has(ii.url)) return []
    seenUrls.add(ii.url)
    return [{ ...version, alt: key.replace(/\.[a-z0-9]+$/i, '').replace(/_/g, ' ') }]
  })
}
