<script setup lang="ts">
import { useId } from 'vue';
import type { RegistrationForm } from 'ustp-domain';

/**
 * The application's two membership questions (design §5.2), each answered Yes or No, with the Core Ideals before the
 * second. The wording is the Membership Admins'; neither answer is ever refused. The Register page and the settings'
 * preview both show it.
 */
const { headingLevel = 4 } = defineProps<{
  form: Pick<RegistrationForm, 'usVoterQuestion' | 'usVoterHelp' | 'idealsTitle' | 'ideals' | 'coreIdealsQuestion' | 'coreIdealsHelp'>;
  errors?: { readonly usVoteEligible?: string; readonly agreesWithCoreIdeals?: string };
  /** The Core Ideals' heading level, one below the heading the questions sit under. */
  headingLevel?: 3 | 4;
}>();
const usVoteEligible = defineModel<boolean | null>('usVoteEligible', { required: true });
const agreesWithCoreIdeals = defineModel<boolean | null>('agreesWithCoreIdeals', { required: true });

const id = useId();
/** The help text and any message, for the question and each of its choices. */
const describedBy = (question: string, help: string, error: string | undefined) =>
  [help ? `${id}-${question}-help` : '', error ? `${id}-${question}-error` : ''].filter(Boolean).join(' ') || undefined;
</script>

<template>
  <div class="ustp-form membership-questions">
    <fieldset class="ustp-fieldset" :aria-describedby="describedBy('voter', form.usVoterHelp, errors?.usVoteEligible)">
      <legend class="text-subtitle2">{{ form.usVoterQuestion }}</legend>
      <div v-if="form.usVoterHelp" :id="`${id}-voter-help`" class="text-caption text-grey-7">{{ form.usVoterHelp }}</div>
      <div class="membership-questions__choices">
        <q-radio
          v-model="usVoteEligible"
          :val="true"
          label="Yes"
          :aria-invalid="errors?.usVoteEligible ? 'true' : undefined"
        />
        <q-radio v-model="usVoteEligible" :val="false" label="No" />
      </div>
      <div v-if="errors?.usVoteEligible" :id="`${id}-voter-error`" class="ustp-message text-negative">
        {{ errors.usVoteEligible }}
      </div>
    </fieldset>

    <section :aria-labelledby="`${id}-ideals`" class="membership-questions__ideals">
      <component :is="`h${headingLevel}`" :id="`${id}-ideals`" class="text-subtitle2">{{ form.idealsTitle }}</component>
      <ol>
        <li v-for="(ideal, i) in form.ideals" :key="i"><strong>Ideal {{ i + 1 }}.</strong> {{ ideal }}</li>
      </ol>
    </section>

    <fieldset class="ustp-fieldset" :aria-describedby="describedBy('ideals', form.coreIdealsHelp, errors?.agreesWithCoreIdeals)">
      <legend class="text-subtitle2">{{ form.coreIdealsQuestion }}</legend>
      <div v-if="form.coreIdealsHelp" :id="`${id}-ideals-help`" class="text-caption text-grey-7">{{ form.coreIdealsHelp }}</div>
      <div class="membership-questions__choices">
        <q-radio
          v-model="agreesWithCoreIdeals"
          :val="true"
          label="Yes"
          :aria-invalid="errors?.agreesWithCoreIdeals ? 'true' : undefined"
        />
        <q-radio v-model="agreesWithCoreIdeals" :val="false" label="No" />
      </div>
      <div v-if="errors?.agreesWithCoreIdeals" :id="`${id}-ideals-error`" class="ustp-message text-negative">
        {{ errors.agreesWithCoreIdeals }}
      </div>
    </fieldset>
  </div>
</template>

<style scoped>
.membership-questions legend {
  margin-bottom: 4px;
}
/* Yes and No side by side, in Quasar's 40px rows; the message lines up with the first. */
.membership-questions__choices {
  display: flex;
  gap: 16px;
  margin-top: 4px;
}
.membership-questions .ustp-message {
  padding: 0 0 0 8px;
}
.membership-questions__ideals ol {
  list-style: none;
  margin: 8px 0 0;
  padding: 0;
}
.membership-questions__ideals li + li {
  margin-top: 8px;
}
</style>
