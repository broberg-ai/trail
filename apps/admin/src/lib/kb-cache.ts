/**
 * Module-level cache of the KB list. Every per-KB panel needs to show the
 * current Trail's name somewhere, and hitting `/knowledge-bases` from every
 * panel mount is wasteful. The list is small, rarely changes mid-session,
 * and all panels share one cache keyed by kbId.
 */
import { useEffect, useState } from 'preact/hooks';
import type { KnowledgeBase } from '@trail/shared';
import { listKnowledgeBases } from '../api';

let inflight: Promise<KnowledgeBase[]> | null = null;
let cache: KnowledgeBase[] | null = null;

/**
 * Synchronous peek at the module-level cache. Returns null until
 * `ensureKbs()` has resolved at least once this session. Used by code
 * paths that want the cache if it's warm but can't block on a fetch
 * (e.g. markdown rendering during a synchronous render-pass).
 */
export function peekKbs(): KnowledgeBase[] | null {
  return cache;
}

/**
 * Route params from /kb/:kbId/... can carry either a UUID or a slug
 * (F135 slug-based routing). Every panel that resolves a KB from the
 * URL param should match on BOTH so settings, nav, etc. don't freeze
 * on the "no match" path when visited via slug.
 */
export function matchKb(
  list: KnowledgeBase[],
  kbIdOrSlug: string,
): KnowledgeBase | null {
  if (!kbIdOrSlug) return null;
  return list.find((k) => k.id === kbIdOrSlug || k.slug === kbIdOrSlug) ?? null;
}

export function ensureKbs(): Promise<KnowledgeBase[]> {
  if (cache) return Promise.resolve(cache);
  if (!inflight) {
    inflight = listKnowledgeBases().then((list) => {
      cache = list;
      inflight = null;
      return list;
    });
  }
  return inflight;
}

/**
 * Drop the module-level cache. Call this when a KB is created/updated so
 * the next `ensureKbs()` fetches a fresh list — otherwise `useKb(newId)`
 * would return null (id not in the old cache) until a hard refresh.
 */
export function invalidateKbs(): void {
  cache = null;
  inflight = null;
}

export interface KbResolution {
  /** True until the KB list has resolved at least once for this kbId. */
  loading: boolean;
  /** The matched KB, or null while loading / when not found. */
  kb: KnowledgeBase | null;
  /** True once the list resolved and kbId matched nothing — a real
   *  "this Trail doesn't exist" signal (vs. the loading null). Lets a
   *  caller render a not-found state instead of spinning forever. */
  notFound: boolean;
}

/**
 * Like `useKb`, but distinguishes "still loading" from "resolved, no
 * match". `useKb` returns null for BOTH, which makes panels that gate on
 * `if (!kb) return <Loader/>` spin forever when the URL carries a kbId
 * that isn't a real KB (e.g. a tenant slug typed as `/kb/<tenant>/…`).
 */
export function useKbResolution(kbId: string): KbResolution {
  const [state, setState] = useState<{ loading: boolean; kb: KnowledgeBase | null }>(() => {
    if (!kbId) return { loading: false, kb: null };
    if (cache) return { loading: false, kb: matchKb(cache, kbId) };
    return { loading: true, kb: null };
  });
  useEffect(() => {
    if (!kbId) {
      setState({ loading: false, kb: null });
      return;
    }
    if (cache) {
      setState({ loading: false, kb: matchKb(cache, kbId) });
      return;
    }
    let cancelled = false;
    setState({ loading: true, kb: null });
    ensureKbs()
      .then((list) => {
        if (!cancelled) setState({ loading: false, kb: matchKb(list, kbId) });
      })
      .catch(() => {
        // List fetch failed (network/auth). Resolve empty rather than
        // spin; the not-found shell offers a retry via "back to Trails".
        if (!cancelled) setState({ loading: false, kb: null });
      });
    return () => {
      cancelled = true;
    };
  }, [kbId]);
  return { loading: state.loading, kb: state.kb, notFound: !!kbId && !state.loading && !state.kb };
}

export function useKb(kbId: string): KnowledgeBase | null {
  const [kb, setKb] = useState<KnowledgeBase | null>(
    kbId && cache ? matchKb(cache, kbId) : null,
  );
  useEffect(() => {
    // Clear state when navigating away from any KB — otherwise the last
    // viewed Trail name would persist on /, and the App-level document
    // title effect would show "trail: <previous kb>" on the All Trails page.
    if (!kbId) {
      setKb(null);
      return;
    }
    let cancelled = false;
    ensureKbs().then((list) => {
      if (cancelled) return;
      setKb(matchKb(list, kbId));
    });
    return () => {
      cancelled = true;
    };
  }, [kbId]);
  return kb;
}
