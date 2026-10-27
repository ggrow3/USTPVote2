<script setup lang="ts">
import { computed } from 'vue';
import { ageOn, type ApplicationRecord } from 'ustp-domain';
import { consentText, stateName } from './member-text.js';

/**
 * Every answer on one application, as the applicant gave it, grouped and worded as on the Register page (design §5.2),
 * with the bylaws they agreed to and the decision.
 */
const props = defineProps<{ application: ApplicationRecord }>();

const NOT_ANSWERED = 'Not answered';
const yesNo = (value: boolean) => (value ? 'Yes' : 'No');
const when = (iso: string) => new Date(iso).toLocaleString();

// Applications from before contact details, attestations and opt-ins were asked for lack those fields.
const groups = computed(() => {
  const a = props.application;
  return [
    {
      title: 'About them',
      facts: [
        ['Legal name', a.legalName],
        ['Preferred name', a.preferredName ?? NOT_ANSWERED],
        ['Date of birth', a.dateOfBirth ? `${a.dateOfBirth} (${ageOn(a.dateOfBirth, new Date(a.submittedAt))} when they applied)` : NOT_ANSWERED],
      ],
    },
    {
      title: 'Where they live and how to reach them',
      facts: [
        ['State or territory', stateName(a.state)],
        ['City', a.contact?.city ?? NOT_ANSWERED],
        ['ZIP code', a.contact?.postalCode ?? NOT_ANSWERED],
        ['Phone', a.contact?.phone ?? NOT_ANSWERED],
      ],
    },
    {
      title: 'Their interest in USTP',
      facts: [
        ['Why they want to join', a.statement ?? NOT_ANSWERED],
        ['Issues they care most about', a.interests ?? NOT_ANSWERED],
        ['Skills or experience they could contribute', a.skills ?? NOT_ANSWERED],
        ['How they heard about USTP', a.referral ?? NOT_ANSWERED],
        ['Would like to volunteer', yesNo(a.volunteer)],
        ['Interested in running for party or public office', yesNo(a.runForOffice)],
      ],
    },
    {
      title: 'Staying in touch',
      facts: [
        ['USTP newsletter', consentText(a.communications?.newsletter)],
        ['Party announcements and calls to vote', consentText(a.communications?.announcements)],
      ],
    },
    {
      title: 'Confirmations',
      facts: [
        ...(a.attestations
          ? [
              [`At least ${a.attestations.minimumAge} years old`, 'Yes'],
              ['Supports the platform and goals of the US Transhumanist Party', yesNo(a.attestations.supportsPlatform)],
            ]
          : []),
        ['Agreed to the bylaws', `Version ${a.bylawsVersion}, SHA-256 ${a.bylawsHash}`],
      ],
    },
    {
      title: 'Decision',
      facts: [
        ['Submitted', when(a.submittedAt)],
        ['Status', a.status],
        ...(a.decidedAt ? [['Decided', when(a.decidedAt)]] : []),
        ...(a.decisionReason ? [['Reason', a.decisionReason]] : []),
      ],
    },
  ];
});
</script>

<template>
  <div class="ustp-stack">
    <section v-for="g in groups" :key="g.title">
      <h3 class="text-subtitle2">{{ g.title }}</h3>
      <dl class="ustp-facts">
        <template v-for="[label, value] in g.facts" :key="label">
          <dt>{{ label }}</dt>
          <dd :class="{ 'text-grey-7': value === NOT_ANSWERED }">{{ value }}</dd>
        </template>
      </dl>
    </section>
  </div>
</template>
