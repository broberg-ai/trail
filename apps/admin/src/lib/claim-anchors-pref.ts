/**
 * F22 — global per-device user preference for showing claim-anchor
 * icons in rendered Neuron prose.
 *
 * Default OFF: claim-anchors are an internal cross-reference primitive
 * (the cross-Neuron citation IDs ADRs and lint detectors use). For
 * end-users reading their own prose they're noise. Power-users can
 * flip it on in Settings → Account.
 *
 * Per-device via localStorage (no server round-trip needed for a
 * pure presentation toggle). The signal lets components subscribe
 * so toggle-flips apply instantly without reload.
 */
import { signal } from '@preact/signals';

const STORAGE_KEY = 'trail.admin.showClaimAnchors';

function readInitial(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

export const showClaimAnchors = signal<boolean>(readInitial());

export function setShowClaimAnchors(value: boolean): void {
  showClaimAnchors.value = value;
  try {
    localStorage.setItem(STORAGE_KEY, value ? '1' : '0');
  } catch {
    /* storage blocked / SSR — ignore */
  }
}
