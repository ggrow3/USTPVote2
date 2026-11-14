import { ref, type Ref } from 'vue';
import { DEFAULT_PLACE_RULES, detailsPlaceRules, type PlaceRules } from 'ustp-domain';
import { registrationForm } from './api.js';

/**
 * The rules a member's details are held to (design §5.2): what the registration form requires of where someone lives
 * is required when the details change later, and nothing more. Until the form has loaded, and if it cannot, the rules
 * are the form's as it starts out; the api holds the request to the rules in force either way.
 */
export function usePlaceRules(): Ref<PlaceRules> {
  const rules = ref<PlaceRules>(DEFAULT_PLACE_RULES);
  void registrationForm()
    .then((form) => (rules.value = detailsPlaceRules(form.fields)))
    .catch(() => undefined);
  return rules;
}
