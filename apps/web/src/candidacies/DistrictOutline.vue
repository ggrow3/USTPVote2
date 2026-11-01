<script setup lang="ts">
import { ref, watch } from 'vue';
import type { ContactDistrict } from 'ustp-domain';
import { districtBoundary } from './api.js';
import { districtShape, type DistrictShape } from './district-shape.js';

/**
 * The outline of the district an office is elected from, drawn small beside it (design §5.8): the area the people
 * listed there represent, or would. Drawn from the Census boundary the map uses, without the map, so it shows where the
 * map is not set up too. The nation has none, and where the Census does not answer a pin stands in. Decorative: the
 * card names the district in words.
 */
const props = withDefaults(defineProps<{ district: Pick<ContactDistrict, 'kind' | 'geoid'>; size?: number }>(), { size: 56 });

const shape = ref<DistrictShape | null>(null);
const state = ref<'loading' | 'drawn' | 'none'>('loading');

watch(
  () => `${props.district.kind}:${props.district.geoid}`,
  async (key) => {
    shape.value = null;
    if (props.district.kind === 'nation') {
      state.value = 'none';
      return;
    }
    state.value = 'loading';
    const found = await districtBoundary(props.district.kind, props.district.geoid).then(districtShape, () => null);
    if (key !== `${props.district.kind}:${props.district.geoid}`) return;
    shape.value = found;
    state.value = found ? 'drawn' : 'none';
  },
  { immediate: true },
);
</script>

<template>
  <div class="district-outline" :class="{ 'district-outline--loading': state === 'loading' }" :style="{ width: `${size}px`, height: `${size}px` }" aria-hidden="true">
    <svg v-if="shape" :viewBox="shape.viewBox" preserveAspectRatio="xMidYMid meet" focusable="false">
      <path :d="shape.path" />
    </svg>
    <q-icon v-else-if="state === 'none'" :name="district.kind === 'nation' ? 'public' : 'place'" :size="`${Math.round(size / 2)}px`" />
  </div>
</template>

<style scoped>
.district-outline {
  flex: none;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 8px;
  background: rgba(127, 127, 127, 0.12);
  color: var(--q-primary);
  overflow: hidden;
}
.district-outline--loading {
  animation: district-outline-pulse 1.2s ease-in-out infinite alternate;
}
.district-outline svg {
  width: 84%;
  height: 84%;
}
.district-outline path {
  fill: var(--q-primary);
  fill-opacity: 0.3;
  fill-rule: evenodd;
  stroke: var(--q-primary);
  stroke-width: 1.5;
  stroke-linejoin: round;
  vector-effect: non-scaling-stroke;
}
@keyframes district-outline-pulse {
  to {
    opacity: 0.5;
  }
}
@media (prefers-reduced-motion: reduce) {
  .district-outline--loading {
    animation: none;
  }
}
</style>
