const HIDDEN_KEY = 'ustp-first-steps-hidden';

/** Whether the member hid their getting started list (design §5.16): their choice, kept in this browser only. */
export function firstStepsHidden(): boolean {
  try {
    return localStorage.getItem(HIDDEN_KEY) === 'true';
  } catch {
    return false; // storage blocked: the list shows
  }
}

export function hideFirstSteps(): void {
  try {
    localStorage.setItem(HIDDEN_KEY, 'true');
  } catch {
    // storage blocked: hidden until the page is left
  }
}
