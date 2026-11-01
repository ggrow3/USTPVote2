<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue';
import { useRouter } from 'vue-router';
import type { DistrictKind, MapPoint } from 'ustp-domain';
import { districtBoundary } from './api.js';
import { loadGoogleMaps, mapsRefused } from './maps.js';

/** One candidacy on the map: a pin at a point inside its district. */
export interface MapMarker {
  readonly id: string;
  readonly point: MapPoint;
  readonly title: string;
  readonly caption: string;
  /** Where its link in the pop-up goes. */
  readonly to?: string;
  /** A district rather than a candidacy (the Candidates page's people running there): drawn as a ring. */
  readonly hollow?: boolean;
}

/**
 * A Google map of candidacies (design §5.8): a pin for each, and the outline of one district, from the Census. The map
 * only adds to the page: everything on it is in the page's text too, so where the map cannot load the page says so and
 * goes on without it.
 */
const props = withDefaults(
  defineProps<{
    markers?: readonly MapMarker[];
    outline?: { readonly kind: DistrictKind; readonly geoid: string } | null;
    /** The map's accessible name, e.g. "Map of Congressional District 12, California". */
    label: string;
    height?: string;
    /** Show nothing at all where the map is not set up or cannot load, instead of saying so. */
    optional?: boolean;
  }>(),
  { markers: () => [], outline: null, height: '360px', optional: false },
);
/** `select`: a pin was clicked, with its marker's ID; `ready`: the map is showing. */
const emit = defineEmits<{ select: [id: string]; ready: [] }>();

const router = useRouter();
const el = ref<HTMLElement | null>(null);
const state = ref<'loading' | 'ready' | 'off' | 'failed'>('loading');
const map = shallowRef<google.maps.Map | null>(null);
let info: google.maps.InfoWindow | null = null;
let drawn = 0;

/** The contiguous United States. */
const US_CENTER = { lat: 39.5, lng: -98.35 };

const primary = () => getComputedStyle(document.body).getPropertyValue('--q-primary').trim() || '#1976d2';

/** The pop-up's content, built from text nodes: titles and captions are what members wrote. */
function popup(marker: MapMarker): HTMLElement {
  const box = document.createElement('div');
  box.className = 'district-map__popup';
  const title = document.createElement('div');
  title.className = 'district-map__popup-title';
  title.textContent = marker.title;
  const caption = document.createElement('div');
  caption.textContent = marker.caption;
  box.append(title, caption);
  if (marker.to) {
    const link = document.createElement('a');
    link.href = marker.to;
    link.textContent = 'See the candidacy';
    link.addEventListener('click', (event) => {
      event.preventDefault();
      void router.push(marker.to!);
    });
    box.append(link);
  }
  return box;
}

async function draw(): Promise<void> {
  const gmap = map.value;
  if (!gmap) return;
  const run = ++drawn;
  const old: google.maps.Data.Feature[] = [];
  gmap.data.forEach((feature) => old.push(feature));
  for (const feature of old) gmap.data.remove(feature);
  info?.close();
  const bounds = new google.maps.LatLngBounds();
  for (const m of props.markers) {
    gmap.data.add({ geometry: new google.maps.Data.Point(m.point), id: m.id, properties: { marker: true, hollow: m.hollow === true } });
    bounds.extend(m.point);
  }
  let outlined = false;
  if (props.outline) {
    try {
      const boundary = await districtBoundary(props.outline.kind, props.outline.geoid);
      if (run !== drawn) return;
      for (const feature of gmap.data.addGeoJson(boundary)) {
        feature.getGeometry()?.forEachLatLng((latLng) => bounds.extend(latLng));
        outlined = true;
      }
    } catch {
      // No outline (the nation, or the Census not answering): the pin still shows where it is.
    }
  }
  if (outlined || props.markers.length > 1) {
    gmap.fitBounds(bounds, 24);
  } else if (props.markers.length === 1) {
    gmap.setCenter(props.markers[0]!.point);
    gmap.setZoom(props.outline?.kind === 'nation' ? 4 : 7);
  } else {
    gmap.setCenter(US_CENTER);
    gmap.setZoom(4);
  }
}

onMounted(async () => {
  const maps = await loadGoogleMaps();
  if (!el.value) return;
  if (!maps) {
    state.value = 'off';
    return;
  }
  try {
    const gmap = new maps.Map(el.value, {
      center: US_CENTER,
      zoom: 4,
      mapTypeControl: false,
      streetViewControl: false,
      gestureHandling: 'cooperative',
    });
    const color = primary();
    gmap.data.setStyle((feature) =>
      feature.getProperty('marker')
        ? {
            icon: feature.getProperty('hollow')
              ? { path: maps.SymbolPath.CIRCLE, scale: 8, fillColor: '#ffffff', fillOpacity: 1, strokeColor: color, strokeWeight: 3 }
              : { path: maps.SymbolPath.CIRCLE, scale: 8, fillColor: color, fillOpacity: 1, strokeColor: '#ffffff', strokeWeight: 2 },
            title: props.markers.find((m) => m.id === feature.getId())?.title ?? '',
            cursor: 'pointer',
          }
        : { fillColor: color, fillOpacity: 0.15, strokeColor: color, strokeWeight: 2, clickable: false },
    );
    info = new maps.InfoWindow();
    gmap.data.addListener('click', (event: google.maps.Data.MouseEvent) => {
      const marker = props.markers.find((m) => m.id === event.feature.getId());
      if (!marker) return;
      emit('select', marker.id);
      info!.setContent(popup(marker));
      info!.setPosition(marker.point);
      info!.open({ map: gmap });
    });
    map.value = gmap;
    state.value = 'ready';
    emit('ready');
    await draw();
  } catch {
    state.value = 'failed';
  }
});

watch(() => [props.markers, props.outline], () => void draw());

onBeforeUnmount(() => {
  info?.close();
  map.value = null;
});
</script>

<template>
  <div v-if="!(optional && (state === 'off' || state === 'failed' || mapsRefused))" class="district-map">
    <div
      v-show="(state === 'ready' || state === 'loading') && !mapsRefused"
      ref="el"
      class="district-map__canvas"
      role="region"
      :aria-label="label"
      :style="{ height }"
    />
    <div v-if="state === 'loading'" class="district-map__note text-grey-7">Loading the map…</div>
    <div v-else-if="state === 'off'" class="district-map__note text-grey-7">The map is not set up here yet.</div>
    <div v-else-if="state === 'failed' || mapsRefused" class="district-map__note text-grey-7">The map could not load.</div>
  </div>
</template>

<style scoped>
.district-map__canvas {
  width: 100%;
  border-radius: 8px;
  overflow: hidden;
  border: 1px solid rgba(0, 0, 0, 0.12);
}
.district-map__note {
  padding: 8px 0;
}
:deep(.district-map__popup) {
  max-width: 240px;
  color: #000;
  display: grid;
  gap: 4px;
}
:deep(.district-map__popup-title) {
  font-weight: 600;
}
</style>
