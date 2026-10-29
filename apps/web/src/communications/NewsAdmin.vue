<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import {
  createNewsSchema,
  NEWS_KINDS,
  NEWS_LIMITS,
  publishProblem,
  slugFrom,
  updateNewsSchema,
  type NewsKind,
  type NewsPostRecord,
} from 'ustp-domain';
import { focusFirstInvalid } from '../a11y.js';
import { attempt } from '../dialogs.js';
import { apiFieldErrors, validate, type FieldErrors } from '../forms.js';
import { confirmAction } from './admin-forms.js';
import { adminNews, createNews, deleteNews, publishNews, saveNews, withdrawNews } from './api.js';
import { formatHashtags, longDate, NEWS_KIND_NAMES, NEWS_STATUS_COLORS, NEWS_STATUS_LABELS, parseHashtags } from './comms-text.js';
import NewsBody from './NewsBody.vue';

/**
 * News and press releases for Communications Admins (design §10.7): drafts, then publishing (public at once, and in
 * the audit ledger), edits of published posts (ledgered too) and withdrawal. A draft never published can be deleted.
 */
const posts = ref<NewsPostRecord[] | null>(null);

interface Form {
  kind: NewsKind;
  title: string;
  slug: string;
  summary: string;
  body: string;
  dateline: string;
  hashtags: string;
}
/** The editor: whether it is open, the post it edits (null for a new one), and the form. */
const editing = ref(false);
const current = ref<NewsPostRecord | null>(null);
const blank = (): Form => ({ kind: 'press_release', title: '', slug: '', summary: '', body: '', dateline: '', hashtags: '' });
const form = ref<Form>(blank());
const slugTouched = ref(false);
const errors = ref<FieldErrors>({});
const preview = ref(false);
const busy = ref(false);

const kinds = NEWS_KINDS.map((value) => ({ value, label: NEWS_KIND_NAMES[value] }));

async function load() {
  await attempt(async () => {
    posts.value = await adminNews();
  });
}

const toForm = (p: NewsPostRecord): Form => ({
  kind: p.kind,
  title: p.title,
  slug: p.slug,
  summary: p.summary,
  body: p.body,
  dateline: p.dateline,
  hashtags: formatHashtags(p.hashtags),
});

function startNew() {
  current.value = null;
  form.value = blank();
  slugTouched.value = false;
  editing.value = true;
  errors.value = {};
  preview.value = false;
}

function open(p: NewsPostRecord) {
  current.value = p;
  form.value = toForm(p);
  slugTouched.value = true;
  editing.value = true;
  errors.value = {};
  preview.value = false;
}

// A new post's address follows its title until someone types one of their own.
watch(
  () => form.value.title,
  (title) => {
    if (editing.value && !slugTouched.value && !current.value?.publishedAt) form.value.slug = slugFrom(title);
  },
);

const dirty = computed(() => editing.value && (!current.value || JSON.stringify(toForm(current.value)) !== JSON.stringify(form.value)));
const notReady = computed(() => (editing.value ? publishProblem(form.value) : null));

/** Saves the form (a new draft, or changes) and returns the post as saved; null if refused. */
async function save(): Promise<NewsPostRecord | null> {
  if (!editing.value) return null;
  const post = current.value;
  const body = { ...form.value, hashtags: parseHashtags(form.value.hashtags) };
  const checked = post ? validate(updateNewsSchema, { ...body, basedOn: post.version }) : validate(createNewsSchema, body);
  if (!checked.ok) {
    errors.value = checked.errors;
    await focusFirstInvalid();
    return null;
  }
  errors.value = {};
  let saved = null as NewsPostRecord | null;
  busy.value = true;
  try {
    await attempt(async () => {
      try {
        saved = post
          ? await saveNews(post.postId, checked.data as Parameters<typeof saveNews>[1])
          : await createNews(checked.data as Parameters<typeof createNews>[0]);
      } catch (err) {
        errors.value = apiFieldErrors(err);
        throw err;
      }
    }, post?.status === 'published' ? 'Saved: the published post has changed, and the change is in the audit ledger' : 'Draft saved');
  } finally {
    busy.value = false;
  }
  if (saved) {
    open(saved);
    await load();
  }
  return saved;
}

async function publish() {
  if (!editing.value) return;
  const post = dirty.value ? await save() : current.value;
  if (!post) return;
  const ok = await confirmAction(
    'Publish this post?',
    `“${post.title}” goes on the News page and into the news feeds at once, at /news/${post.slug}, which cannot change afterwards. Publishing is recorded in the audit ledger.`,
    'Publish',
  );
  if (!ok) return;
  let published = null as NewsPostRecord | null;
  await attempt(async () => {
    published = await publishNews(post.postId, post.version);
  }, 'Published');
  if (published) {
    open(published);
    await load();
  }
}

async function withdraw() {
  const post = current.value;
  if (!post) return;
  const ok = await confirmAction(
    'Withdraw this post?',
    'It leaves the News page and the feeds, and its page says it was withdrawn and when. Withdrawing is recorded in the audit ledger; you can publish it again later.',
    'Withdraw',
  );
  if (!ok) return;
  let withdrawn = null as NewsPostRecord | null;
  await attempt(async () => {
    withdrawn = await withdrawNews(post.postId, post.version);
  }, 'Withdrawn');
  if (withdrawn) {
    open(withdrawn);
    await load();
  }
}

async function remove() {
  const post = current.value;
  if (!post || !(await confirmAction('Delete this draft?', `“${post.title}” has never been published. Deleting it cannot be undone.`, 'Delete'))) return;
  if (await attempt(() => deleteNews(post.postId), 'Draft deleted')) {
    editing.value = false;
    await load();
  }
}

onMounted(load);
</script>

<template>
  <div class="ustp-content">
    <p class="text-grey-7">
      Press releases, statements and news appear on the public <router-link to="/news">News page</router-link> and in
      the news feeds as soon as you publish them. Publishing, changing a published post and withdrawing one are recorded
      in the audit ledger; drafts are not.
    </p>
    <div class="ustp-actions">
      <q-btn v-if="!editing" unelevated no-caps color="primary" icon="add" label="New post" @click="startNew" />
    </div>

    <q-card v-if="editing" flat bordered>
      <q-card-section class="ustp-header">
        <div>
          <h2 class="text-subtitle1">{{ current ? current.title : 'New post' }}</h2>
          <div v-if="current" class="text-caption text-grey-7">
            <q-badge :color="NEWS_STATUS_COLORS[current.status]" :label="NEWS_STATUS_LABELS[current.status]" />
            <template v-if="current.publishedAt"> · published {{ longDate(current.publishedAt) }}</template>
            <template v-if="current.editedAt"> · changed {{ longDate(current.editedAt) }}</template>
            · version {{ current.version }}
          </div>
        </div>
        <q-btn
          v-if="current?.status === 'published'"
          flat
          no-caps
          color="primary"
          icon-right="north_east"
          label="View"
          :to="`/news/${current.slug}`"
          target="_blank"
          aria-label="View the post (opens in a new tab)"
        />
      </q-card-section>
      <q-card-section>
        <q-form class="ustp-form" novalidate @submit.prevent="save">
          <q-select v-model="form.kind" outlined dense emit-value map-options :options="kinds" label="Kind" />
          <q-input v-model="form.title" outlined label="Title" :maxlength="NEWS_LIMITS.title" counter :error="!!errors.title" :error-message="errors.title" />
          <q-input
            v-model="form.slug"
            outlined
            dense
            label="Address"
            prefix="/news/"
            :readonly="!!current?.publishedAt"
            :hint="current?.publishedAt ? 'Fixed once published, so links to it keep working.' : 'Fixed once it is published.'"
            :error="!!errors.slug"
            :error-message="errors.slug"
            @update:model-value="slugTouched = true"
          />
          <q-input
            v-model="form.summary"
            outlined
            type="textarea"
            autogrow
            label="Summary"
            hint="One or two sentences: the News list, share buttons and the feeds carry it."
            :maxlength="NEWS_LIMITS.summary"
            counter
            :error="!!errors.summary"
            :error-message="errors.summary"
          />
          <q-input v-model="form.dateline" outlined dense label="Dateline (optional)" placeholder="Washington, D.C." :maxlength="NEWS_LIMITS.dateline" />
          <div>
            <div class="ustp-header">
              <div class="text-body2 text-weight-medium">Text</div>
              <q-btn-toggle
                v-model="preview"
                dense
                flat
                no-caps
                toggle-color="primary"
                :options="[
                  { label: 'Write', value: false },
                  { label: 'Preview', value: true },
                ]"
              />
            </div>
            <q-input
              v-if="!preview"
              v-model="form.body"
              outlined
              type="textarea"
              autogrow
              :input-style="{ minHeight: '12em' }"
              aria-label="Text"
              hint="Plain text. A blank line starts a paragraph; “## ” a heading, “- ” a list item, “> ” a quotation; https:// addresses become links."
              :maxlength="NEWS_LIMITS.body"
              :error="!!errors.body"
              :error-message="errors.body"
            />
            <q-card v-else flat bordered class="q-pa-md">
              <NewsBody v-if="form.body.trim()" :body="form.body" />
              <div v-else class="text-grey-7">Nothing written yet.</div>
            </q-card>
          </div>
          <q-input
            v-model="form.hashtags"
            outlined
            dense
            label="Hashtags (optional)"
            placeholder="#USTP #Transhumanism"
            hint="Up to 5; share buttons add them after the summary."
            :error="!!errors.hashtags || Object.keys(errors).some((k) => k.startsWith('hashtags.'))"
            :error-message="errors.hashtags ?? Object.entries(errors).find(([k]) => k.startsWith('hashtags.'))?.[1]"
          />
          <div class="ustp-actions">
            <q-btn type="submit" unelevated no-caps color="primary" :label="current ? 'Save changes' : 'Save draft'" :disable="!dirty" :loading="busy" />
            <q-btn
              v-if="current?.status !== 'published'"
              outline
              no-caps
              color="primary"
              icon="campaign"
              :label="current?.status === 'withdrawn' ? 'Publish again' : 'Publish'"
              :disable="!!notReady || busy"
              @click="publish"
            />
            <q-btn v-if="current?.status === 'published'" outline no-caps color="negative" label="Withdraw" @click="withdraw" />
            <q-btn v-if="current && !current.publishedAt" flat no-caps color="negative" label="Delete draft" @click="remove" />
            <q-btn flat no-caps label="Close" @click="editing = false" />
          </div>
          <div v-if="notReady && current?.status !== 'published'" class="text-caption text-grey-7">To publish: {{ notReady }}.</div>
        </q-form>
      </q-card-section>
    </q-card>

    <div v-if="posts && posts.length === 0 && !editing" class="text-grey-7">No posts yet.</div>
    <q-list v-else-if="posts" bordered separator class="rounded-borders">
      <q-item v-for="p in posts" :key="p.postId" clickable :active="editing && current?.postId === p.postId" @click="open(p)">
        <q-item-section>
          <q-item-label>{{ p.title }}</q-item-label>
          <q-item-label caption>
            {{ NEWS_KIND_NAMES[p.kind] }} · /news/{{ p.slug }} ·
            {{ p.publishedAt ? `published ${longDate(p.publishedAt)}` : `changed ${longDate(p.updatedAt)}` }}
          </q-item-label>
        </q-item-section>
        <q-item-section side>
          <q-badge :color="NEWS_STATUS_COLORS[p.status]" :label="NEWS_STATUS_LABELS[p.status]" />
        </q-item-section>
      </q-item>
    </q-list>
  </div>
</template>
