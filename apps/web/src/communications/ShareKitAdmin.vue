<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import {
  createSharePostSchema,
  kitItem,
  SHARE_LIMITS,
  SHARE_POST_LIMITS,
  SHARE_TARGET_NAMES,
  SHARE_TARGETS,
  shareLength,
  updateSharePostSchema,
  type NewsPostRecord,
  type ShareCountsRecord,
  type SharePostRecord,
} from 'ustp-domain';
import { focusFirstInvalid } from '../a11y.js';
import { attempt } from '../dialogs.js';
import { apiFieldErrors, validate, type FieldErrors } from '../forms.js';
import { confirmAction } from './admin-forms.js';
import { adminNews, adminShare, archiveShare, createShare, deleteShare, publishShare, saveShare, shareCounts } from './api.js';
import {
  formatHashtags,
  kitShareable,
  localDay,
  longDate,
  parseHashtags,
  SHARE_STATUS_COLORS,
  SHARE_STATUS_LABELS,
  targetIcon,
} from './comms-text.js';

/**
 * The share kit for Communications Admins (design §10.9): posts written for Active members to share from their own
 * accounts. Publishing puts one in the kit at once; it stays until its last day or until archived. Members see it
 * under Share kit; how often each site's button is pressed shows here.
 */
const posts = ref<SharePostRecord[] | null>(null);
const counts = ref<ShareCountsRecord[]>([]);
const news = ref<NewsPostRecord[]>([]);

interface Form {
  title: string;
  text: string;
  url: string;
  hashtags: string;
  note: string;
  until: string;
}
/** The editor: whether it is open, the post it edits (null for a new one), and the form. */
const editing = ref(false);
const current = ref<SharePostRecord | null>(null);
const blank = (): Form => ({ title: '', text: '', url: '', hashtags: '', note: '', until: '' });
const form = ref<Form>(blank());
const errors = ref<FieldErrors>({});
const busy = ref(false);

async function load() {
  await attempt(async () => {
    [posts.value, counts.value, news.value] = await Promise.all([adminShare(), shareCounts(), adminNews()]);
  });
}

const toForm = (p: SharePostRecord): Form => ({
  title: p.title,
  text: p.text,
  url: p.url,
  hashtags: formatHashtags(p.hashtags),
  note: p.note,
  until: p.until ?? '',
});

const published = computed(() => news.value.filter((n) => n.status === 'published').map((n) => ({ label: n.title, value: `/news/${n.slug}` })));
const countsOf = (shareId: string) => counts.value.find((c) => c.item === kitItem(shareId));

function startNew() {
  current.value = null;
  form.value = blank();
  editing.value = true;
  errors.value = {};
}

function open(p: SharePostRecord) {
  current.value = p;
  form.value = toForm(p);
  editing.value = true;
  errors.value = {};
}

const dirty = computed(() => editing.value && (!current.value || JSON.stringify(toForm(current.value)) !== JSON.stringify(form.value)));

/** How long each site counts the post as it stands in the form, against its limit. */
const fit = computed(() => {
  const f = form.value;
  if (!editing.value) return [];
  const item = kitShareable({ title: f.title, text: f.text, url: f.url.trim(), hashtags: parseHashtags(f.hashtags).map((t) => t.replace(/^#+/, '')) });
  return SHARE_TARGETS.filter((t) => SHARE_LIMITS[t] !== null && t !== 'reddit').map((t) => {
    const length = shareLength(t, item);
    return { target: t, name: SHARE_TARGET_NAMES[t], length, limit: SHARE_LIMITS[t]!, over: length > SHARE_LIMITS[t]! };
  });
});

async function save(): Promise<SharePostRecord | null> {
  if (!editing.value) return null;
  const post = current.value;
  const body = { ...form.value, hashtags: parseHashtags(form.value.hashtags), until: form.value.until || null };
  const checked = post ? validate(updateSharePostSchema, { ...body, basedOn: post.version }) : validate(createSharePostSchema, body);
  if (!checked.ok) {
    errors.value = checked.errors;
    await focusFirstInvalid();
    return null;
  }
  errors.value = {};
  let saved = null as SharePostRecord | null;
  busy.value = true;
  try {
    await attempt(async () => {
      try {
        saved = post
          ? await saveShare(post.shareId, checked.data as Parameters<typeof saveShare>[1])
          : await createShare(checked.data as Parameters<typeof createShare>[0]);
      } catch (err) {
        errors.value = apiFieldErrors(err);
        throw err;
      }
    }, 'Saved');
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
  const post = dirty.value ? await save() : current.value;
  if (!post) return;
  if (!(await confirmAction('Put this in the share kit?', 'Active members see it at once under Share kit. Publishing is recorded in the audit ledger.', 'Publish'))) return;
  let done = null as SharePostRecord | null;
  await attempt(async () => {
    done = await publishShare(post.shareId, post.version);
  }, 'In the share kit');
  if (done) {
    open(done);
    await load();
  }
}

async function archive() {
  const post = current.value;
  if (!post || !(await confirmAction('Archive this post?', 'Members no longer see it. An archived post stays archived; its share counts are kept.', 'Archive'))) return;
  let done = null as SharePostRecord | null;
  await attempt(async () => {
    done = await archiveShare(post.shareId, post.version);
  }, 'Archived');
  if (done) {
    open(done);
    await load();
  }
}

async function remove() {
  const post = current.value;
  if (!post || !(await confirmAction('Delete this draft?', 'Members have never seen it. Deleting it cannot be undone.', 'Delete'))) return;
  if (await attempt(() => deleteShare(post.shareId), 'Draft deleted')) {
    editing.value = false;
    await load();
  }
}

onMounted(load);
</script>

<template>
  <div class="ustp-content">
    <p class="text-grey-7">
      Ready-made posts for Active members to share from their own accounts, on the
      <router-link to="/share">Share kit</router-link> page. Each site's button opens it with the post filled in; members
      press Post themselves. Publishing, changing a published post and archiving are recorded in the audit ledger.
    </p>
    <div class="ustp-actions">
      <q-btn v-if="!editing" unelevated no-caps color="primary" icon="add" label="New post to share" @click="startNew" />
    </div>

    <q-card v-if="editing" flat bordered>
      <q-card-section>
        <h2 class="text-subtitle1">{{ current ? current.title : 'New post to share' }}</h2>
        <div v-if="current" class="text-caption text-grey-7">
          <q-badge :color="SHARE_STATUS_COLORS[current.status]" :label="SHARE_STATUS_LABELS[current.status]" />
          <template v-if="current.publishedAt"> · in the kit since {{ longDate(current.publishedAt) }}</template>
        </div>
      </q-card-section>
      <q-card-section>
        <q-form class="ustp-form" novalidate @submit.prevent="save">
          <q-input
            v-model="form.title"
            outlined
            dense
            label="What it is about"
            hint="Members see it as the post's heading; email and Reddit use it as the subject."
            :maxlength="SHARE_POST_LIMITS.title"
            :error="!!errors.title"
            :error-message="errors.title"
            :readonly="current?.status === 'archived'"
          />
          <q-input
            v-model="form.text"
            outlined
            type="textarea"
            autogrow
            label="The words to post"
            :maxlength="SHARE_POST_LIMITS.text"
            counter
            :error="!!errors.text"
            :error-message="errors.text"
            :readonly="current?.status === 'archived'"
          />
          <div class="ustp-row">
            <q-input
              v-model="form.url"
              outlined
              dense
              class="ustp-row__wide"
              label="Link (optional)"
              placeholder="/news/… or https://…"
              :error="!!errors.url"
              :error-message="errors.url"
              :readonly="current?.status === 'archived'"
            />
            <q-btn-dropdown v-if="published.length && current?.status !== 'archived'" flat no-caps label="Link a news post">
              <q-list>
                <q-item v-for="n in published" :key="n.value" v-close-popup clickable @click="form.url = n.value">
                  <q-item-section>{{ n.label }}</q-item-section>
                </q-item>
              </q-list>
            </q-btn-dropdown>
          </div>
          <q-input
            v-model="form.hashtags"
            outlined
            dense
            label="Hashtags (optional)"
            placeholder="#USTP"
            :error="!!errors.hashtags || Object.keys(errors).some((k) => k.startsWith('hashtags.'))"
            :error-message="errors.hashtags ?? Object.entries(errors).find(([k]) => k.startsWith('hashtags.'))?.[1]"
            :readonly="current?.status === 'archived'"
          />
          <q-input
            v-model="form.note"
            outlined
            dense
            label="A note for members (optional)"
            placeholder="Share during the debate tonight"
            :maxlength="SHARE_POST_LIMITS.note"
            :readonly="current?.status === 'archived'"
          />
          <q-input
            v-model="form.until"
            outlined
            dense
            type="date"
            label="Last day to offer it (optional)"
            stack-label
            :min="localDay()"
            :error="!!errors.until"
            :error-message="errors.until"
            :readonly="current?.status === 'archived'"
          />
          <div>
            <div class="text-body2 text-weight-medium">How each site counts it</div>
            <div class="share-fit">
              <span v-for="f in fit" :key="f.target" :class="f.over ? 'text-negative text-weight-bold' : 'text-grey-8'">
                <q-icon :name="targetIcon(f.target)" size="16px" class="q-mr-xs" />{{ f.name }} {{ f.length }}/{{ f.limit }}
              </span>
            </div>
            <div class="text-caption text-grey-7">Members can still shorten it on a site whose limit it passes.</div>
          </div>
          <div class="ustp-actions">
            <q-btn
              v-if="current?.status !== 'archived'"
              type="submit"
              unelevated
              no-caps
              color="primary"
              :label="current ? 'Save changes' : 'Save draft'"
              :disable="!dirty"
              :loading="busy"
            />
            <q-btn v-if="!current || current.status === 'draft'" outline no-caps color="primary" icon="share" label="Publish to the kit" :disable="busy" @click="publish" />
            <q-btn v-if="current?.status === 'published'" outline no-caps color="negative" label="Archive" @click="archive" />
            <q-btn v-if="current?.status === 'draft'" flat no-caps color="negative" label="Delete draft" @click="remove" />
            <q-btn flat no-caps label="Close" @click="editing = false" />
          </div>
        </q-form>
      </q-card-section>
    </q-card>

    <div v-if="posts && posts.length === 0 && !editing" class="text-grey-7">Nothing in the share kit yet.</div>
    <q-list v-else-if="posts" bordered separator class="rounded-borders">
      <q-item v-for="p in posts" :key="p.shareId" clickable :active="editing && current?.shareId === p.shareId" @click="open(p)">
        <q-item-section>
          <q-item-label>{{ p.title }}</q-item-label>
          <q-item-label caption class="ellipsis">{{ p.text }}</q-item-label>
          <q-item-label caption>
            <template v-if="p.until">Until {{ longDate(`${p.until}T12:00:00Z`) }} · </template>
            <template v-if="countsOf(p.shareId)">shared {{ countsOf(p.shareId)!.total }} times</template>
            <template v-else>not shared yet</template>
          </q-item-label>
        </q-item-section>
        <q-item-section side>
          <q-badge :color="SHARE_STATUS_COLORS[p.status]" :label="SHARE_STATUS_LABELS[p.status]" />
        </q-item-section>
      </q-item>
    </q-list>
  </div>
</template>

<style scoped>
.share-fit {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 16px;
}
</style>
