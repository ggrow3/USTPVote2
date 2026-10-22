import type { BallotReceipt } from 'ustp-domain';

/**
 * Ballot receipts (design §7.5). A receipt holds the salts and selections, so anyone holding it can see how the voter
 * voted: it is kept in this browser only when the voter asks, and otherwise only downloaded.
 */

const KEY = 'ustp-receipts';

export function savedReceipts(): BallotReceipt[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(KEY) ?? '[]');
    return Array.isArray(parsed) ? (parsed as BallotReceipt[]) : [];
  } catch {
    return []; // storage blocked or unreadable
  }
}

export function savedReceipt(electionId: string): BallotReceipt | null {
  return savedReceipts().find((r) => r.electionId === electionId) ?? null;
}

/** False when the browser does not allow storage (private window, blocked site data). */
export function keepReceipt(receipt: BallotReceipt): boolean {
  try {
    const others = savedReceipts().filter((r) => r.electionId !== receipt.electionId);
    localStorage.setItem(KEY, JSON.stringify([...others, receipt]));
    return true;
  } catch {
    return false;
  }
}

export function forgetReceipt(electionId: string): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(savedReceipts().filter((r) => r.electionId !== electionId)));
  } catch {
    // nothing stored
  }
}

export function downloadReceipt(receipt: BallotReceipt): void {
  const url = URL.createObjectURL(new Blob([JSON.stringify(receipt, null, 2)], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = `ustp-receipt-${receipt.electionId}.json`;
  link.click();
  URL.revokeObjectURL(url);
}
