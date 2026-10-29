<script setup lang="ts">
import type { ForumVoteValue } from 'ustp-domain';

/**
 * Up and down votes on a post (stacked, beside it) or a comment (in a row): pressing the vote you gave takes it back.
 * Each button says whether it is pressed, and the score is announced with what it counts.
 */
const props = defineProps<{
  score: number;
  myVote: ForumVoteValue;
  /** What is voted on, for the buttons' names: "post" or "Bo’s comment". */
  what: string;
  row?: boolean;
  disable?: boolean;
}>();
const emit = defineEmits<{ vote: [value: ForumVoteValue] }>();

const press = (value: 1 | -1) => emit('vote', props.myVote === value ? 0 : value);
</script>

<template>
  <div class="forum-votes" :class="{ 'forum-votes--row': row }">
    <q-btn
      flat
      round
      dense
      size="sm"
      icon="arrow_upward"
      :color="myVote === 1 ? 'deep-orange-8' : 'grey-7'"
      :aria-label="`Upvote ${what}`"
      :aria-pressed="myVote === 1"
      :disable="disable"
      @click="press(1)"
    />
    <span class="forum-votes__score" :class="{ 'text-deep-orange-8': myVote === 1, 'text-indigo-7': myVote === -1 }">
      <span aria-hidden="true">{{ score }}</span>
      <span class="sr-only">{{ score }} {{ Math.abs(score) === 1 ? 'point' : 'points' }}</span>
    </span>
    <q-btn
      flat
      round
      dense
      size="sm"
      icon="arrow_downward"
      :color="myVote === -1 ? 'indigo-7' : 'grey-7'"
      :aria-label="`Downvote ${what}`"
      :aria-pressed="myVote === -1"
      :disable="disable"
      @click="press(-1)"
    />
  </div>
</template>

<style scoped>
.forum-votes {
  display: flex;
  flex-direction: column;
  align-items: center;
  min-width: 40px;
}
.forum-votes--row {
  flex-direction: row;
  gap: 2px;
  min-width: 0;
}
.forum-votes__score {
  font-weight: 600;
  font-size: 0.9rem;
  min-width: 1.5em;
  text-align: center;
}
</style>
