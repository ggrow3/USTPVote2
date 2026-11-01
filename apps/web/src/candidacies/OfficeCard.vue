<script setup lang="ts">
import type { ContactDistrict, PublicOffice } from 'ustp-domain';
import { hasRole } from '../session.js';
import { districtText, OFFICE_HEADINGS } from './candidacy-text.js';
import DistrictOutline from './DistrictOutline.vue';

/**
 * One office of an area on the Candidates and Your area pages (design §5.8, §5.12): the outline of its district, the
 * office and the district by name, then its people, which the default slot lists, or what it says when nobody is
 * listed, with a link for Communications Admins to add someone. Where the page's map can draw the district, *Map* (or
 * a click on the outline) shows it there.
 */
defineProps<{
  office: PublicOffice;
  district: ContactDistrict;
  /** The page's map can outline this district. */
  mappable?: boolean;
  /** What the card says when nobody is listed for the office; none while someone is. */
  empty?: string | null;
  /** A line under its people, such as that the seat is not on this election's ballot. */
  note?: string | null;
}>();
const emit = defineEmits<{ map: [] }>();
</script>

<template>
  <q-card flat bordered class="office-card">
    <div class="office-card__head">
      <DistrictOutline :district="district" :class="{ 'office-card__outline--map': mappable }" @click="mappable && emit('map')" />
      <div class="office-card__names">
        <h3 class="office-card__title">{{ OFFICE_HEADINGS[office] }}</h3>
        <div class="text-caption text-grey-7">{{ districtText({ district }) }}</div>
      </div>
      <q-btn
        v-if="mappable"
        flat
        dense
        no-caps
        size="sm"
        color="primary"
        icon="map"
        label="Map"
        :aria-label="`Show ${districtText({ district })} on the map`"
        @click="emit('map')"
      />
    </div>
    <slot />
    <div v-if="note" class="text-caption text-grey-7 q-px-md q-pb-sm">{{ note }}</div>
    <div v-if="empty" class="text-caption text-grey-7 q-px-md q-pb-sm">
      {{ empty }}
      <router-link v-if="hasRole('communications_admin')" to="/admin?tab=communications&view=people">Add someone</router-link>
    </div>
  </q-card>
</template>

<style scoped>
.office-card__head {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 12px 6px;
}
.office-card__names {
  flex: 1;
  min-width: 0;
}
.office-card__title {
  font-size: 1rem;
  font-weight: 500;
  line-height: 1.3;
  margin: 0;
}
.office-card__outline--map {
  cursor: pointer;
}
</style>
