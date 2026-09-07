// F263.10 — beviset for at ET TRYK PÅ EN NOTIFIKATION når ALLE åbne vinduer.
//
// Testen findes på grund af et konkret fund fra components 7/9 2026: pakkens
// egen handleNotificationClick `return`-er efter det FØRSTE fokuserbare vindue,
// så resten aldrig får besked. Min første udgave af rettelsen her havde samme
// hul i en anden form — den await'ede focus() midt i løkken, så et afvist focus
// ville have afbrudt den før de øvrige vinduer fik ruten.
//
// DERFOR TO VINDUER, OG DERFOR AFVISER DET FØRSTE FOKUS. Med ét vindue består
// en test af den slags her ved et rent tilfælde og beviser ingenting. Fixturet
// er selve kontrollen: fjernes «post til alle før focus», skal den blive rød.
import { describe, test, expect, mock, beforeAll } from 'bun:test';

type Listener = (event: unknown) => void;
const listeners = new Map<string, Listener>();

/** Vinduerne handleren møder. focus() på det første AFVISER — det er pointen. */
function makeClients() {
  const posted: Array<{ id: string; msg: unknown }> = [];
  const focused: string[] = [];
  const win = (id: string, focusRejects: boolean) => ({
    id,
    focus: async () => {
      if (focusRejects) throw new Error(`focus afvist på ${id}`);
      focused.push(id);
      return undefined;
    },
    postMessage: (msg: unknown) => posted.push({ id, msg }),
  });
  return {
    posted,
    focused,
    api: {
      matchAll: async () => [win('vindue-a', true), win('vindue-b', false)],
      claim: async () => undefined,
    },
  };
}

const clients = makeClients();
const pakkensHandler = mock(() => undefined);

beforeAll(async () => {
  mock.module('@broberg/pwa/sw', () => ({ listenForSkipWaiting: () => undefined }));
  mock.module('@broberg/webpush/sw', () => ({
    createPushHandler: () => () => undefined,
    handleNotificationClick: pakkensHandler,
  }));

  const fakeSelf = {
    addEventListener: (type: string, fn: Listener) => listeners.set(type, fn),
    clients: clients.api,
    location: { origin: 'https://app.trailmem.com' },
    registration: {},
  };
  Object.defineProperty(globalThis, 'self', { value: fakeSelf, writable: true, configurable: true });

  await import('./sw');
});

describe('notificationclick', () => {
  test('ALLE åbne vinduer får ruten — også når focus afviser på det første', async () => {
    const handler = listeners.get('notificationclick');
    expect(handler).toBeDefined();

    const venter: Promise<unknown>[] = [];
    handler!({
      notification: { data: { navigate: '/kb/abc/sources' } },
      waitUntil: (p: Promise<unknown>) => venter.push(p),
    });
    await Promise.all(venter);

    // Begge vinduer, ikke kun det første: det er den fejl components fandt.
    expect(clients.posted.map((p) => p.id).sort()).toEqual(['vindue-a', 'vindue-b']);
    // Streng lighed på selve ruten — «indeholder» ville bestå på en forvansket værdi.
    for (const p of clients.posted) {
      expect(p.msg).toEqual({ type: 'trail:navigate', navigate: '/kb/abc/sources' });
    }
    // Et afvist focus stopper ikke ruten, og det næste vindue får fokus i stedet.
    expect(clients.focused).toEqual(['vindue-b']);
    // Pakkens egen adfærd er additiv og stadig i spil (openWindow når intet vindue er åbent).
    expect(pakkensHandler).toHaveBeenCalled();
  });

  test('uden navigate sendes ingen besked — kun pakkens fallback', async () => {
    const før = clients.posted.length;
    const handler = listeners.get('notificationclick');
    const venter: Promise<unknown>[] = [];
    handler!({ notification: { data: {} }, waitUntil: (p: Promise<unknown>) => venter.push(p) });
    await Promise.all(venter);
    expect(clients.posted.length).toBe(før);
  });
});
