<script setup lang="ts">
import { onMounted, ref } from 'vue';
import type { ProfilePhotoRecord } from 'ustp-domain';
import { api } from '../../api.js';
import { askReason, attempt } from '../../dialogs.js';
import { STATUS_LABELS, useAuthenticatedImages } from '../../photos.js';
import { session } from '../../session.js';

type Status = 'needs_review' | 'accepted' | 'rejected';

const status = ref<Status>('needs_review');
const rows = ref<ProfilePhotoRecord[]>([]);
/** An empty list only means "none" once a load has succeeded. */
const listState = ref<'loading' | 'ready' | 'failed'>('loading');
const { urls, load: loadImage } = useAuthenticatedImages();

async function load() {
  const ok = await attempt(async () => {
    rows.value = await api<ProfilePhotoRecord[]>('GET', `/v1/admin/photos?status=${status.value}`);
  });
  listState.value = ok ? 'ready' : 'failed';
  await Promise.all(
    rows.value.filter((p) => p.storagePath).map((p) => loadImage(p.photoId, `/v1/admin/photos/${p.photoId}/image`)),
  );
}

async function decide(photo: ProfilePhotoRecord, decision: 'accept' | 'reject') {
  const reason = await askReason(
    decision === 'accept' ? 'Accept photo' : 'Reject photo',
    decision === 'reject'
      ? 'The member sees this reason and the image is deleted.'
      : 'Recorded in the audit ledger with the automatic flags.',
  );
  if (reason === null) return;
  const ok = await attempt(
    () => api('POST', `/v1/admin/photos/${photo.photoId}/decision`, { decision, reason }),
    decision === 'accept' ? 'Photo accepted' : 'Photo rejected and deleted',
  );
  if (ok) await load();
}

onMounted(load);
</script>

<template>
  <div>
    <div class="row items-center q-gutter-sm q-mb-md">
      <q-btn-toggle
        v-model="status"
        no-caps
        dense
        toggle-color="primary"
        role="group"
        aria-label="Show photos"
        :options="[
          { label: 'Needs review', value: 'needs_review' },
          { label: 'Accepted', value: 'accepted' },
          { label: 'Rejected', value: 'rejected' },
        ]"
        @update:model-value="load"
      />
      <q-btn flat dense icon="refresh" aria-label="Refresh photos" @click="load" />
    </div>
    <div class="text-caption text-grey-7 q-mb-md">
      Automatic checks only flag photos (no face, several faces, blurry, too dark, possibly inappropriate). Only a
      Membership Admin can reject one.
    </div>
    <div v-if="listState === 'failed'" class="text-grey-7">Could not load photos.</div>
    <div v-else-if="listState === 'ready' && !rows.length" class="text-grey-7">No photos {{ STATUS_LABELS[status]?.toLowerCase() }}.</div>
    <q-list v-else-if="rows.length" bordered separator>
      <q-item v-for="p in rows" :key="p.photoId">
        <q-item-section avatar>
          <img
            v-if="urls[p.photoId]"
            :src="urls[p.photoId]"
            :alt="`Photo uploaded by account ${p.accountId}`"
            style="width: 96px; height: 96px; object-fit: cover; border-radius: 6px"
          />
          <q-icon v-else name="image_not_supported" size="48px" color="grey-6" role="img" aria-label="Image not available" />
        </q-item-section>
        <q-item-section>
          <q-item-label>Account <code>{{ p.accountId }}</code></q-item-label>
          <q-item-label caption>
            Uploaded {{ new Date(p.uploadedAt).toLocaleString() }} · {{ p.width }}×{{ p.height }}
          </q-item-label>
          <q-item-label v-if="p.flags.length" class="text-orange-10">Flagged: {{ p.flags.join(', ') }}</q-item-label>
          <q-item-label v-if="p.decisionReason" caption>Decision: {{ p.decisionReason }}</q-item-label>
        </q-item-section>
        <q-item-section v-if="p.status !== 'rejected'" side>
          <div class="row q-gutter-xs">
            <q-btn
              v-if="p.status === 'needs_review'"
              dense
              color="positive"
              label="Accept"
              :disable="p.accountId === session.me?.account?.accountId"
              @click="decide(p, 'accept')"
            >
              <span class="sr-only"> photo from {{ p.accountId }}</span>
            </q-btn>
            <q-btn
              dense
              flat
              color="negative"
              label="Reject"
              :disable="p.accountId === session.me?.account?.accountId"
              @click="decide(p, 'reject')"
            >
              <span class="sr-only"> photo from {{ p.accountId }}</span>
            </q-btn>
          </div>
        </q-item-section>
      </q-item>
    </q-list>
  </div>
</template>
