/**
 * Walidacja danych wejściowych (zod).
 * Każdy formularz i endpoint przechodzi przez te schematy — dane z zewnątrz
 * nigdy nie trafiają do bazy bez sprawdzenia.
 */
import { z } from 'zod';

const email = z.string().trim().toLowerCase().email('Podaj poprawny adres e-mail.').max(190);
const phone = z
  .string()
  .trim()
  .max(40)
  .regex(/^[+0-9\s()-]*$/, 'Numer telefonu może zawierać tylko cyfry, spacje i znaki + ( ) -.')
  .optional()
  .or(z.literal(''));

const name = z.string().trim().min(1, 'To pole jest wymagane.').max(160);
const optionalText = z.string().trim().max(2000).optional().or(z.literal(''));
const optionalShort = z.string().trim().max(300).optional().or(z.literal(''));

// --- Autoryzacja -----------------------------------------------------------

export const registerSchema = z
  .object({
    name: name,
    email,
    password: z.string().min(10, 'Hasło musi mieć co najmniej 10 znaków.').max(200),
    confirmPassword: z.string(),
    companyName: name,
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: 'Hasła nie są identyczne.',
    path: ['confirmPassword'],
  });

export const loginSchema = z.object({
  email,
  password: z.string().min(1, 'Podaj hasło.').max(200),
});

export const forgotPasswordSchema = z.object({ email });

export const resetPasswordSchema = z
  .object({
    token: z.string().min(10),
    password: z.string().min(10, 'Hasło musi mieć co najmniej 10 znaków.').max(200),
    confirmPassword: z.string(),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: 'Hasła nie są identyczne.',
    path: ['confirmPassword'],
  });

// --- Organizacja -----------------------------------------------------------

export const organizationSetupSchema = z.object({
  name: name,
  businessType: z.string().min(1),
  businessTypeOther: optionalShort,
  city: optionalShort,
  serviceArea: optionalShort,
  currency: z.string().min(3).max(3).default('PLN'),
  taxRatePercent: z.coerce.number().min(0).max(100).default(23),
  taxId: optionalShort,
  email: email.optional().or(z.literal('')),
  phone,
  street: optionalShort,
  postalCode: z
    .string()
    .trim()
    .max(20)
    .regex(/^[\dA-Za-z\s-]*$/, 'Nieprawidłowy kod pocztowy.')
    .optional()
    .or(z.literal('')),
});

export const organizationSettingsSchema = z.object({
  name: name,
  businessType: z.string().min(1),
  businessTypeOther: optionalShort,
  city: optionalShort,
  serviceArea: optionalShort,
  currency: z.string().min(3).max(3),
  taxRatePercent: z.coerce.number().min(0).max(100),
  taxId: optionalShort,
  email: email.optional().or(z.literal('')),
  phone,
  street: optionalShort,
  postalCode: optionalShort,
  website: optionalShort,
  invoicePrefix: z.string().trim().max(10),
  quotePrefix: z.string().trim().max(10),
  jobPrefix: z.string().trim().max(10),
  estimatePrefix: z.string().trim().max(10),
  paymentTermsDays: z.coerce.number().int().min(0).max(365),
  invoiceNotes: optionalText,
  quoteTerms: optionalText,
  travelFeeType: z.enum(['NONE', 'FLAT', 'PER_KM']),
  travelFlatFee: z.coerce.number().min(0).max(1_000_000),
  travelPerKm: z.coerce.number().min(0).max(1_000_000),
  urgencySurchargePercent: z.coerce.number().min(0).max(200),
  minJobValue: z.coerce.number().min(0).max(10_000_000),
});

// --- Klienci ---------------------------------------------------------------

export const customerSchema = z
  .object({
    type: z.enum(['INDIVIDUAL', 'COMPANY']),
    firstName: optionalShort,
    lastName: optionalShort,
    companyName: optionalShort,
    email: email.optional().or(z.literal('')),
    phone,
    taxId: optionalShort,
    street: optionalShort,
    city: optionalShort,
    postalCode: optionalShort,
    notes: optionalText,
    tags: z.string().optional().or(z.literal('')),
    source: z.string().min(1),
    status: z.enum(['ACTIVE', 'INACTIVE', 'BLOCKED']),
    emailOptIn: z.coerce.boolean().optional(),
    smsOptIn: z.coerce.boolean().optional(),
    consentBasis: optionalShort,
  })
  .superRefine((data, ctx) => {
    if (data.type === 'COMPANY' && !data.companyName) {
      ctx.addIssue({ code: 'custom', message: 'Podaj nazwę firmy.', path: ['companyName'] });
    }
    if (data.type === 'INDIVIDUAL' && !data.firstName && !data.lastName) {
      ctx.addIssue({ code: 'custom', message: 'Podaj imię lub nazwisko klienta.', path: ['firstName'] });
    }
  });

export const customerAddressSchema = z.object({
  label: optionalShort,
  street: optionalShort,
  city: optionalShort,
  postalCode: optionalShort,
  notes: optionalText,
  isDefault: z.coerce.boolean().optional(),
});

export const customerContactSchema = z.object({
  name: name,
  role: optionalShort,
  phone,
  email: email.optional().or(z.literal('')),
  isPrimary: z.coerce.boolean().optional(),
  notes: optionalText,
});

// --- Leady i zapytania -----------------------------------------------------

export const leadSchema = z.object({
  title: name,
  description: optionalText,
  source: z.string().min(1),
  status: z.string().min(1),
  contactName: optionalShort,
  contactPhone: phone,
  contactEmail: email.optional().or(z.literal('')),
  street: optionalShort,
  city: optionalShort,
  postalCode: optionalShort,
  customerId: z.string().optional().or(z.literal('')),
  serviceId: z.string().optional().or(z.literal('')),
  estimatedValue: z.coerce.number().min(0).max(100_000_000).optional(),
  lostReason: optionalText,
  followUpAt: z.string().optional().or(z.literal('')),
});

export const serviceRequestSchema = z.object({
  contactName: optionalShort,
  contactPhone: phone,
  contactEmail: email.optional().or(z.literal('')),
  description: z.string().trim().min(3, 'Opisz, czego dotyczy zapytanie.').max(4000),
  street: optionalShort,
  city: optionalShort,
  postalCode: optionalShort,
  serviceId: z.string().optional().or(z.literal('')),
  customerId: z.string().optional().or(z.literal('')),
  preferredDate: z.string().optional().or(z.literal('')),
  preferredTimeFrom: z.string().optional().or(z.literal('')),
  preferredTimeTo: z.string().optional().or(z.literal('')),
  urgency: z.enum(['LOW', 'NORMAL', 'HIGH']),
  notes: optionalText,
  channel: z.string().min(1).default('MANUAL'),
});

// --- Usługi i cennik -------------------------------------------------------

export const serviceSchema = z.object({
  name: name,
  description: optionalText,
  unit: z.enum(['HOUR', 'SQM', 'PIECE', 'ROOM', 'VEHICLE', 'VISIT', 'FIXED', 'CUSTOM']),
  customUnitLabel: optionalShort,
  pricingMode: z.enum(['FIXED', 'PER_UNIT', 'HOURLY', 'TIERED']),
  basePrice: z.coerce.number().min(0).max(10_000_000),
  hourlyRate: z.coerce.number().min(0).max(10_000_000).optional(),
  minPrice: z.coerce.number().min(0).max(10_000_000),
  taxRatePercent: z.coerce.number().min(0).max(100).optional(),
  durationMinutes: z.coerce.number().int().min(5).max(10_000),
  isActive: z.coerce.boolean().optional(),
});

export const serviceTierSchema = z.object({
  minQuantity: z.coerce.number().min(0).max(1_000_000),
  maxQuantity: z.coerce.number().min(0).max(1_000_000).optional(),
  unitPrice: z.coerce.number().min(0).max(10_000_000),
  flatFee: z.coerce.number().min(0).max(10_000_000).optional(),
});

export const addonSchema = z.object({
  name: name,
  description: optionalText,
  priceType: z.enum(['FLAT', 'PERCENT']),
  price: z.coerce.number().min(0).max(10_000_000),
  percent: z.coerce.number().min(0).max(1000).optional(),
  serviceId: z.string().optional().or(z.literal('')),
  isActive: z.coerce.boolean().optional(),
});

// --- Wyceny i oferty -------------------------------------------------------

export const estimateLineSchema = z.object({
  serviceId: z.string().optional().or(z.literal('')),
  addonId: z.string().optional().or(z.literal('')),
  name: z.string().trim().min(1).max(200),
  quantity: z.coerce.number().min(0).max(1_000_000),
  unitPrice: z.coerce.number().min(0).max(10_000_000),
  unit: z.string().min(1).max(20),
  taxRatePercent: z.coerce.number().min(0).max(100),
  discountPercent: z.coerce.number().min(0).max(100).optional(),
  description: optionalText,
});

export const estimateSchema = z.object({
  customerId: z.string().min(1, 'Wybierz klienta.'),
  addressId: z.string().optional().or(z.literal('')),
  validUntil: z.string().optional().or(z.literal('')),
  notes: optionalText,
  terms: optionalText,
  internalNotes: optionalText,
  discountPercent: z.coerce.number().min(0).max(100).optional(),
  discountAmount: z.coerce.number().min(0).max(10_000_000).optional(),
  travelFeeType: z.enum(['NONE', 'FLAT', 'PER_KM']).optional(),
  travelFlatFee: z.coerce.number().min(0).max(1_000_000).optional(),
  travelPerKm: z.coerce.number().min(0).max(1_000_000).optional(),
  travelDistanceKm: z.coerce.number().min(0).max(10_000).optional(),
  isUrgent: z.coerce.boolean().optional(),
  lines: z.array(estimateLineSchema).max(100),
});

export const quoteFromEstimateSchema = z.object({
  estimateId: z.string().min(1),
  validDays: z.coerce.number().int().min(1).max(365).default(14),
  notes: optionalText,
  terms: optionalText,
});

// --- Zlecenia --------------------------------------------------------------

export const jobSchema = z.object({
  title: name,
  description: optionalText,
  customerId: z.string().min(1, 'Wybierz klienta.'),
  addressId: z.string().optional().or(z.literal('')),
  crewId: z.string().optional().or(z.literal('')),
  scheduledStart: z.string().optional().or(z.literal('')),
  scheduledEnd: z.string().optional().or(z.literal('')),
  estimatedMinutes: z.coerce.number().int().min(5).max(10_000).default(60),
  notes: optionalText,
  assignedUserIds: z.array(z.string()).optional(),
});

export const jobStatusSchema = z.object({
  status: z.enum(['UNSCHEDULED', 'SCHEDULED', 'CONFIRMED', 'EN_ROUTE', 'ON_SITE', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED', 'NO_SHOW']),
  note: optionalText,
});

export const jobNoteSchema = z.object({
  body: z.string().trim().min(1, 'Notatka nie może być pusta.').max(4000),
});

export const checklistSchema = z.object({
  name: name,
  items: z.array(z.string().trim().min(1).max(200)).min(1, 'Dodaj co najmniej jedną pozycję.'),
});

// --- Faktury i płatności ---------------------------------------------------

export const invoiceSchema = z.object({
  customerId: z.string().min(1, 'Wybierz klienta.'),
  jobId: z.string().optional().or(z.literal('')),
  issueDate: z.string().optional().or(z.literal('')),
  dueDate: z.string().optional().or(z.literal('')),
  paymentTermsDays: z.coerce.number().int().min(0).max(365).optional(),
  notes: optionalText,
  lines: z.array(estimateLineSchema).max(100),
});

export const paymentSchema = z.object({
  invoiceId: z.string().min(1),
  amount: z.coerce.number().gt(0, 'Kwota musi być większa od zera.').max(100_000_000),
  method: z.enum(['CASH', 'BANK_TRANSFER', 'CARD', 'STRIPE', 'OTHER']),
  paidAt: z.string().optional().or(z.literal('')),
  reference: optionalShort,
  note: optionalText,
});

// --- Ekipy -----------------------------------------------------------------

export const crewSchema = z.object({
  name: name,
  description: optionalText,
  color: z
    .string()
    .trim()
    .regex(/^#[0-9a-fA-F]{6}$/, 'Kolor musi być w formacie #RRGGBB.')
    .default('#337dff'),
  memberIds: z.array(z.string()).optional(),
});

// --- Automatyzacje ---------------------------------------------------------

export const automationSchema = z.object({
  name: name,
  trigger: z.string().min(1),
  action: z.string().min(1),
  delayMinutes: z.coerce.number().int().min(0).max(60 * 24 * 90),
  isActive: z.coerce.boolean().optional(),
  onlyIfUnaccepted: z.coerce.boolean().optional(),
  subject: optionalShort,
  body: optionalText,
  title: optionalShort,
  templateKey: z.string().optional().or(z.literal('')),
});

export const messageTemplateSchema = z.object({
  key: z.string().min(1),
  name: name,
  channel: z.enum(['EMAIL', 'SMS', 'INTERNAL']),
  subject: optionalShort,
  body: z.string().trim().min(1, 'Treść szablonu jest wymagana.').max(4000),
  isActive: z.coerce.boolean().optional(),
});

// --- Zaproszenia -----------------------------------------------------------

export const invitationSchema = z.object({
  email,
  role: z.enum(['ADMIN', 'DISPATCHER', 'WORKER', 'VIEWER']),
});

export type FormState = {
  ok: boolean;
  error?: string;
  fieldErrors?: Record<string, string>;
  message?: string;
  values?: Record<string, string>;
};

export function zodToFieldErrors(error: z.ZodError): Record<string, string> {
  const result: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.join('.') || 'form';
    if (!result[key]) result[key] = issue.message;
  }
  return result;
}
