import { dialog } from '../dialogs.js';

/** What the Communications admin tabs share (design §10.9). */

/** Asks before something that cannot be taken back quietly (publishing, withdrawing, deleting). */
export function confirmAction(title: string, message: string, ok: string): Promise<boolean> {
  return new Promise((resolve) =>
    dialog({ title, message, cancel: { flat: true, noCaps: true, label: 'Cancel' }, ok: { unelevated: true, noCaps: true, color: 'primary', label: ok } })
      .onOk(() => resolve(true))
      .onCancel(() => resolve(false)),
  );
}
