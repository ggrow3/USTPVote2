import { Dialog, Notify } from 'quasar';
import { errorMessage } from './api.js';

/** Asks for the written reason every admin decision requires (design §5.1). Resolves null if cancelled. */
export function askReason(title: string, message: string): Promise<string | null> {
  return new Promise((resolve) => {
    Dialog.create({
      title,
      message,
      prompt: { model: '', type: 'textarea', isValid: (v: string) => v.trim().length > 0 },
      cancel: true,
      persistent: true,
    })
      .onOk((reason: string) => resolve(reason.trim()))
      .onCancel(() => resolve(null));
  });
}

/** Runs an action, toasting any error (and `success`, if given); returns whether it succeeded. */
export async function attempt(action: () => Promise<unknown>, success?: string): Promise<boolean> {
  try {
    await action();
    if (success) Notify.create({ type: 'positive', message: success });
    return true;
  } catch (e) {
    Notify.create({ type: 'negative', message: errorMessage(e) });
    return false;
  }
}
