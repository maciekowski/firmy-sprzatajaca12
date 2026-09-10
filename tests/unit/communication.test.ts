import { describe, expect, it } from 'vitest';
import { consentDecision, MESSAGE_CATEGORY_LABELS, type MessageCategory } from '@/lib/comms/service';

/**
 * Preferencje wiadomości: kanał i kategoria są rozpatrywane osobno.
 * Marketing jest domyślnie WYŁĄCZONY — brak zgody musi kończyć się
 * jawnym powodem, a nie „wysłaniem mimo wszystko”.
 */
describe('zgody na wiadomości w podziale na kategorie', () => {
  it('wyłączenie kanału blokuje każdą kategorię', () => {
    for (const category of Object.keys(MESSAGE_CATEGORY_LABELS) as MessageCategory[]) {
      const decision = consentDecision(category, { channelOptIn: false, marketingOptIn: true });
      expect(decision.allowed).toBe(false);
      expect(decision.reason).toContain('kanał');
    }
  });

  it('transakcyjne i systemowe są dozwolone przy domyślnych ustawieniach', () => {
    expect(consentDecision('TRANSACTIONAL', { channelOptIn: true }).allowed).toBe(true);
    expect(consentDecision('SYSTEM', { channelOptIn: true }).allowed).toBe(true);
  });

  it('marketing bez wyraźnej zgody jest blokowany', () => {
    expect(consentDecision('MARKETING', { channelOptIn: true }).allowed).toBe(false);
    expect(consentDecision('MARKETING', { channelOptIn: true, marketingOptIn: false }).allowed).toBe(false);
    expect(consentDecision('MARKETING', { channelOptIn: true, marketingOptIn: true }).allowed).toBe(true);
  });

  it('automatyczne są dozwolone, dopóki klient ich nie wyłączy', () => {
    expect(consentDecision('AUTOMATION', { channelOptIn: true }).allowed).toBe(true);
    expect(consentDecision('AUTOMATION', { channelOptIn: true, automationOptIn: true }).allowed).toBe(true);
    expect(consentDecision('AUTOMATION', { channelOptIn: true, automationOptIn: false }).allowed).toBe(false);
  });

  it('brak danych o zgodzie nie jest traktowany jako zgoda na marketing', () => {
    const decision = consentDecision('MARKETING', {});
    expect(decision.allowed).toBe(false);
  });

  it('wyłączenie transakcyjnych jest respektowane', () => {
    const decision = consentDecision('TRANSACTIONAL', { channelOptIn: true, transactionalOptIn: false });
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toContain('transakcyjne');
  });
});
