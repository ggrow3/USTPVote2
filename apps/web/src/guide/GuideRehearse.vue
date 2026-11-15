<script setup lang="ts">
/**
 * A step's "Testing alone?" box (design §10.11): on a test deployment, what someone rehearsing every part by themselves
 * does at the step, such as switching this tab to the Test Auditor to approve their own request and back. In the
 * yellow of the testing bar, which shows while they act as a test persona.
 */
defineProps<{
  readonly items: readonly string[];
  /** The heading's level under the step's own heading. */
  readonly level: 3 | 4;
}>();
</script>

<template>
  <div class="ustp-guide-rehearse">
    <component :is="`h${level}`" class="ustp-guide-rehearse__title">
      <q-icon name="science" size="20px" aria-hidden="true" />
      Testing alone?
    </component>
    <ol class="q-my-none">
      <li v-for="(item, i) in items" :key="i">{{ item }}</li>
    </ol>
  </div>
</template>

<style scoped>
.ustp-guide-rehearse {
  margin: 8px 0;
  padding: 8px 12px;
  border-left: 4px solid #ffb300;
  background: #fff8e1;
  color: rgba(0, 0, 0, 0.87);
}
.body--dark .ustp-guide-rehearse {
  background: rgba(255, 224, 130, 0.12);
  color: #fff;
}
.ustp-guide-rehearse__title {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 0 0 4px;
  font-size: 1rem;
  font-weight: 600;
  line-height: 1.5;
}
</style>
