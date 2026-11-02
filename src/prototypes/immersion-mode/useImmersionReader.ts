import { onBeforeUnmount, ref, shallowRef } from 'vue'

/**
 * Pre-generated narration: one MP3 + word-timed WebVTT per chapter, under
 * `public/immersion-audio/<dir>/` (not `public/immersion-mode/`, which would shadow
 * this prototype's route on GitHub Pages). Chapter keys are the article's `h2` ids
 * (`Lead` is the lead section). Each chapter's first VTT sentence is its heading.
 */
export interface AudioManifest {
  dir: string
  chapters: string[]
}

const MANIFESTS: Record<string, AudioManifest> = {
  Earth: {
    dir: 'earth',
    chapters: [
      'Lead',
      'Etymology',
      'Composition_and_structure',
      'Hydrosphere',
      'Atmosphere_and_climate',
      'Biosphere',
      'Human_geography',
      'In_culture',
    ],
  },
}

export function audioManifestFor(title?: string | null): AudioManifest | null {
  if (!title) return null
  return MANIFESTS[title.replace(/_/g, ' ').trim()] ?? null
}

export const SPEED_OPTIONS = [0.5, 0.75, 1, 1.25, 1.5, 2]

export interface SlideshowImage {
  src: string
  alt: string
  width?: number
  height?: number
}

type Entry =
  | { type: 'heading'; startTime: number; el: HTMLElement }
  /** `times[i]` is when `spans[i]` is spoken. */
  | { type: 'spans'; startTime: number; spans: HTMLElement[]; times: number[] }

interface Cue {
  start: number
  end: number
  text: string
}

function audioUrl(manifest: AudioManifest, key: string, ext: 'mp3' | 'vtt') {
  return `${import.meta.env.BASE_URL}immersion-audio/${manifest.dir}/${key}.${ext}`
}

function parseVttTime(s: string) {
  const [h, m, sec] = s.split(':')
  return +h * 3600 + +m * 60 + parseFloat(sec)
}

function parseVtt(text: string): Cue[] {
  const cues: Cue[] = []
  for (const block of text.trim().split(/\n\n+/)) {
    const lines = block
      .split('\n')
      .filter((l) => l.trim() && !/^WEBVTT/.test(l) && !/^\d+$/.test(l.trim()))
    if (lines.length < 2) continue
    const m = lines[0].match(/(\S+)\s*-->\s*(\S+)/)
    if (!m) continue
    cues.push({
      start: parseVttTime(m[1]),
      end: parseVttTime(m[2]),
      text: lines.slice(1).join(' ').trim(),
    })
  }
  return cues
}

function normWord(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]/g, '')
}

function textWithoutRefs(el: HTMLElement) {
  const clone = el.cloneNode(true) as HTMLElement
  clone.querySelectorAll('sup, .reference').forEach((n) => n.remove())
  return (clone.textContent ?? '').trim()
}

function isDecorative(src: string) {
  if (/\.svg(\?|$)/i.test(src) || /\.svg\.png/i.test(src)) return true
  if (/1x1|pixel|blank/i.test(src)) return true
  const m = src.match(/\/(\d+)px-/)
  return m ? parseInt(m[1], 10) < 100 : false
}

/**
 * Article photos in reading order, at whatever cached thumbnail size the page
 * already loaded. Wikimedia's CDN refuses non-standard sizes from other origins,
 * so never rewrite the `NNNpx-` segment.
 */
export function collectSlideshowImages(articleEl: HTMLElement): SlideshowImage[] {
  const seen = new Set<string>()
  const out: SlideshowImage[] = []
  articleEl.querySelectorAll<HTMLImageElement>('.mw-parser-output img').forEach((img) => {
    if (img.closest('.navbox, .metadata, .mw-kartographer-map, .sidebar')) return
    let src = img.currentSrc || img.getAttribute('src') || ''
    if (src.startsWith('//')) src = 'https:' + src
    if (!src.startsWith('http') || isDecorative(src)) return
    if (seen.has(src)) return
    seen.add(src)
    out.push({ src, alt: img.alt || '' })
  })
  return out
}

function chapterContainer(articleEl: HTMLElement, key: string): HTMLElement | null {
  if (key === 'Lead') return articleEl.querySelector("section[data-mw-section-id='0']")
  return articleEl.querySelector<HTMLElement>(`h2#${CSS.escape(key)}`)?.closest('section') ?? null
}

function chapterHeading(articleEl: HTMLElement, key: string): HTMLElement | null {
  if (key === 'Lead') return articleEl.querySelector('.article-header__title')
  return articleEl.querySelector(`h2#${CSS.escape(key)}`)
}

function chapterParagraphs(articleEl: HTMLElement, key: string): HTMLElement[] {
  const container = chapterContainer(articleEl, key)
  if (!container) return []
  return [...container.querySelectorAll<HTMLElement>('p')].filter(
    (p) =>
      !p.closest('table, figure, .infobox, .hatnote, .mw-empty-elt') &&
      textWithoutRefs(p).length > 20,
  )
}

function wrapWords(p: HTMLElement) {
  const walker = document.createTreeWalker(p, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      let anc = node.parentElement
      while (anc && anc !== p) {
        if (anc.tagName === 'SUP' || anc.tagName === 'SMALL') return NodeFilter.FILTER_REJECT
        anc = anc.parentElement
      }
      return NodeFilter.FILTER_ACCEPT
    },
  })
  const textNodes: Text[] = []
  let node: Node | null
  while ((node = walker.nextNode())) textNodes.push(node as Text)

  for (const tn of textNodes) {
    const val = tn.nodeValue ?? ''
    const frag = document.createDocumentFragment()
    const leadWs = val.match(/^\s+/)
    if (leadWs) frag.appendChild(document.createTextNode(leadWs[0]))
    const re = /\S+\s*/g
    let m: RegExpExecArray | null
    while ((m = re.exec(val)) !== null) {
      const span = document.createElement('span')
      span.className = 'tts-word'
      span.textContent = m[0]
      frag.appendChild(span)
    }
    tn.parentNode?.replaceChild(frag, tn)
  }
}

/**
 * Groups word cues into sentences and matches each word to a wrapped span,
 * looking ahead a few spans so small text/narration differences don't derail it.
 * The first sentence of every chapter is its spoken heading.
 */
function alignSentences(cues: Cue[], spans: HTMLElement[], heading: HTMLElement | null): Entry[] {
  const out: Entry[] = []
  let si = 0
  let headingDone = false
  let currentStart = cues[0]?.start ?? 0
  let current: HTMLElement[] = []
  let times: number[] = []

  function flush() {
    if (current.length) out.push({ type: 'spans', startTime: currentStart, spans: current, times })
    current = []
    times = []
  }

  for (let ci = 0; ci < cues.length; ci++) {
    const cue = cues[ci]
    const isSentenceEnd = /[.!?]['"]?\s*$/.test(cue.text)

    if (!headingDone) {
      if (isSentenceEnd) {
        if (heading) out.push({ type: 'heading', startTime: currentStart, el: heading })
        headingDone = true
        currentStart = cues[ci + 1]?.start ?? cue.end
      }
      continue
    }

    for (const word of cue.text.split(/\s+/).filter(Boolean)) {
      const nw = normWord(word)
      if (!nw) continue
      for (let k = 0; k < 12 && si + k < spans.length; k++) {
        if (normWord(spans[si + k].textContent ?? '') === nw) {
          current.push(spans[si + k])
          times.push(cue.start)
          si += k + 1
          break
        }
      }
    }

    if (isSentenceEnd) {
      flush()
      currentStart = cues[ci + 1]?.start ?? cue.end
    }
  }
  flush()
  return out
}

function expandCollapsedAncestor(el: HTMLElement) {
  const body = el.closest('.protowiki-mobile-section-body--collapsed')
  const h2 = body?.previousElementSibling as HTMLElement | null
  if (h2?.classList.contains('protowiki-mobile-h2--collapsed')) h2.click()
}

function sentenceHtml(entry: Entry): string {
  const box = document.createElement('div')
  if (entry.type === 'heading') {
    box.textContent = (entry.el.textContent ?? '').trim()
    return box.innerHTML
  }
  const range = document.createRange()
  range.setStartBefore(entry.spans[0])
  range.setEndAfter(entry.spans[entry.spans.length - 1])
  box.appendChild(range.cloneContents())
  box.querySelectorAll('sup, .reference').forEach((n) => n.remove())
  return box.innerHTML
}

export function useImmersionReader() {
  const active = ref(false)
  const paused = ref(false)
  const rate = ref(1)
  const chapterIdx = ref(-1)
  const chapterCount = ref(0)
  const progress = ref(0)
  const sentence = ref('')
  /** Index of the word being spoken among the active sentence's matched words. */
  const wordIndex = ref(0)
  const focusRect = shallowRef<DOMRect | null>(null)

  let articleEl: HTMLElement | null = null
  let manifest: AudioManifest | null = null
  let vttTexts: Promise<string[]> | null = null
  let audio: HTMLAudioElement | null = null
  let session = 0
  let chapters: Entry[][] = []
  let wrapped: { el: HTMLElement; savedHtml: string }[] = []
  let activeEntry: Entry | null = null
  let activePara: HTMLElement | null = null
  let focusEl: HTMLElement | null = null
  let focusFrame = 0

  function updateFocus() {
    focusFrame = 0
    focusRect.value = focusEl?.getBoundingClientRect() ?? null
  }

  function scheduleFocusUpdate() {
    if (!focusFrame) focusFrame = requestAnimationFrame(updateFocus)
  }

  function setFocus(el: HTMLElement | null) {
    focusEl = el
    scheduleFocusUpdate()
  }

  function deactivate(entry: Entry | null) {
    if (!entry) return
    if (entry.type === 'heading') entry.el.classList.remove('immersion-heading-active')
    else entry.spans.forEach((s) => s.classList.remove('tts-active'))
  }

  function activate(entry: Entry) {
    if (entry === activeEntry) return
    deactivate(activeEntry)
    activeEntry = entry

    if (entry.type === 'heading') {
      entry.el.classList.add('immersion-heading-active')
      activePara?.classList.remove('tts-para-active')
      activePara = null
      expandCollapsedAncestor(entry.el)
      entry.el.scrollIntoView({ behavior: 'smooth', block: 'start' })
      setFocus(entry.el)
    } else {
      entry.spans.forEach((s) => s.classList.add('tts-active'))
      const para = entry.spans[0]?.closest('p') as HTMLElement | null
      if (para && para !== activePara) {
        activePara?.classList.remove('tts-para-active')
        para.classList.add('tts-para-active')
        activePara = para
        expandCollapsedAncestor(para)
        para.scrollIntoView({ behavior: 'smooth', block: 'center' })
        setFocus(para)
      }
    }
    sentence.value = sentenceHtml(entry)
  }

  function onTimeUpdate() {
    if (!audio) return
    const t = audio.currentTime
    if (audio.duration)
      progress.value = (chapterIdx.value + t / audio.duration) / chapterCount.value
    const entries = chapters[chapterIdx.value]
    if (entries?.length) {
      let lo = 0
      let hi = entries.length - 1
      let best = 0
      while (lo <= hi) {
        const mid = (lo + hi) >> 1
        if (entries[mid].startTime <= t) {
          best = mid
          lo = mid + 1
        } else hi = mid - 1
      }
      const entry = entries[best]
      activate(entry)
      let w = 0
      if (entry.type === 'spans') {
        while (w + 1 < entry.times.length && entry.times[w + 1] <= t) w++
      }
      wordIndex.value = w
    }
    scheduleFocusUpdate()
  }

  function ensureAudio() {
    if (audio) return audio
    audio = new Audio()
    audio.addEventListener('ended', () => playChapter(chapterIdx.value + 1))
    audio.addEventListener('timeupdate', onTimeUpdate)
    return audio
  }

  function playChapter(idx: number) {
    if (!manifest || !audio) return
    if (idx >= manifest.chapters.length) {
      stop()
      return
    }
    chapterIdx.value = idx
    progress.value = idx / manifest.chapters.length
    audio.src = audioUrl(manifest, manifest.chapters[idx], 'mp3')
    audio.defaultPlaybackRate = rate.value
    audio.playbackRate = rate.value
    paused.value = false
    audio.play().catch((e) => console.warn('Audio play failed:', e))
  }

  function unwrapAll() {
    for (const { el, savedHtml } of wrapped) {
      el.innerHTML = savedHtml
      el.classList.remove('tts-para-active')
    }
    wrapped = []
  }

  /** Must run inside the user's click so the browser allows `audio.play()`. */
  function start() {
    if (!articleEl || !manifest || active.value) return
    const root = articleEl
    const m = manifest
    const mySession = ++session

    const paragraphsByChapter = m.chapters.map((key) => chapterParagraphs(root, key))
    for (const p of new Set(paragraphsByChapter.flat())) {
      wrapped.push({ el: p, savedHtml: p.innerHTML })
      wrapWords(p)
    }

    active.value = true
    chapterCount.value = m.chapters.length
    chapters = []
    ensureAudio()
    playChapter(0)
    document.addEventListener('scroll', scheduleFocusUpdate, { capture: true, passive: true })
    window.addEventListener('resize', scheduleFocusUpdate)

    void (vttTexts ?? Promise.resolve([] as string[])).then((texts) => {
      if (mySession !== session) return
      chapters = m.chapters.map((key, i) =>
        alignSentences(
          parseVtt(texts[i] ?? ''),
          paragraphsByChapter[i].flatMap((p) => [...p.querySelectorAll<HTMLElement>('.tts-word')]),
          chapterHeading(root, key),
        ),
      )
    })
  }

  function stop() {
    session++
    if (audio) {
      audio.pause()
      audio.removeAttribute('src')
      audio.load()
    }
    deactivate(activeEntry)
    activeEntry = null
    activePara?.classList.remove('tts-para-active')
    activePara = null
    unwrapAll()
    chapters = []
    chapterIdx.value = -1
    progress.value = 0
    sentence.value = ''
    wordIndex.value = 0
    active.value = false
    paused.value = false
    setFocus(null)
    document.removeEventListener('scroll', scheduleFocusUpdate, { capture: true })
    window.removeEventListener('resize', scheduleFocusUpdate)
  }

  function togglePlay() {
    if (!active.value) start()
    else if (paused.value) {
      void audio?.play()
      paused.value = false
    } else {
      audio?.pause()
      paused.value = true
    }
  }

  function prev() {
    if (active.value) playChapter(Math.max(0, chapterIdx.value - 1))
  }

  function next() {
    if (active.value) playChapter(chapterIdx.value + 1)
  }

  function setRate(r: number) {
    rate.value = r
    if (audio) {
      audio.defaultPlaybackRate = r
      audio.playbackRate = r
    }
  }

  function attach(el: HTMLElement, m: AudioManifest | null) {
    stop()
    articleEl = el
    manifest = m
    vttTexts = m
      ? Promise.all(
          m.chapters.map((key) =>
            fetch(audioUrl(m, key, 'vtt'))
              .then((r) => (r.ok ? r.text() : ''))
              .catch(() => ''),
          ),
        )
      : null
  }

  function detach() {
    stop()
    articleEl = null
    manifest = null
    vttTexts = null
  }

  onBeforeUnmount(() => {
    detach()
    if (focusFrame) cancelAnimationFrame(focusFrame)
  })

  return {
    active,
    paused,
    rate,
    chapterIdx,
    chapterCount,
    progress,
    sentence,
    wordIndex,
    focusRect,
    attach,
    detach,
    start,
    stop,
    togglePlay,
    prev,
    next,
    setRate,
  }
}
