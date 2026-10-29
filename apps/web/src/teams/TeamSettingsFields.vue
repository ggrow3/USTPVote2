<script setup lang="ts">
import { TEAM_COLORS, TEAM_ICONS, TEAM_JOIN_POLICIES, TEAM_LIMITS } from 'ustp-domain';
import type { FieldErrors } from '../forms.js';
import { COLOR_CLASSES, COLOR_LABELS, ICON_LABELS, POLICY_CAPTIONS, POLICY_LABELS } from './team-text.js';
import type { SettingsForm } from './settings-form.js';

/**
 * A team's settings (design §5.7): name, description, how people join and the question they answer, a size limit, the
 * link for its members, and its colour and symbol. Leads see the name but cannot change it.
 */
const form = defineModel<SettingsForm>({ required: true });
defineProps<{ errors: FieldErrors; lockName?: boolean }>();

const policies = TEAM_JOIN_POLICIES.map((value) => ({ value, label: POLICY_LABELS[value] }));
</script>

<template>
  <div class="ustp-stack">
    <q-banner v-if="errors._" class="bg-orange-1 text-black" rounded>{{ errors._ }}</q-banner>
    <q-input
      v-model="form.name"
      outlined
      dense
      hide-bottom-space
      label="Name"
      :maxlength="TEAM_LIMITS.name"
      :readonly="lockName"
      :hint="lockName ? 'Only a Membership Admin renames a team.' : undefined"
      :error="!!errors.name"
      :error-message="errors.name"
    />
    <q-input
      v-model="form.description"
      outlined
      dense
      autogrow
      hide-bottom-space
      label="What the team does (optional)"
      :maxlength="TEAM_LIMITS.description"
      :error="!!errors.description"
      :error-message="errors.description"
    />
    <fieldset class="team-fieldset">
      <legend class="text-body2 text-weight-medium">How people join</legend>
      <div class="ustp-options">
        <template v-for="p in policies" :key="p.value">
          <q-radio v-model="form.joinPolicy" :val="p.value" :label="p.label" />
          <div class="ustp-message text-grey-7">{{ POLICY_CAPTIONS[p.value] }}</div>
        </template>
      </div>
    </fieldset>
    <q-input
      v-if="form.joinPolicy === 'approval'"
      v-model="form.joinQuestion"
      outlined
      dense
      hide-bottom-space
      label="A question for people asking to join (optional)"
      :maxlength="TEAM_LIMITS.joinQuestion"
      :error="!!errors.joinQuestion"
      :error-message="errors.joinQuestion"
    />
    <div class="ustp-row">
      <q-input
        v-model.number="form.capacity"
        outlined
        dense
        hide-bottom-space
        type="number"
        min="1"
        :max="TEAM_LIMITS.capacity"
        label="Most members (blank: no limit)"
        :error="!!errors.capacity"
        :error-message="errors.capacity"
      />
      <q-input
        v-model="form.memberLink"
        class="ustp-row__wide"
        outlined
        dense
        hide-bottom-space
        type="url"
        label="Link for members, e.g. a Discord channel (optional)"
        hint="Shown to the team's members only."
        :maxlength="TEAM_LIMITS.memberLink"
        :error="!!errors.memberLink"
        :error-message="errors.memberLink"
      />
    </div>
    <fieldset class="team-fieldset">
      <legend class="text-body2 text-weight-medium">Colour</legend>
      <div class="team-swatches">
        <q-btn
          v-for="c in TEAM_COLORS"
          :key="c"
          round
          unelevated
          size="sm"
          :color="COLOR_CLASSES[c]"
          :icon="form.color === c ? 'check' : undefined"
          :aria-label="COLOR_LABELS[c]"
          :aria-pressed="form.color === c"
          @click="form.color = c"
        />
      </div>
    </fieldset>
    <fieldset class="team-fieldset">
      <legend class="text-body2 text-weight-medium">Symbol</legend>
      <div class="team-swatches">
        <q-btn
          v-for="i in TEAM_ICONS"
          :key="i"
          round
          size="md"
          :flat="form.icon !== i"
          :unelevated="form.icon === i"
          :color="form.icon === i ? COLOR_CLASSES[form.color] : 'grey-8'"
          :icon="i"
          :aria-label="ICON_LABELS[i]"
          :aria-pressed="form.icon === i"
          @click="form.icon = i"
        />
      </div>
    </fieldset>
  </div>
</template>

<style scoped>
.team-fieldset {
  border: 0;
  margin: 0;
  padding: 0;
  min-width: 0;
}
.team-fieldset > legend {
  padding: 0;
  margin-bottom: 4px;
}
.team-swatches {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
</style>
