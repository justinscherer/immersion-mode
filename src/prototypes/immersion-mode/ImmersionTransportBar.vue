<script setup lang="ts">
import { computed } from 'vue'
import { CdxButton, CdxIcon, CdxMenuButton, CdxToggleButton } from '@wikimedia/codex'
import {
  cdxIconImageLayoutFrameless,
  cdxIconNext,
  cdxIconPause,
  cdxIconPlay,
  cdxIconPrevious,
  cdxIconStop,
} from '@wikimedia/codex-icons'

import { SPEED_OPTIONS } from './useImmersionReader'

interface Props {
  paused: boolean
  rate: number
  progress: number
  slideshowAvailable: boolean
}

const props = defineProps<Props>()
const slideshow = defineModel<boolean>('slideshow', { default: false })

const emit = defineEmits<{
  togglePlay: []
  stop: []
  prev: []
  next: []
  setRate: [rate: number]
}>()

const speedLabel = (r: number) => `${r}×`
const speedItems = SPEED_OPTIONS.map((r) => ({ value: String(r), label: speedLabel(r) }))

const selectedSpeed = computed({
  get: () => String(props.rate),
  set: (v: string | number | null) => {
    if (v != null) emit('setRate', Number(v))
  },
})
</script>

<template>
  <div class="immersion-bar">
    <div class="immersion-bar__progress" aria-hidden="true">
      <div
        class="immersion-bar__progress-fill"
        :style="{ width: `${Math.min(1, props.progress) * 100}%` }"
      />
    </div>
    <div class="immersion-bar__row">
      <CdxMenuButton
        v-model:selected="selectedSpeed"
        :menu-items="speedItems"
        class="immersion-bar__speed"
        aria-label="Playback speed"
      >
        {{ speedLabel(props.rate) }}
      </CdxMenuButton>

      <CdxToggleButton
        v-if="props.slideshowAvailable"
        v-model="slideshow"
        quiet
        aria-label="Slideshow"
      >
        <CdxIcon :icon="cdxIconImageLayoutFrameless" />
      </CdxToggleButton>

      <div class="immersion-bar__transport">
        <CdxButton weight="quiet" aria-label="Previous section" @click="emit('prev')">
          <CdxIcon :icon="cdxIconPrevious" />
        </CdxButton>
        <CdxButton weight="quiet" aria-label="Stop" @click="emit('stop')">
          <CdxIcon :icon="cdxIconStop" />
        </CdxButton>
        <CdxButton
          weight="quiet"
          :aria-label="props.paused ? 'Play' : 'Pause'"
          @click="emit('togglePlay')"
        >
          <CdxIcon :icon="props.paused ? cdxIconPlay : cdxIconPause" />
        </CdxButton>
        <CdxButton weight="quiet" aria-label="Next section" @click="emit('next')">
          <CdxIcon :icon="cdxIconNext" />
        </CdxButton>
      </div>
    </div>
  </div>
</template>

<style scoped>
.immersion-bar {
  position: fixed;
  inset: auto 0 0;
  z-index: 850;
  max-width: var(--immersion-column-width);
  margin-inline: auto;
  padding-bottom: env(safe-area-inset-bottom);
  background-color: var(--background-color-interactive-subtle);
  border-top: var(--border-width-base) solid var(--border-color-subtle);
  color: var(--color-base);
}

.immersion-bar__progress {
  height: 3px;
  background-color: var(--background-color-disabled-subtle);
}

.immersion-bar__progress-fill {
  height: 100%;
  background-color: var(--color-progressive);
  transition: width 0.3s ease;
}

.immersion-bar__row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--spacing-50, 8px);
  padding: var(--spacing-35, 6px) var(--spacing-100, 16px);
}

.immersion-bar__speed :deep(.cdx-toggle-button) {
  min-width: 44px;
  font-weight: var(--font-weight-bold);
  color: var(--color-progressive);
}

.immersion-bar__transport {
  display: flex;
  align-items: center;
  margin-inline-start: auto;
}
</style>
