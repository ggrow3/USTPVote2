<script setup lang="ts">
import { computed } from 'vue';
import type { VisitSourcesReport } from 'ustp-domain';

/**
 * Where the period's visitors came from (design §10.7), under Admin › Security › Page visits: arrivals (the first page
 * of a browser tab) by the referring site's host, by campaign tags and by the page they arrived at, and how many came
 * by a member's referral link. Counts only, naming nobody.
 */
const props = defineProps<{ sources: VisitSourcesReport }>();

const share = (n: number) => (props.sources.arrivals ? `${Math.round((n / props.sources.arrivals) * 100)}%` : '0%');
const totals = computed(() => [
  { label: 'From other sites', n: props.sources.fromSites },
  { label: 'With campaign tags', n: props.sources.withCampaign },
  { label: "By a member's referral link", n: props.sources.byReferralLink },
  { label: 'Direct or unknown', n: props.sources.direct },
]);
const tag = (value: string | null) => value ?? '—';
</script>

<template>
  <div class="ustp-content">
    <p class="q-my-none">
      <strong>{{ sources.arrivals }}</strong> {{ sources.arrivals === 1 ? 'arrival' : 'arrivals' }}: the first page opened in a
      browser tab, counted with the site that sent the visitor (its name only), the address's <code>utm_source</code>,
      <code>utm_medium</code> and <code>utm_campaign</code> tags, and whether it was a member's referral link. Nobody is
      named, signed in or not. A visitor can be in more than one of these.
    </p>
    <div class="row q-gutter-md text-body2" role="status">
      <span v-for="t in totals" :key="t.label">{{ t.label }}: {{ t.n }} ({{ share(t.n) }})</span>
    </div>
    <q-banner v-if="sources.truncated" class="bg-orange-2 text-black" rounded>
      This period has more records than one report reads: the oldest are left out. Pick a shorter period.
    </q-banner>

    <div class="row q-col-gutter-md">
      <div class="col-12 col-md-6">
        <q-markup-table flat bordered dense wrap-cells class="sources">
          <caption class="text-left text-subtitle2 q-pa-sm">Sites that sent visitors</caption>
          <thead>
            <tr>
              <th scope="col" class="text-left">Site</th>
              <th scope="col" class="text-right">Arrivals</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="s in sources.sites" :key="s.host">
              <td>{{ s.host }}</td>
              <td class="text-right">{{ s.arrivals }}</td>
            </tr>
            <tr v-if="!sources.sites.length">
              <td colspan="2" class="text-grey-7">No visitor came from another site in this period.</td>
            </tr>
          </tbody>
        </q-markup-table>
      </div>
      <div class="col-12 col-md-6">
        <q-markup-table flat bordered dense wrap-cells class="sources">
          <caption class="text-left text-subtitle2 q-pa-sm">Pages visitors arrived at</caption>
          <thead>
            <tr>
              <th scope="col" class="text-left">Page</th>
              <th scope="col" class="text-right">Arrivals</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="l in sources.landings" :key="l.page">
              <td>{{ l.label }}</td>
              <td class="text-right">{{ l.arrivals }}</td>
            </tr>
            <tr v-if="!sources.landings.length">
              <td colspan="2" class="text-grey-7">No arrivals in this period.</td>
            </tr>
          </tbody>
        </q-markup-table>
      </div>
    </div>

    <q-markup-table flat bordered dense wrap-cells class="sources">
      <caption class="text-left text-subtitle2 q-pa-sm">Campaigns</caption>
      <thead>
        <tr>
          <th scope="col" class="text-left">Source</th>
          <th scope="col" class="text-left">Medium</th>
          <th scope="col" class="text-left">Campaign</th>
          <th scope="col" class="text-right">Arrivals</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="c in sources.campaigns" :key="`${c.source}|${c.medium}|${c.campaign}`">
          <td>{{ tag(c.source) }}</td>
          <td>{{ tag(c.medium) }}</td>
          <td>{{ tag(c.campaign) }}</td>
          <td class="text-right">{{ c.arrivals }}</td>
        </tr>
        <tr v-if="!sources.campaigns.length">
          <td colspan="4" class="text-grey-7">
            No arrival had campaign tags in this period. Add them to the links you post, e.g.
            <code>?utm_source=mastodon&amp;utm_medium=social&amp;utm_campaign=spring</code>.
          </td>
        </tr>
      </tbody>
    </q-markup-table>
  </div>
</template>

<style scoped>
.sources {
  max-height: 60vh;
  overflow: auto;
}
.sources caption {
  caption-side: top;
}
</style>
