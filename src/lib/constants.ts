/** Słowniki i etykiety używane w całej aplikacji. */

export const BUSINESS_TYPES = [
  { value: 'CLEANING', label: 'Sprzątanie' },
  { value: 'WINDOW_CLEANING', label: 'Mycie okien' },
  { value: 'PRESSURE_WASHING', label: 'Mycie kostki / ciśnieniowe' },
  { value: 'FACADE_CLEANING', label: 'Mycie elewacji' },
  { value: 'DETAILING', label: 'Detailing samochodowy' },
  { value: 'UPHOLSTERY_CLEANING', label: 'Pranie tapicerki' },
  { value: 'MOVING', label: 'Przeprowadzki' },
  { value: 'GARDENING', label: 'Ogrodnictwo' },
  { value: 'LAWN_CARE', label: 'Pielęgnacja terenów' },
  { value: 'PLUMBING', label: 'Hydraulika' },
  { value: 'ELECTRICAL', label: 'Elektryka' },
  { value: 'HVAC', label: 'HVAC' },
  { value: 'AIR_CONDITIONING', label: 'Klimatyzacja' },
  { value: 'RENOVATION', label: 'Remonty' },
  { value: 'PAINTING', label: 'Malowanie' },
  { value: 'HANDYMAN', label: 'Złota rączka' },
  { value: 'CONSTRUCTION', label: 'Firma budowlana' },
  { value: 'TECHNICAL_SERVICE', label: 'Serwis techniczny' },
  { value: 'APPLIANCE_SERVICE', label: 'Serwis urządzeń' },
  { value: 'PEST_CONTROL', label: 'Dezynsekcja / deratyzacja' },
  { value: 'DISINFECTION', label: 'Dezynfekcja' },
  { value: 'SNOW_REMOVAL', label: 'Odśnieżanie' },
  { value: 'ROOFING', label: 'Dachy' },
  { value: 'FENCING', label: 'Ogrodzenia' },
  { value: 'FLOORING', label: 'Podłogi' },
  { value: 'INSTALLATIONS', label: 'Instalacje' },
  { value: 'PROPERTY_MAINTENANCE', label: 'Utrzymanie nieruchomości' },
  { value: 'OTHER', label: 'Inna działalność' },
] as const;

export function businessTypeLabel(value: string): string {
  return BUSINESS_TYPES.find((type) => type.value === value)?.label ?? value;
}

export const UNITS = [
  { value: 'HOUR', label: 'godzina' },
  { value: 'SQM', label: 'm²' },
  { value: 'PIECE', label: 'sztuka' },
  { value: 'ROOM', label: 'pomieszczenie' },
  { value: 'VEHICLE', label: 'samochód' },
  { value: 'VISIT', label: 'wizyta' },
  { value: 'FIXED', label: 'cena stała' },
  { value: 'CUSTOM', label: 'własna jednostka' },
] as const;

export const UNIT_SHORT: Record<string, string> = {
  HOUR: 'godz.',
  SQM: 'm²',
  PIECE: 'szt.',
  ROOM: 'pom.',
  VEHICLE: 'auto',
  VISIT: 'wiz.',
  FIXED: 'usł.',
  CUSTOM: '',
};

export function unitLabel(unit: string, custom?: string | null): string {
  if (unit === 'CUSTOM') return custom || 'usł.';
  return UNIT_SHORT[unit] ?? unit.toLowerCase();
}

export const PRICING_MODES = [
  { value: 'FIXED', label: 'Cena stała' },
  { value: 'PER_UNIT', label: 'Cena za jednostkę' },
  { value: 'HOURLY', label: 'Stawka godzinowa' },
  { value: 'TIERED', label: 'Ceny progowe' },
] as const;

export const LEAD_SOURCES = [
  { value: 'WEBSITE', label: 'Strona www' },
  { value: 'PHONE', label: 'Telefon' },
  { value: 'EMAIL', label: 'E-mail' },
  { value: 'REFERRAL', label: 'Polecenie' },
  { value: 'GOOGLE', label: 'Google' },
  { value: 'SOCIAL_MEDIA', label: 'Social media' },
  { value: 'MANUAL', label: 'Wprowadzone ręcznie' },
  { value: 'API', label: 'API' },
  { value: 'OTHER', label: 'Inne' },
] as const;

export const LEAD_STATUSES = [
  { value: 'NEW', label: 'Nowy' },
  { value: 'CONTACTED', label: 'Skontaktowany' },
  { value: 'QUALIFIED', label: 'Zakwalifikowany' },
  { value: 'ESTIMATE', label: 'Wycena' },
  { value: 'QUOTE_SENT', label: 'Oferta wysłana' },
  { value: 'FOLLOW_UP', label: 'Follow-up' },
  { value: 'WON', label: 'Wygrany' },
  { value: 'LOST', label: 'Przegrany' },
] as const;

export const LEAD_STATUS_TONES: Record<string, 'neutral' | 'info' | 'success' | 'warning' | 'danger' | 'purple'> = {
  NEW: 'info',
  CONTACTED: 'neutral',
  QUALIFIED: 'purple',
  ESTIMATE: 'warning',
  QUOTE_SENT: 'info',
  FOLLOW_UP: 'warning',
  WON: 'success',
  LOST: 'danger',
};

export const QUOTE_STATUSES = [
  { value: 'DRAFT', label: 'Szkic' },
  { value: 'SENT', label: 'Wysłana' },
  { value: 'VIEWED', label: 'Wyświetlona' },
  { value: 'ACCEPTED', label: 'Zaakceptowana' },
  { value: 'REJECTED', label: 'Odrzucona' },
  { value: 'EXPIRED', label: 'Wygasła' },
  { value: 'CANCELLED', label: 'Anulowana' },
] as const;

export const QUOTE_STATUS_TONES: Record<string, 'neutral' | 'info' | 'success' | 'warning' | 'danger' | 'purple'> = {
  DRAFT: 'neutral',
  SENT: 'info',
  VIEWED: 'purple',
  ACCEPTED: 'success',
  REJECTED: 'danger',
  EXPIRED: 'warning',
  CANCELLED: 'neutral',
};

export const JOB_STATUSES = [
  { value: 'UNSCHEDULED', label: 'Niezaplanowane' },
  { value: 'SCHEDULED', label: 'Zaplanowane' },
  { value: 'CONFIRMED', label: 'Potwierdzone' },
  { value: 'EN_ROUTE', label: 'W drodze' },
  { value: 'ON_SITE', label: 'Na miejscu' },
  { value: 'IN_PROGRESS', label: 'W trakcie' },
  { value: 'COMPLETED', label: 'Zakończone' },
  { value: 'CANCELLED', label: 'Anulowane' },
  { value: 'NO_SHOW', label: 'Nieobecność klienta' },
] as const;

export const JOB_STATUS_TONES: Record<string, 'neutral' | 'info' | 'success' | 'warning' | 'danger' | 'purple'> = {
  UNSCHEDULED: 'neutral',
  SCHEDULED: 'info',
  CONFIRMED: 'purple',
  EN_ROUTE: 'warning',
  ON_SITE: 'warning',
  IN_PROGRESS: 'warning',
  COMPLETED: 'success',
  CANCELLED: 'neutral',
  NO_SHOW: 'danger',
};

export const INVOICE_STATUSES = [
  { value: 'DRAFT', label: 'Szkic' },
  { value: 'SENT', label: 'Wysłana' },
  { value: 'PARTIALLY_PAID', label: 'Częściowo opłacona' },
  { value: 'PAID', label: 'Opłacona' },
  { value: 'OVERDUE', label: 'Przeterminowana' },
  { value: 'CANCELLED', label: 'Anulowana' },
] as const;

export const INVOICE_STATUS_TONES: Record<string, 'neutral' | 'info' | 'success' | 'warning' | 'danger' | 'purple'> = {
  DRAFT: 'neutral',
  SENT: 'info',
  PARTIALLY_PAID: 'warning',
  PAID: 'success',
  OVERDUE: 'danger',
  CANCELLED: 'neutral',
};

export const REQUEST_STATUSES = [
  { value: 'NEW', label: 'Nowe' },
  { value: 'IN_REVIEW', label: 'W analizie' },
  { value: 'QUOTED', label: 'Wycenione' },
  { value: 'CONVERTED', label: 'Przekształcone' },
  { value: 'REJECTED', label: 'Odrzucone' },
  { value: 'SPAM', label: 'Spam' },
] as const;

export const REQUEST_STATUS_TONES: Record<string, 'neutral' | 'info' | 'success' | 'warning' | 'danger' | 'purple'> = {
  NEW: 'info',
  IN_REVIEW: 'warning',
  QUOTED: 'purple',
  CONVERTED: 'success',
  REJECTED: 'danger',
  SPAM: 'neutral',
};

export const REQUEST_CHANNELS = [
  { value: 'WEB_FORM', label: 'Formularz WWW' },
  { value: 'EMAIL', label: 'E-mail' },
  { value: 'PHONE', label: 'Telefon' },
  { value: 'API', label: 'API' },
  { value: 'MESSENGER', label: 'Komunikator' },
  { value: 'MANUAL', label: 'Ręcznie' },
  { value: 'OTHER', label: 'Inne' },
] as const;

export const URGENCIES = [
  { value: 'LOW', label: 'Niski' },
  { value: 'NORMAL', label: 'Normalny' },
  { value: 'HIGH', label: 'Pilne' },
] as const;

export const PAYMENT_METHODS = [
  { value: 'CASH', label: 'Gotówka' },
  { value: 'BANK_TRANSFER', label: 'Przelew' },
  { value: 'CARD', label: 'Karta' },
  { value: 'STRIPE', label: 'Stripe' },
  { value: 'OTHER', label: 'Inne' },
] as const;

export const PHOTO_TYPES = [
  { value: 'BEFORE', label: 'Przed' },
  { value: 'DURING', label: 'W trakcie' },
  { value: 'AFTER', label: 'Po' },
  { value: 'OTHER', label: 'Inne' },
] as const;

export const CURRENCIES = [
  { value: 'PLN', label: 'PLN — złoty' },
  { value: 'EUR', label: 'EUR — euro' },
  { value: 'USD', label: 'USD — dolar' },
  { value: 'GBP', label: 'GBP — funt' },
  { value: 'CZK', label: 'CZK — korona' },
] as const;

export const WEEKDAYS = [
  { key: 'monday', label: 'Poniedziałek' },
  { key: 'tuesday', label: 'Wtorek' },
  { key: 'wednesday', label: 'Środa' },
  { key: 'thursday', label: 'Czwartek' },
  { key: 'friday', label: 'Piątek' },
  { key: 'saturday', label: 'Sobota' },
  { key: 'sunday', label: 'Niedziela' },
] as const;

export function formatDateTime(value: Date | string | null | undefined): string {
  if (!value) return '—';
  const date = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString('pl-PL', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export function formatDate(value: Date | string | null | undefined): string {
  if (!value) return '—';
  const date = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString('pl-PL', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

export function formatTime(value: Date | string | null | undefined): string {
  if (!value) return '—';
  const date = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' });
}
