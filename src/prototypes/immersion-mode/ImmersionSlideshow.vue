<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'

import type { SlideshowImage } from './useImmersionReader'

interface Props {
  images: SlideshowImage[]
  /** Active sentence markup, mirrored from the article (word spans keep their classes). */
  sentence: string
  /** Spoken word's index among the sentence's highlighted (`.tts-active`) words. */
  wordIndex: number
}

const props = defineProps<Props>()

const CAPTION_LINES = 3

const sentenceEl = ref<HTMLElement | null>(null)
const captionPage = ref(0)
const captionInstant = ref(true)

/** Long sentences show three lines at a time, paging to keep the spoken word visible. */
watch(
  () => [props.sentence, props.wordIndex] as const,
  async ([sentence], prev) => {
    const newSentence = sentence !== prev?.[0]
    if (newSentence) {
      captionInstant.value = true
      captionPage.value = 0
    }
    await nextTick()
    const el = sentenceEl.value
    if (!el) return
    const words = el.querySelectorAll<HTMLElement>('.tts-word.tts-active')
    const word = words[props.wordIndex] ?? words[0]
    const lineHeight = parseFloat(getComputedStyle(el).lineHeight)
    if (word && lineHeight) {
      captionPage.value = Math.floor(word.offsetTop / (lineHeight * CAPTION_LINES))
    }
    if (newSentence) requestAnimationFrame(() => (captionInstant.value = false))
  },
  { immediate: true },
)

const DURATION_MS = 12000
const CROSSFADE_MS = 1600
const ORIGINS = ['50% 50%', '25% 30%', '75% 25%', '30% 70%', '70% 75%', '50% 20%']

/** Past this aspect-ratio mismatch with the stage, show the whole image over a blurred copy. */
const COVER_TOLERANCE = 1.5

interface Layer {
  id: number
  src: string
  alt: string
  fit: 'cover' | 'contain'
  origin: string
  zoom: 'in' | 'out'
  visible: boolean
  animating: boolean
}

const stageEl = ref<HTMLElement | null>(null)
const layers = ref<Layer[]>([])
let nextId = 0
let step = 0
let disposed = false
let timer: ReturnType<typeof setTimeout> | undefined
const removals = new Set<ReturnType<typeof setTimeout>>()

/** Originals can be many megabytes; decode before crossfading so nothing pops in half-drawn. */
async function decodeImage(src: string) {
  const loader = new Image()
  loader.src = src
  await loader.decode()
  return loader
}

function fitFor(width: number, height: number): Layer['fit'] {
  const stage = stageEl.value
  if (!stage?.clientHeight || !height) return 'cover'
  const mismatch = width / height / (stage.clientWidth / stage.clientHeight)
  return mismatch > COVER_TOLERANCE || mismatch < 1 / COVER_TOLERANCE ? 'contain' : 'cover'
}

async function show(idx: number, failures = 0) {
  const count = props.images.length
  if (disposed || !count || failures >= count) return
  const img = props.images[idx % count]

  let loaded: HTMLImageElement
  try {
    loaded = await decodeImage(img.src)
  } catch {
    void show(idx + 1, failures + 1)
    return
  }
  if (disposed) return

  for (const old of layers.value) {
    if (!old.visible) continue
    old.visible = false
    const t = setTimeout(() => {
      removals.delete(t)
      layers.value = layers.value.filter((l) => l.id !== old.id)
    }, CROSSFADE_MS)
    removals.add(t)
  }

  const layer: Layer = {
    id: nextId++,
    src: img.src,
    alt: img.alt,
    fit: fitFor(img.width ?? loaded.naturalWidth, img.height ?? loaded.naturalHeight),
    origin: ORIGINS[step % ORIGINS.length],
    zoom: step % 2 === 0 ? 'in' : 'out',
    visible: false,
    animating: false,
  }
  step++
  layers.value.push(layer)
  const live = layers.value[layers.value.length - 1]

  requestAnimationFrame(() => {
    live.visible = true
    requestAnimationFrame(() => (live.animating = true))
  })

  const upcoming = props.images[(idx + 1) % count]
  if (count > 1) decodeImage(upcoming.src).catch(() => {})
  timer = setTimeout(() => show(idx + 1), DURATION_MS)
}

onMounted(() => void show(0))

onBeforeUnmount(() => {
  disposed = true
  clearTimeout(timer)
  removals.forEach(clearTimeout)
})
</script>

<template>
  <div class="immersion-slideshow">
    <div ref="stageEl" class="immersion-slideshow__stage">
      <div
        v-for="layer in layers"
        :key="layer.id"
        class="immersion-slideshow__layer"
        :class="{ 'immersion-slideshow__layer--visible': layer.visible }"
      >
        <img
          v-if="layer.fit === 'contain'"
          class="immersion-slideshow__backdrop"
          :src="layer.src"
          alt=""
          aria-hidden="true"
        />
        <img
          class="immersion-slideshow__img"
          :class="[
            `immersion-slideshow__img--${layer.fit}`,
            { [`immersion-slideshow__img--zoom-${layer.zoom}`]: layer.animating },
          ]"
          :src="layer.src"
          :alt="layer.alt"
          :style="{ transformOrigin: layer.origin }"
        />
      </div>
    </div>
    <div class="immersion-slideshow__caption" aria-live="polite">
      <div class="immersion-slideshow__caption-viewport">
        <!-- eslint-disable vue/no-v-html -->
        <p
          ref="sentenceEl"
          class="immersion-slideshow__sentence"
          :class="{ 'immersion-slideshow__sentence--instant': captionInstant }"
          :style="{ '--caption-page': captionPage }"
          v-html="props.sentence"
        />
        <!-- eslint-enable vue/no-v-html -->
      </div>
    </div>
  </div>
</template>

<style scoped>
.immersion-slideshow {
  position: fixed;
  inset: 0;
  z-index: 800;
  max-width: var(--immersion-column-width);
  margin-inline: auto;
  overflow: hidden;
  background-color: #000;
  --immersion-caption-height: calc(
    var(--spacing-75, 12px) + var(--line-height-small) * 3 + var(--immersion-bar-height, 48px) +
      var(--spacing-25, 4px)
  );
}

/* Images frame the space above the caption panel, which would hide anything below it. */
.immersion-slideshow__stage {
  position: absolute;
  inset: 0 0 var(--immersion-caption-height);
  overflow: hidden;
}

.immersion-slideshow__layer {
  position: absolute;
  inset: 0;
  opacity: 0;
  transition: opacity 1.5s ease-in-out;
}

.immersion-slideshow__layer--visible {
  opacity: 1;
}

.immersion-slideshow__backdrop {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
  filter: blur(24px) brightness(0.55);
  transform: scale(1.15);
}

.immersion-slideshow__img {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  will-change: transform;
}

.immersion-slideshow__img--cover {
  object-fit: cover;
}

.immersion-slideshow__img--contain {
  object-fit: contain;
}

.immersion-slideshow__img--zoom-in {
  animation: immersion-kb-in 15s ease-in-out forwards;
}

.immersion-slideshow__img--zoom-out {
  animation: immersion-kb-out 15s ease-in-out forwards;
}

@keyframes immersion-kb-in {
  from {
    transform: scale(1);
  }
  to {
    transform: scale(1.18);
  }
}

@keyframes immersion-kb-out {
  from {
    transform: scale(1.18);
  }
  to {
    transform: scale(1);
  }
}

/* Runs under the transport bar so caption and controls read as one panel. */
.immersion-slideshow__caption {
  position: absolute;
  inset: auto 0 0;
  z-index: 2;
  box-sizing: border-box;
  height: var(--immersion-caption-height);
  padding: var(--spacing-75, 12px) var(--spacing-125, 20px)
    calc(var(--immersion-bar-height, 48px) + var(--spacing-25, 4px));
  background-color: var(--background-color-interactive-subtle);
  pointer-events: none;
}

.immersion-slideshow__caption-viewport {
  height: calc(var(--line-height-small) * 3);
  overflow: hidden;
}

.immersion-slideshow__sentence {
  position: relative;
  margin: 0;
  font-family: var(--font-family-system-sans);
  font-size: var(--font-size-small);
  line-height: var(--line-height-small);
  color: var(--color-base);
  transform: translateY(calc(var(--caption-page, 0) * var(--line-height-small) * -3));
  transition: transform 0.3s ease;
}

.immersion-slideshow__sentence--instant {
  transition: none;
}

.immersion-slideshow__sentence :deep(a) {
  color: inherit;
  text-decoration: none;
}

.immersion-slideshow__sentence :deep(.tts-word.tts-active) {
  background: color-mix(in srgb, var(--color-progressive) 35%, transparent);
  text-decoration: underline;
  text-decoration-color: var(--color-progressive);
}
</style>
