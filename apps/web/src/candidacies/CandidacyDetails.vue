<script setup lang="ts">
import type { CandidacyContent } from 'ustp-domain';
import { districtText, electionText, websiteText } from './candidacy-text.js';

/** One version of a candidacy: the office, where and when, the ballot label, the website and the platform (design §5.8). */
defineProps<{ content: CandidacyContent; name?: string }>();
</script>

<template>
  <div class="candidacy-details">
    <div>
      <div v-if="name" class="text-subtitle1 text-weight-medium">{{ name }}</div>
      <div class="text-body1">
        {{ content.officeTitle }}<template v-if="content.ballotLabel"> · <span class="text-grey-7">{{ content.ballotLabel }}</span></template>
      </div>
      <div class="text-grey-7">{{ districtText(content) }}</div>
      <div class="text-grey-7">{{ electionText(content) }}</div>
      <a v-if="content.website" :href="content.website" target="_blank" rel="noopener noreferrer nofollow ugc">{{ websiteText(content.website) }}</a>
    </div>
    <div>
      <div class="text-overline text-grey-7">Platform</div>
      <div class="candidacy-details__platform">{{ content.platform }}</div>
    </div>
  </div>
</template>

<style scoped>
.candidacy-details {
  display: grid;
  gap: 12px;
}
.candidacy-details__platform {
  white-space: pre-line;
  overflow-wrap: anywhere;
}
.candidacy-details a {
  overflow-wrap: anywhere;
}
</style>
