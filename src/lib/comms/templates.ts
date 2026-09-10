/**
 * Szablony wiadomości — firma może je edytować w ustawieniach.
 * Zmienne w postaci {{nazwa}} są podstawiane danymi z systemu.
 */

export const TEMPLATE_KEYS = [
  'request_confirmation',
  'quote_ready',
  'quote_followup_1',
  'quote_followup_2',
  'quote_followup_3',
  'job_scheduled',
  'job_reminder',
  'job_completed',
  'invoice_ready',
  'payment_reminder',
  'review_request',
] as const;

export type TemplateKey = (typeof TEMPLATE_KEYS)[number] | (string & {});

export const DEFAULT_TEMPLATES: Record<string, { name: string; subject: string; body: string }> = {
  request_confirmation: {
    name: 'Potwierdzenie zapytania',
    subject: 'Dziękujemy za zapytanie — {{firma}}',
    body: 'Dzień dobry {{klient}},\n\ndziękujemy za zapytanie. Odezwiemy się wkrótce z wyceną.\n\nZ poważaniem,\n{{firma}}',
  },
  quote_ready: {
    name: 'Oferta do wglądu',
    subject: 'Twoja wycena {{numer}} — {{firma}}',
    body: 'Dzień dobry {{klient}},\n\nprzygotowaliśmy dla Ciebie wycenę {{numer}} na kwotę {{kwota}}.\n\nOfertę znajdziesz tutaj: {{link}}\n\nZ poważaniem,\n{{firma}}',
  },
  quote_followup_1: {
    name: 'Follow-up oferty (po 2 dniach)',
    subject: 'Czy udało się zapoznać z wyceną? — {{firma}}',
    body: 'Dzień dobry {{klient}},\n\nchcieliśmy zapytać, czy udało się zapoznać z naszą wyceną {{numer}} ({{kwota}}).\n\nLink do oferty: {{link}}\n\nJesteśmy dostępni, jeśli pojawią się pytania.\n\nZ poważaniem,\n{{firma}}',
  },
  quote_followup_2: {
    name: 'Follow-up oferty (po 5 dniach)',
    subject: 'Czy możemy coś doprecyzować? — {{firma}}',
    body: 'Dzień dobry {{klient}},\n\nczy możemy coś doprecyzować w wycenie {{numer}}?\n\nLink do oferty: {{link}}\n\nZ poważaniem,\n{{firma}}',
  },
  quote_followup_3: {
    name: 'Follow-up oferty (po 10 dniach)',
    subject: 'Ostatnie przypomnienie o wycenie — {{firma}}',
    body: 'Dzień dobry {{klient}},\n\nto ostatnie przypomnienie o wycenie {{numer}}. Jeżeli oferta jest nieaktualna, daj nam znać.\n\nLink do oferty: {{link}}\n\nZ poważaniem,\n{{firma}}',
  },
  job_scheduled: {
    name: 'Potwierdzenie terminu',
    subject: 'Potwierdzenie terminu — {{termin}} — {{firma}}',
    body: 'Dzień dobry {{klient}},\n\npotwierdzamy termin realizacji zlecenia {{numer}}: {{termin}}.\n\nAdres: {{adres}}\n\nZ poważaniem,\n{{firma}}',
  },
  job_reminder: {
    name: 'Przypomnienie przed wizytą',
    subject: 'Jutro realizujemy zlecenie — {{firma}}',
    body: 'Dzień dobry {{klient}},\n\nprzypominamy o jutrzejszym zleceniu {{numer}} ({{termin}}).\n\nAdres: {{adres}}\n\nZ poważaniem,\n{{firma}}',
  },
  job_completed: {
    name: 'Zakończenie zlecenia',
    subject: 'Zlecenie zrealizowane — {{firma}}',
    body: 'Dzień dobry {{klient}},\n\nzlecenie {{numer}} zostało zrealizowane. Dziękujemy za zaufanie.\n\nZ poważaniem,\n{{firma}}',
  },
  invoice_ready: {
    name: 'Faktura',
    subject: 'Faktura {{numer}} — {{firma}}',
    body: 'Dzień dobry {{klient}},\n\nprzesyłamy fakturę {{numer}} na kwotę {{kwota}} z terminem płatności {{termin}}.\n\nLink do faktury: {{link}}\n\nZ poważaniem,\n{{firma}}',
  },
  payment_reminder: {
    name: 'Przypomnienie o płatności',
    subject: 'Przypomnienie o płatności — faktura {{numer}} — {{firma}}',
    body: 'Dzień dobry {{klient}},\n\nprzypominamy o płatności faktury {{numer}} na kwotę {{kwota}}.\n\nZ poważaniem,\n{{firma}}',
  },
  review_request: {
    name: 'Prośba o opinię',
    subject: 'Jak oceniasz naszą usługę? — {{firma}}',
    body: 'Dzień dobry {{klient}},\n\ndziękujemy za skorzystanie z naszych usług. Będziemy wdzięczni za krótką opinię.\n\nLink: {{link}}\n\nZ poważaniem,\n{{firma}}',
  },
};

export type TemplateVariables = Record<string, string | number | null | undefined>;

/** Podstawienie zmiennych — wartości są rzutowane na tekst. */
export function renderTemplate(template: string, variables: TemplateVariables): string {
  return template.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_match, key: string) => {
    const value = variables[key];
    if (value === null || value === undefined) return '';
    return String(value);
  });
}

/** Bezpieczne osadzenie tekstu w HTML (ochrona przed XSS w treści maila). */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Zamiana zwykłego tekstu na prosty HTML (akapity i linki). */
export function textToHtml(text: string): string {
  const escaped = escapeHtml(text)
    .split('\n')
    .map((line) => (line.trim() === '' ? '<br/>' : `<p style="margin:0 0 8px 0">${line}</p>`))
    .join('');
  return escaped.replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1">$1</a>');
}
