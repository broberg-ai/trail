import { describe, expect, test } from 'bun:test';
import { classifyChunk, routeKb, type RoutingConfig } from './routing.js';

const CONFIG: RoutingConfig = { dealKb: 'deals', personalKb: 'personal', defaultKb: 'personal' };

describe('routeKb', () => {
  test('deal-flavoured chunk routes to the deal KB', () => {
    const text = 'Kunden vil have et nyt tilbud med 10% rabat på kontrakten inden fredag.';
    expect(classifyChunk(text)).toBe('deal');
    expect(routeKb(text, CONFIG).kb).toBe('deals');
  });

  test('personal chunk routes to the personal KB', () => {
    const text = 'Jeg har besluttet at flytte min træning til om morgenen fordi det passer bedre.';
    expect(routeKb(text, CONFIG).kb).toBe('personal');
  });

  test('ambiguous chunk falls back to defaultKb — never dropped', () => {
    const text = 'En enkelt kunde blev nævnt i forbifarten uden nogen anden kontekst her.';
    const routed = routeKb(text, CONFIG);
    expect(routed.routeClass).toBeNull();
    expect(routed.kb).toBe(CONFIG.defaultKb);
  });
});
