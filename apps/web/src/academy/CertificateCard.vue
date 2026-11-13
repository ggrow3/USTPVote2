<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import {
  CERTIFICATE_ISSUER,
  CERTIFICATE_NAME_MAX,
  certificateDate,
  certificateNameProblem,
  certificatePagePath,
  linkedInAddToProfileUrl,
  type LearnerCertificate,
  type Shareable,
} from 'ustp-domain';
import { api } from '../api.js';
import { attempt } from '../dialogs.js';
import ShareButtons from '../communications/ShareButtons.vue';

/**
 * The holder's own certificate on the course page (design §10.8, "Sharing a certificate"): the name on it, whether
 * its public page shows that name, the PDF, the public page, LinkedIn's Add to profile and share buttons.
 */
const props = defineProps<{
  courseId: string;
  courseTitle: string;
  certificate: LearnerCertificate;
}>();
const emit = defineEmits<{ changed: [certificate: LearnerCertificate]; download: [] }>();

const name = ref(props.certificate.recipientName);
const saving = ref(false);
watch(
  () => props.certificate.recipientName,
  (saved) => (name.value = saved),
);

/** The name as saved is an email address (a login without a name was given its address), so it cannot be shown. */
const savedNameProblem = computed(() => certificateNameProblem(props.certificate.recipientName));
const nameProblem = computed(() => (name.value.trim() === props.certificate.recipientName ? null : certificateNameProblem(name.value)));
const nameChanged = computed(() => name.value.trim() !== props.certificate.recipientName);

const pagePath = computed(() => certificatePagePath(props.certificate.certificateId));
const pageUrl = computed(() => `${location.origin}${pagePath.value}`);
const addToProfile = computed(() =>
  linkedInAddToProfileUrl({
    courseTitle: props.courseTitle,
    certificateId: props.certificate.certificateId,
    issuedAt: props.certificate.issuedAt,
    certificateUrl: pageUrl.value,
    organizationId: props.certificate.linkedInOrganizationId,
  }),
);
const share = computed<Shareable>(() => ({
  title: `Certificate: ${props.courseTitle}`,
  text: `I completed "${props.courseTitle}", a free course from the ${CERTIFICATE_ISSUER}.`,
  url: pageUrl.value,
  hashtags: ['Transhumanism'],
}));

async function save(change: { recipientName?: string; nameShown?: boolean }, done: string) {
  saving.value = true;
  try {
    await attempt(async () => {
      emit('changed', await api<LearnerCertificate>('PUT', `/v1/courses/${props.courseId}/certificate`, change));
    }, done);
  } finally {
    saving.value = false;
  }
}

function saveName() {
  if (nameProblem.value || !nameChanged.value) return;
  void save({ recipientName: name.value.trim() }, 'Name on the certificate saved');
}
</script>

<template>
  <q-card flat bordered class="certificate-card">
    <q-card-section>
      <div class="row items-center q-gutter-sm q-mb-sm">
        <q-icon name="workspace_premium" size="32px" color="primary" aria-hidden="true" />
        <div>
          <h2 id="certificate-heading" class="text-h6 q-my-none">Your certificate</h2>
          <div class="text-caption text-grey-7">Issued {{ certificateDate(certificate.issuedAt) }} · course version {{ certificate.courseVersion }}</div>
        </div>
      </div>
      <q-banner v-if="savedNameProblem" rounded class="bg-orange-1 text-black q-mb-md" role="status">
        Your certificate has your email address where your name goes. Put your name on it before you share it.
      </q-banner>
      <q-form class="row items-start q-gutter-sm" @submit.prevent="saveName">
        <q-input
          v-model="name"
          outlined
          dense
          class="col"
          label="Name on the certificate"
          :maxlength="CERTIFICATE_NAME_MAX"
          :error="!!nameProblem"
          :error-message="nameProblem ?? undefined"
          hint="As printed on the PDF, and on its public page if you show it there."
          autocomplete="name"
        />
        <q-btn type="submit" color="primary" no-caps label="Save name" :disable="!nameChanged || !!nameProblem" :loading="saving" />
      </q-form>
      <q-toggle
        :model-value="certificate.nameShown"
        :disable="saving || !!savedNameProblem"
        class="q-mt-md"
        label="Show my name on the certificate's public page"
        @update:model-value="(shown: boolean) => save({ nameShown: shown }, shown ? 'Your name shows on the public page' : 'Your name no longer shows on the public page')"
      />
      <div class="text-caption text-grey-7 q-ml-sm">
        Off, the public page says only that the certificate is valid, for which course and when. Anyone with its link can open it; search engines do not list it.
      </div>
    </q-card-section>
    <q-separator />
    <q-card-section class="row q-gutter-sm">
      <q-btn color="primary" no-caps icon="add_box" label="Add to LinkedIn profile" :href="addToProfile" target="_blank" rel="noopener noreferrer" aria-label="Add to your LinkedIn profile (opens in a new tab)" />
      <q-btn outline color="primary" no-caps icon="download" label="Download PDF" @click="emit('download')" />
      <q-btn outline color="primary" no-caps icon="open_in_new" label="Public page" :to="pagePath" />
    </q-card-section>
    <q-card-section class="q-pt-none">
      <div class="text-subtitle2 q-mb-xs">Share it</div>
      <ShareButtons :item="share" />
    </q-card-section>
  </q-card>
</template>

<style scoped>
.certificate-card {
  border-color: var(--q-primary);
}
</style>
