<script setup lang="ts">
import type { TeamRecord } from 'ustp-domain';
import { COLOR_CLASSES } from './team-text.js';

/** A team's symbol on its colour, beside its name; decorative, since the name follows. */
defineProps<{ team: Pick<TeamRecord, 'color' | 'icon'>; size?: string }>();
</script>

<template>
  <q-avatar :size="size ?? '44px'" :color="COLOR_CLASSES[team.color]" text-color="white" :icon="team.icon" aria-hidden="true" />
</template>
