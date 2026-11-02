<script setup lang="ts">
definePage({
  meta: {
    category: 'prototype',
    platform: 'web',
  },
})

import { computed, onBeforeUnmount, ref, shallowRef, watch } from 'vue'
import { CdxButton, CdxIcon, CdxPopover } from '@wikimedia/codex'
import { cdxIconVolumeUp } from '@wikimedia/codex-icons'

import ArticleLive from '@/components/article/ArticleLive.vue'
import ChromeWrapper from '@/components/chrome/ChromeWrapper.vue'
import MobileWrapper from '@/components/MobileWrapper.vue'
import { useWikiPageTitleQuery } from '@/composables/useWikiPageTitleQuery'
import type { Theme } from '@/theme'

import calmReadingCloud from './calm-reading-cloud.png'
import ImmersionSlideshow from './ImmersionSlideshow.vue'
import ImmersionTransportBar from './ImmersionTransportBar.vue'
import { fetchSlideshowImages } from './slideshowImages'
import {
  audioManifestFor,
  collectSlideshowImages,
  useImmersionReader,
  type SlideshowImage,
} from './useImmersionReader'

const COLUMN_WIDTH = '412px'
const FOCUS_PAD = 16

const { titleFromQuery, setWikiPageTitle } = useWikiPageTitleQuery()
const article = computed(() => titleFromQuery.value ?? 'Earth')

const {
  active,
  paused,
  rate,
  progress,
  sentence,
  wordIndex,
  focusRect,
  attach,
  detach,
  togglePlay,
  stop,
  prev,
  next,
  setRate,
} = useImmersionReader()

const resolvedTitle = ref<string | null>(null)
const manifest = computed(() => audioManifestFor(resolvedTitle.value))

let articleEl: HTMLElement | null = null
const speakerHost = shallowRef<HTMLElement | null>(null)
const speakerButton = ref<InstanceType<typeof CdxButton> | null>(null)
const onboardOpen = ref(false)
let onboardTimer: ReturnType<typeof setTimeout> | undefined

const slideshowOn = ref(false)
const slideshowAvailable = ref(false)
const slideshowImages = shallowRef<SlideshowImage[]>([])
/** Commons originals across editions; the in-article thumbnails are the fallback. */
let originalImages: SlideshowImage[] = []
let originalsAbort: AbortController | undefined

function loadOriginalImages(title: string) {
  originalsAbort?.abort()
  originalsAbort = new AbortController()
  const { signal } = originalsAbort
  originalImages = []
  fetchSlideshowImages(title, signal)
    .then((images) => {
      if (signal.aborted) return
      originalImages = images
      if (images.length) slideshowAvailable.value = true
    })
    .catch(() => {})
}

onBeforeUnmount(() => originalsAbort?.abort())

const transportBar = ref<InstanceType<typeof ImmersionTransportBar> | null>(null)
const barHeight = ref(0)
let barObserver: ResizeObserver | undefined

watch(transportBar, (bar) => {
  barObserver?.disconnect()
  const el = bar?.$el as HTMLElement | undefined
  if (!el) return
  barObserver = new ResizeObserver(() => (barHeight.value = el.offsetHeight))
  barObserver.observe(el)
})

onBeforeUnmount(() => barObserver?.disconnect())

const immersiveTheme = computed<Theme | undefined>(() => (active.value ? 'dark' : undefined))

function onTitleResolved(title: string) {
  resolvedTitle.value = title
  if (title?.trim()) setWikiPageTitle(title)
}

/** The speaker sits first among the Minerva page actions, as in the Figma spec. */
function mountSpeakerHost(el: HTMLElement) {
  speakerHost.value?.remove()
  const toolbar =
    el.querySelector('.article-header__icon-toolbar-group--end') ??
    el.querySelector('.article-header__icon-toolbar')
  if (!toolbar) {
    speakerHost.value = null
    return
  }
  const host = document.createElement('span')
  host.className = 'immersion-speaker-host'
  toolbar.prepend(host)
  speakerHost.value = host
}

function onParserReady(root: HTMLElement) {
  articleEl = root.closest<HTMLElement>('.article') ?? root
  mountSpeakerHost(articleEl)
  attach(articleEl, manifest.value)
  slideshowAvailable.value = collectSlideshowImages(articleEl).length > 0
  loadOriginalImages(resolvedTitle.value ?? article.value)

  clearTimeout(onboardTimer)
  if (manifest.value) onboardTimer = setTimeout(() => (onboardOpen.value = !active.value), 400)
}

function onSpeakerClick() {
  onboardOpen.value = false
  togglePlay()
}

function onTryCalmReading() {
  onboardOpen.value = false
  togglePlay()
}

watch(article, () => {
  clearTimeout(onboardTimer)
  onboardOpen.value = false
  slideshowOn.value = false
  detach()
  originalsAbort?.abort()
  originalImages = []
  articleEl = null
  resolvedTitle.value = null
  speakerHost.value?.remove()
  speakerHost.value = null
})

watch(active, (on) => {
  if (!on) slideshowOn.value = false
})

watch(slideshowOn, (on) => {
  if (!on || !articleEl) return
  slideshowImages.value = originalImages.length ? originalImages : collectSlideshowImages(articleEl)
  if (!slideshowImages.value.length) slideshowOn.value = false
})

const focusPanels = computed(() => {
  const rect = focusRect.value
  if (!rect) return null
  return {
    top: { height: `${Math.max(0, rect.top - FOCUS_PAD)}px` },
    bottom: { top: `${rect.bottom + FOCUS_PAD}px` },
  }
})
</script>

<template>
  <div
    class="immersion"
    :class="{ 'immersion--active': active, 'immersion--slideshow': slideshowOn }"
    :data-theme="immersiveTheme"
    :style="{
      '--immersion-column-width': COLUMN_WIDTH,
      '--immersion-bar-height': `${barHeight}px`,
    }"
  >
    <MobileWrapper :max-width="COLUMN_WIDTH">
      <ChromeWrapper skin="mobile" :theme="immersiveTheme">
        <ArticleLive
          :article="article"
          @title-resolved="onTitleResolved"
          @parser-ready="onParserReady"
        />
      </ChromeWrapper>
    </MobileWrapper>

    <Teleport v-if="speakerHost" :to="speakerHost">
      <CdxButton
        ref="speakerButton"
        weight="quiet"
        :action="active ? 'progressive' : 'default'"
        :disabled="!manifest"
        :aria-label="active ? (paused ? 'Resume listening' : 'Pause listening') : 'Listen'"
        :aria-pressed="active"
        @click="onSpeakerClick"
      >
        <CdxIcon :icon="cdxIconVolumeUp" />
      </CdxButton>
    </Teleport>

    <CdxPopover
      v-if="speakerButton"
      v-model:open="onboardOpen"
      :anchor="speakerButton"
      placement="bottom-end"
      title="Calm reading"
      use-close-button
      :primary-action="{ label: 'Try calm reading', actionType: 'progressive' }"
      @primary="onTryCalmReading"
    >
      <img class="immersion-onboard__image" :src="calmReadingCloud" alt="" />
      <p class="immersion-onboard__body">
        Try our new immersive reading experience. Focus on the text, hear the words out loud, and
        learn without distraction.
      </p>
    </CdxPopover>

    <template v-if="active">
      <template v-if="focusPanels && !slideshowOn">
        <div class="immersion-focus immersion-focus--top" :style="focusPanels.top" />
        <div class="immersion-focus immersion-focus--bottom" :style="focusPanels.bottom" />
      </template>

      <ImmersionSlideshow
        v-if="slideshowOn"
        :images="slideshowImages"
        :sentence="sentence"
        :word-index="wordIndex"
      />

      <ImmersionTransportBar
        ref="transportBar"
        v-model:slideshow="slideshowOn"
        :paused="paused"
        :rate="rate"
        :progress="progress"
        :slideshow-available="slideshowAvailable"
        @toggle-play="togglePlay"
        @stop="stop"
        @prev="prev"
        @next="next"
        @set-rate="setRate"
      />
    </template>
  </div>
</template>

<style scoped>
.immersion--active :deep(.mobile-wrapper__column) {
  padding-bottom: 60px;
}

.immersion-focus {
  position: fixed;
  inset-inline: 0;
  z-index: 100;
  max-width: var(--immersion-column-width);
  margin-inline: auto;
  background-color: color-mix(in srgb, var(--background-color-base) 82%, transparent);
  pointer-events: none;
  transition:
    height 0.25s ease,
    top 0.25s ease;
}

.immersion-focus--top {
  top: 0;
}

.immersion-focus--bottom {
  bottom: 0;
}

.immersion-onboard__image {
  display: block;
  width: 100%;
  max-height: 220px;
  object-fit: cover;
  border-radius: var(--border-radius-base);
}

.immersion-onboard__body {
  margin: var(--spacing-75, 12px) 0 0;
}
</style>

<!-- Article markup comes from v-html, so these can't be scoped. -->
<style>
.immersion-speaker-host {
  display: contents;
}

/* The slideshow caption shares the bar's background; no rule between them. */
.immersion.immersion--slideshow .immersion-bar {
  border-top-color: transparent;
}

.immersion .tts-word {
  border-radius: 2px;
}

.immersion .tts-word.tts-active {
  background-color: color-mix(in srgb, var(--color-progressive) 18%, transparent);
  text-decoration: underline;
  text-decoration-color: var(--color-progressive);
}

.immersion .tts-para-active {
  position: relative;
  z-index: 150;
  border-radius: var(--border-radius-base);
  background-color: var(--background-color-progressive-subtle);
  box-shadow: 0 0 0 6px var(--background-color-progressive-subtle);
  transition: background-color 0.2s;
}

.immersion .immersion-heading-active,
.immersion .immersion-heading-active .protowiki-mobile-h2__label {
  text-decoration: underline;
  text-decoration-color: var(--color-progressive);
}

.immersion--active .mw-parser-output a {
  color: inherit !important;
  text-decoration: none !important;
  pointer-events: none;
}

.immersion--active .mw-parser-output sup {
  display: none;
}
</style>
