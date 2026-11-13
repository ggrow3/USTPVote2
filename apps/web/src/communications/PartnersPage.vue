<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useQuasar } from 'quasar';
import { courseEmbedPath, courseEmbedSnippet, EMBED_HEIGHT, EVENT_KIND_NAMES, type CourseMap, type PublicPartnersPage } from 'ustp-domain';
import { usePageTitle } from '../a11y.js';
import { APP_NAME } from '../app-name.js';
import { api, errorMessage } from '../api.js';
import PageShell from '../components/PageShell.vue';
import { partnersPage } from './api.js';
import CommsNav from './CommsNav.vue';
import { eventLocalTime, longDate } from './comms-text.js';

/**
 * Partners (design §10.17): the groups the party works with, listed only once each agreed to be, with the events it
 * co-hosts; and, for allied groups, the party's courses to show on their own sites: an `<iframe>` of the course embed,
 * or the public course api for a site of their own (§10.8).
 */
usePageTitle('Partners');
const $q = useQuasar();
const page = ref<PublicPartnersPage | null>(null);
const courses = ref<{ courseId: string; title: string }[]>([]);
const error = ref<string | null>(null);
/** The course the snippet shows; null for the list of every course. */
const chosen = ref<string | null>(null);
const preview = ref(false);

const origin = location.origin;
const options = computed(() => [
  { value: null, label: 'Every course (a list to choose from)' },
  ...courses.value.map((c) => ({ value: c.courseId, label: c.title })),
]);
const course = computed(() => courses.value.find((c) => c.courseId === chosen.value) ?? null);
const snippet = computed(() => courseEmbedSnippet(origin, course.value));
const previewSrc = computed(() => courseEmbedPath(chosen.value));

const ROUTES = [
  { path: '/v1/public/courses', what: 'the course map: every published course, and the drafts on the map as coming soon, in map order' },
  { path: '/v1/public/courses/{courseId}/package', what: 'a published course as its ustp.course file: lessons, videos, quizzes with their answers, and the futurist profiles' },
  { path: '/v1/public/course-images/{sha256}', what: 'an uploaded portrait, as a profile names it; keep its credit and licence with it' },
];

async function copy() {
  try {
    await navigator.clipboard.writeText(snippet.value);
    $q.notify({ type: 'positive', message: 'Copied the snippet' });
  } catch {
    $q.notify({ message: 'Select the snippet and copy it.', timeout: 6000 });
  }
}

onMounted(async () => {
  try {
    const [partners, map] = await Promise.all([partnersPage(), api<CourseMap>('GET', '/v1/public/courses')]);
    page.value = partners;
    courses.value = map.courses.filter((c) => c.published).map(({ courseId, title }) => ({ courseId, title }));
  } catch (e) {
    error.value = errorMessage(e);
  }
});
</script>

<template>
  <PageShell>
    <div class="ustp-content">
      <CommsNav />
      <div>
        <h1 class="text-h5 q-mb-xs">Partners</h1>
        <div class="text-grey-7">
          Groups the party works with: the <router-link to="/events">events</router-link> we hold together, and
          the party’s free courses, which any allied group may show on its own site.
        </div>
      </div>
      <q-banner v-if="error" class="bg-orange-1 text-black" rounded>{{ error }}</q-banner>
      <div v-else-if="!page" class="text-grey-7">Loading…</div>
      <template v-else>
        <section aria-labelledby="partners-list">
          <h2 id="partners-list" class="text-subtitle1 text-weight-medium">Our partners</h2>
          <div v-if="page.partners.length === 0" class="text-grey-7">No partner groups are listed yet.</div>
          <q-card v-for="p in page.partners" :id="`partner-${p.partnerId}`" :key="p.partnerId" flat bordered class="q-mb-md partner">
            <q-card-section>
              <h3 class="text-subtitle1 text-weight-medium q-my-none">
                <a v-if="p.website" :href="p.website" target="_blank" rel="noopener noreferrer">{{ p.name }}</a>
                <template v-else>{{ p.name }}</template>
              </h3>
              <div class="text-caption text-grey-7">Partner since {{ longDate(p.since) }}</div>
              <p v-if="p.description" class="q-mt-sm q-mb-none partner__text">{{ p.description }}</p>
            </q-card-section>
            <q-card-section v-if="p.upcoming.length || p.past.length" class="q-pt-none">
              <div v-if="p.upcoming.length" class="text-body2 text-weight-medium">Coming up together</div>
              <ul v-if="p.upcoming.length" class="q-my-xs">
                <li v-for="e in p.upcoming" :key="e.slug">
                  <router-link :to="`/events/${e.slug}`">{{ e.title }}</router-link>
                  <span class="text-grey-7"> · {{ EVENT_KIND_NAMES[e.kind] }} · {{ e.status === 'cancelled' ? 'cancelled' : eventLocalTime(e) }}</span>
                </li>
              </ul>
              <div v-if="p.past.length" class="text-body2 text-weight-medium">Held together</div>
              <ul v-if="p.past.length" class="q-my-xs">
                <li v-for="e in p.past" :key="e.slug">
                  <router-link :to="`/events/${e.slug}`">{{ e.title }}</router-link>
                  <span class="text-grey-7"> · {{ longDate(e.startsAt) }}<template v-if="e.recorded"> · recording</template></span>
                </li>
              </ul>
            </q-card-section>
          </q-card>
        </section>

        <section aria-labelledby="partners-embed">
          <h2 id="partners-embed" class="text-subtitle1 text-weight-medium">Show our courses on your site</h2>
          <p>
            Paste this into a page of your site and the course appears there: its lessons, its videos and its quizzes, checked as
            your visitors answer. The frame signs no one in, sets no cookies and runs no analytics; a YouTube video loads only
            once someone presses play. Certificates are earned on {{ APP_NAME }}, which the frame links to.
          </p>
          <q-select v-model="chosen" outlined dense emit-value map-options :options="options" label="Course" class="partners__course" />
          <q-input :model-value="snippet" outlined readonly type="textarea" autogrow label="Snippet to paste" class="q-mt-sm partners__snippet" />
          <div class="ustp-actions q-mt-sm">
            <q-btn unelevated no-caps color="primary" icon="content_copy" label="Copy the snippet" @click="copy" />
            <q-btn outline no-caps color="primary" :icon="preview ? 'visibility_off' : 'visibility'" :label="preview ? 'Hide the preview' : 'Show a preview'" @click="preview = !preview" />
          </div>
          <iframe
            v-if="preview"
            :key="previewSrc"
            :src="previewSrc"
            :title="`Preview: ${course?.title ?? 'every course'}`"
            class="partners__preview q-mt-md"
            :height="EMBED_HEIGHT"
            loading="lazy"
            allow="fullscreen; autoplay; encrypted-media; picture-in-picture"
          />
          <p class="text-caption text-grey-7 q-mt-sm">
            The frame is {{ EMBED_HEIGHT }} pixels tall and scrolls inside; change <code>height</code> to suit your page.
          </p>
        </section>

        <q-card flat bordered>
          <q-card-section>
            <h2 class="text-subtitle1">Or build your own</h2>
            <p class="q-mb-sm">
              The courses are a public api too, which any site may read from the browser, with no key or sign-in. Each portrait
              must keep the credit and licence the file gives with it.
            </p>
            <ul class="q-my-none partners__routes">
              <li v-for="r in ROUTES" :key="r.path"><code>GET {{ origin }}{{ r.path }}</code>: {{ r.what }}.</li>
            </ul>
          </q-card-section>
        </q-card>

        <q-card flat bordered>
          <q-card-section>
            <h2 class="text-subtitle1">Become a partner</h2>
            <p class="q-mb-sm">
              A group that would like to hold an event with the party, or be listed here, can tell us through the suggestions form.
              We list a group only once it has agreed to be, and take it off at once if it asks.
            </p>
            <q-btn outline no-caps color="primary" icon="lightbulb" label="Write to the party" :to="{ path: '/suggest', query: { topic: 'events' } }" />
          </q-card-section>
        </q-card>
      </template>
    </div>
  </PageShell>
</template>

<style scoped>
.partner__text {
  white-space: pre-line;
}
.partners__course {
  max-width: 480px;
}
.partners__snippet :deep(textarea) {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 0.85rem;
}
.partners__preview {
  width: 100%;
  border: 1px solid rgba(127, 127, 127, 0.4);
  border-radius: 8px;
}
.partners__routes code {
  overflow-wrap: anywhere;
}
</style>
