/**
 * ServiceFlow — schemat bazy danych (PostgreSQL, Drizzle ORM).
 *
 * Zasady modelu danych:
 *  - multi-tenancy: każda tabela biznesowa ma `organizationId` i jest filtrowana
 *    po stronie serwera (nigdy nie ufamy danym przychodzącym z frontendu),
 *  - pieniądze: zawsze liczby całkowite w groszach (`*_cents`),
 *  - podatki i rabaty procentowe: punkty bazowe (2300 = 23,00%),
 *  - ilości: `numeric(12,3)` — poprawne dla m², godzin, sztuk z ułamkami,
 *  - czasy: `timestamptz`.
 */
import { randomBytes } from 'node:crypto';
import { relations, sql } from 'drizzle-orm';
import {
  boolean,
  date,
  doublePrecision,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

/** Krótki, nieprzewidywalny identyfikator (prefiks ułatwia debugowanie). */
export function newId(prefix: string): string {
  return `${prefix}_${randomBytes(12).toString('base64url')}`;
}

// ---------------------------------------------------------------------------
// Enumy
// ---------------------------------------------------------------------------

export const roleEnum = pgEnum('role', ['OWNER', 'ADMIN', 'DISPATCHER', 'WORKER', 'VIEWER']);
export type Role = (typeof roleEnum.enumValues)[number];

export const businessTypeEnum = pgEnum('business_type', [
  'CLEANING',
  'WINDOW_CLEANING',
  'PRESSURE_WASHING',
  'FACADE_CLEANING',
  'DETAILING',
  'UPHOLSTERY_CLEANING',
  'MOVING',
  'GARDENING',
  'LAWN_CARE',
  'PLUMBING',
  'ELECTRICAL',
  'HVAC',
  'AIR_CONDITIONING',
  'RENOVATION',
  'PAINTING',
  'HANDYMAN',
  'CONSTRUCTION',
  'TECHNICAL_SERVICE',
  'APPLIANCE_SERVICE',
  'PEST_CONTROL',
  'DISINFECTION',
  'SNOW_REMOVAL',
  'ROOFING',
  'FENCING',
  'FLOORING',
  'INSTALLATIONS',
  'PROPERTY_MAINTENANCE',
  'OTHER',
]);

export const unitEnum = pgEnum('unit', ['HOUR', 'SQM', 'PIECE', 'ROOM', 'VEHICLE', 'VISIT', 'FIXED', 'CUSTOM']);

export const customerTypeEnum = pgEnum('customer_type', ['INDIVIDUAL', 'COMPANY']);
export const customerStatusEnum = pgEnum('customer_status', ['ACTIVE', 'INACTIVE', 'BLOCKED']);

export const leadSourceEnum = pgEnum('lead_source', [
  'WEBSITE',
  'PHONE',
  'EMAIL',
  'REFERRAL',
  'GOOGLE',
  'SOCIAL_MEDIA',
  'MANUAL',
  'API',
  'OTHER',
]);

export const leadStatusEnum = pgEnum('lead_status', [
  'NEW',
  'CONTACTED',
  'QUALIFIED',
  'ESTIMATE',
  'QUOTE_SENT',
  'FOLLOW_UP',
  'WON',
  'LOST',
]);

export const requestStatusEnum = pgEnum('request_status', [
  'NEW',
  'IN_REVIEW',
  'QUOTED',
  'CONVERTED',
  'REJECTED',
  'SPAM',
]);

export const requestChannelEnum = pgEnum('request_channel', [
  'WEB_FORM',
  'EMAIL',
  'PHONE',
  'API',
  'MESSENGER',
  'MANUAL',
  'OTHER',
]);

export const urgencyEnum = pgEnum('urgency', ['LOW', 'NORMAL', 'HIGH']);

export const estimateStatusEnum = pgEnum('estimate_status', ['DRAFT', 'SENT', 'ACCEPTED', 'REJECTED', 'EXPIRED']);

export const quoteStatusEnum = pgEnum('quote_status', [
  'DRAFT',
  'SENT',
  'VIEWED',
  'ACCEPTED',
  'REJECTED',
  'EXPIRED',
  'CANCELLED',
]);

export const quoteEventTypeEnum = pgEnum('quote_event_type', [
  'CREATED',
  'SENT',
  'VIEWED',
  'ACCEPTED',
  'REJECTED',
  'EXPIRED',
  'CANCELLED',
  'CHANGE_REQUESTED',
  'FOLLOW_UP_SENT',
]);

export const jobStatusEnum = pgEnum('job_status', [
  'UNSCHEDULED',
  'SCHEDULED',
  'CONFIRMED',
  'EN_ROUTE',
  'ON_SITE',
  'IN_PROGRESS',
  'COMPLETED',
  'CANCELLED',
  'NO_SHOW',
]);

export const photoTypeEnum = pgEnum('photo_type', ['BEFORE', 'DURING', 'AFTER', 'OTHER']);

export const invoiceStatusEnum = pgEnum('invoice_status', [
  'DRAFT',
  'SENT',
  'PARTIALLY_PAID',
  'PAID',
  'OVERDUE',
  'CANCELLED',
]);

export const paymentMethodEnum = pgEnum('payment_method', ['CASH', 'BANK_TRANSFER', 'CARD', 'STRIPE', 'OTHER']);

export const communicationChannelEnum = pgEnum('communication_channel', ['EMAIL', 'SMS', 'INTERNAL']);
export const communicationDirectionEnum = pgEnum('communication_direction', ['INBOUND', 'OUTBOUND']);
export const communicationStatusEnum = pgEnum('communication_status', [
  'PENDING',
  'QUEUED',
  'SENT',
  'DELIVERED',
  'FAILED',
  'BOUNCED',
  'SUPPRESSED',
  'SKIPPED_NO_PROVIDER',
  'SKIPPED_NO_CONSENT',
]);

/**
 * Status KSeF jest ZEWNĘTRZNY — odzwierciedla stan po stronie KSeF.
 * Nigdy nie ustawiamy ACCEPTED bez potwierdzenia z KSeF.
 */
export const ksefStatusEnum = pgEnum('ksef_status', [
  'NOT_CONFIGURED',
  'READY',
  'SUBMITTING',
  'SUBMITTED',
  'PROCESSING',
  'ACCEPTED',
  'REJECTED',
  'ERROR',
]);

export const automationTriggerEnum = pgEnum('automation_trigger', [
  'QUOTE_SENT',
  'QUOTE_VIEWED',
  'QUOTE_ACCEPTED',
  'JOB_CREATED',
  'JOB_SCHEDULED',
  'JOB_COMPLETED',
  'JOB_NO_SHOW',
  'INVOICE_CREATED',
  'INVOICE_SENT',
  'INVOICE_OVERDUE',
  'PAYMENT_RECEIVED',
  'LEAD_CREATED',
  'REQUEST_CREATED',
  'CUSTOMER_INACTIVE',
]);

export const automationActionEnum = pgEnum('automation_action', [
  'SEND_EMAIL',
  'SEND_SMS',
  'CREATE_NOTIFICATION',
  'CREATE_FOLLOW_UP_TASK',
  'SEND_REVIEW_REQUEST',
  'UPDATE_JOB_STATUS',
]);

export const automationRunStatusEnum = pgEnum('automation_run_status', [
  'PENDING',
  'RUNNING',
  'SUCCESS',
  'FAILED',
  'SKIPPED',
]);

export const reviewChannelEnum = pgEnum('review_channel', ['GOOGLE', 'OWN_FORM', 'OTHER']);
export const reviewRequestStatusEnum = pgEnum('review_request_status', ['PENDING', 'SENT', 'COMPLETED', 'FAILED', 'SKIPPED']);
export const timeEntryStatusEnum = pgEnum('time_entry_status', ['RUNNING', 'PAUSED', 'STOPPED']);
export const scheduleTypeEnum = pgEnum('schedule_type', ['WORKING_HOURS', 'TIME_OFF']);
export const subscriptionPlanEnum = pgEnum('subscription_plan', ['START', 'PRO', 'BUSINESS']);
export const subscriptionStatusEnum = pgEnum('subscription_status', [
  'NONE',
  'TRIALING',
  'ACTIVE',
  'PAST_DUE',
  'CANCELED',
  'INCOMPLETE',
  'INCOMPLETE_EXPIRED',
  'UNPAID',
  'PAUSED',
]);

// ---------------------------------------------------------------------------
// Wspólne kolumny
// ---------------------------------------------------------------------------

const createdAt = () => timestamp('created_at', { withTimezone: true }).defaultNow().notNull();
const updatedAt = () => timestamp('updated_at', { withTimezone: true }).defaultNow().notNull();

const money = (name: string) => integer(name).default(0).notNull();
const quantity = (name: string) => numeric(name, { precision: 12, scale: 3 }).default('1').notNull();

// ---------------------------------------------------------------------------
// Użytkownicy, sesje, organizacje
// ---------------------------------------------------------------------------

export const users = pgTable('users', {
  id: text('id').primaryKey().$defaultFn(() => newId('usr')),
  email: text('email').notNull().unique(),
  name: text('name').notNull(),
  phone: text('phone'),
  passwordHash: text('password_hash').notNull(),
  isSuperAdmin: boolean('is_super_admin').default(false).notNull(),
  lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const sessions = pgTable(
  'sessions',
  {
    id: text('id').primaryKey().$defaultFn(() => newId('ses')),
    tokenHash: text('token_hash').notNull().unique(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    ip: text('ip'),
    userAgent: text('user_agent'),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }).defaultNow().notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index('sessions_user_idx').on(t.userId), index('sessions_expires_idx').on(t.expiresAt)],
);

export const passwordResetTokens = pgTable(
  'password_reset_tokens',
  {
    id: text('id').primaryKey().$defaultFn(() => newId('prt')),
    tokenHash: text('token_hash').notNull().unique(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    usedAt: timestamp('used_at', { withTimezone: true }),
    ip: text('ip'),
    createdAt: createdAt(),
  },
  (t) => [index('password_reset_user_idx').on(t.userId)],
);

export const organizations = pgTable(
  'organizations',
  {
    id: text('id').primaryKey().$defaultFn(() => newId('org')),
    name: text('name').notNull(),
    slug: text('slug').notNull().unique(),
    businessType: businessTypeEnum('business_type').default('OTHER').notNull(),
    businessTypeOther: text('business_type_other'),
    currency: text('currency').default('PLN').notNull(),
    locale: text('locale').default('pl-PL').notNull(),
    timezone: text('timezone').default('Europe/Warsaw').notNull(),
    taxRateBps: integer('tax_rate_bps').default(2300).notNull(),
    taxId: text('tax_id'),
    email: text('email'),
    phone: text('phone'),
    website: text('website'),
    street: text('street'),
    city: text('city'),
    postalCode: text('postal_code'),
    country: text('country').default('PL').notNull(),
    serviceArea: text('service_area'),
    logoFileId: text('logo_file_id'),
    workingHours: jsonb('working_hours').$type<Record<string, { from: string; to: string } | null>>(),
    invoicePrefix: text('invoice_prefix').default('FV').notNull(),
    quotePrefix: text('quote_prefix').default('OF').notNull(),
    jobPrefix: text('job_prefix').default('ZL').notNull(),
    estimatePrefix: text('estimate_prefix').default('WY').notNull(),
    paymentTermsDays: integer('payment_terms_days').default(14).notNull(),
    invoiceNotes: text('invoice_notes'),
    quoteTerms: text('quote_terms'),
    travelFeeType: text('travel_fee_type').default('NONE').notNull(), // NONE | FLAT | PER_KM
    travelFlatFeeCents: integer('travel_flat_fee_cents').default(0).notNull(),
    travelPerKmCents: integer('travel_per_km_cents').default(0).notNull(),
    urgencySurchargeBps: integer('urgency_surcharge_bps').default(0).notNull(),
    minJobValueCents: integer('min_job_value_cents').default(0).notNull(),
    completionRequirements: jsonb('completion_requirements').$type<{
      requireChecklist?: boolean;
      requireAfterPhotos?: boolean;
      requireNote?: boolean;
      minAfterPhotos?: number;
    }>(),
    plan: subscriptionPlanEnum('plan').default('START').notNull(),
    subscriptionStatus: subscriptionStatusEnum('subscription_status').default('NONE').notNull(),
    stripeCustomerId: text('stripe_customer_id').unique(),
    stripeSubscriptionId: text('stripe_subscription_id').unique(),
    subscriptionEndsAt: timestamp('subscription_ends_at', { withTimezone: true }),
    trialEndsAt: timestamp('trial_ends_at', { withTimezone: true }),
    seatsLimit: integer('seats_limit').default(3).notNull(),
    isDemo: boolean('is_demo').default(false).notNull(),
    onboardingCompletedAt: timestamp('onboarding_completed_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('organizations_demo_idx').on(t.isDemo)],
);

export const memberships = pgTable(
  'memberships',
  {
    id: text('id').primaryKey().$defaultFn(() => newId('mem')),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: roleEnum('role').default('DISPATCHER').notNull(),
    isActive: boolean('is_active').default(true).notNull(),
    jobTitle: text('job_title'),
    hourlyRateCents: integer('hourly_rate_cents'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('memberships_org_user_uq').on(t.organizationId, t.userId),
    index('memberships_user_idx').on(t.userId),
    index('memberships_org_role_idx').on(t.organizationId, t.role),
  ],
);

export const invitations = pgTable(
  'invitations',
  {
    id: text('id').primaryKey().$defaultFn(() => newId('inv')),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    email: text('email').notNull(),
    role: roleEnum('role').default('WORKER').notNull(),
    tokenHash: text('token_hash').notNull().unique(),
    invitedById: text('invited_by_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    acceptedAt: timestamp('accepted_at', { withTimezone: true }),
    acceptedById: text('accepted_by_id').references(() => users.id, { onDelete: 'set null' }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    index('invitations_org_idx').on(t.organizationId),
    index('invitations_email_idx').on(t.email),
    index('invitations_org_email_idx').on(t.organizationId, t.email),
  ],
);

export const orgSettings = pgTable(
  'org_settings',
  {
    id: text('id').primaryKey().$defaultFn(() => newId('ost')),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    key: text('key').notNull(),
    value: jsonb('value').$type<unknown>().notNull(),
  },
  (t) => [uniqueIndex('org_settings_uq').on(t.organizationId, t.key)],
);

// ---------------------------------------------------------------------------
// CRM
// ---------------------------------------------------------------------------

export const customers = pgTable(
  'customers',
  {
    id: text('id').primaryKey().$defaultFn(() => newId('cus')),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    type: customerTypeEnum('type').default('INDIVIDUAL').notNull(),
    firstName: text('first_name'),
    lastName: text('last_name'),
    companyName: text('company_name'),
    displayName: text('display_name').notNull(),
    email: text('email'),
    phone: text('phone'),
    taxId: text('tax_id'),
    street: text('street'),
    city: text('city'),
    postalCode: text('postal_code'),
    country: text('country').default('PL').notNull(),
    notes: text('notes'),
    tags: text('tags').array().default(sql`'{}'::text[]`).notNull(),
    source: leadSourceEnum('source').default('MANUAL').notNull(),
    status: customerStatusEnum('status').default('ACTIVE').notNull(),
    emailOptIn: boolean('email_opt_in').default(true).notNull(),
    smsOptIn: boolean('sms_opt_in').default(false).notNull(),
    /**
     * Preferencje wiadomości w podziale na kategorie (RODO / dobra praktyka):
     *  - transakcyjne i systemowe wynikają z realizacji usługi,
     *  - automatyczne (follow-upy, prośby o opinię) można wyłączyć,
     *  - marketingowe są DOMYŚLNIE WYŁĄCZONE (wymagają wyraźnej zgody).
     */
    emailTransactionalOptIn: boolean('email_transactional_opt_in').default(true).notNull(),
    emailSystemOptIn: boolean('email_system_opt_in').default(true).notNull(),
    emailAutomationOptIn: boolean('email_automation_opt_in').default(true).notNull(),
    emailMarketingOptIn: boolean('email_marketing_opt_in').default(false).notNull(),
    consentBasis: text('consent_basis'),
    consentNote: text('consent_note'),
    /** token publicznego konta klienta (historia ofert, zleceń i faktur). NULL = brak dostępu. */
    portalToken: text('portal_token').unique(),
    portalTokenCreatedAt: timestamp('portal_token_created_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('customers_org_status_idx').on(t.organizationId, t.status),
    index('customers_org_created_idx').on(t.organizationId, t.createdAt),
    index('customers_org_email_idx').on(t.organizationId, t.email),
  ],
);

export const customerContacts = pgTable(
  'customer_contacts',
  {
    id: text('id').primaryKey().$defaultFn(() => newId('cct')),
    customerId: text('customer_id')
      .notNull()
      .references(() => customers.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    role: text('role'),
    phone: text('phone'),
    email: text('email'),
    isPrimary: boolean('is_primary').default(false).notNull(),
    notes: text('notes'),
    createdAt: createdAt(),
  },
  (t) => [index('customer_contacts_customer_idx').on(t.customerId)],
);

export const customerAddresses = pgTable(
  'customer_addresses',
  {
    id: text('id').primaryKey().$defaultFn(() => newId('cad')),
    customerId: text('customer_id')
      .notNull()
      .references(() => customers.id, { onDelete: 'cascade' }),
    label: text('label').default('Adres realizacji').notNull(),
    street: text('street'),
    city: text('city'),
    postalCode: text('postal_code'),
    country: text('country').default('PL').notNull(),
    latitude: doublePrecision('latitude'),
    longitude: doublePrecision('longitude'),
    notes: text('notes'),
    isDefault: boolean('is_default').default(false).notNull(),
    createdAt: createdAt(),
  },
  (t) => [index('customer_addresses_customer_idx').on(t.customerId)],
);

export const leads = pgTable(
  'leads',
  {
    id: text('id').primaryKey().$defaultFn(() => newId('led')),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    description: text('description'),
    source: leadSourceEnum('source').default('MANUAL').notNull(),
    status: leadStatusEnum('status').default('NEW').notNull(),
    contactName: text('contact_name'),
    contactPhone: text('contact_phone'),
    contactEmail: text('contact_email'),
    street: text('street'),
    city: text('city'),
    postalCode: text('postal_code'),
    customerId: text('customer_id').references(() => customers.id, { onDelete: 'set null' }),
    serviceId: text('service_id').references(() => services.id, { onDelete: 'set null' }),
    assignedToId: text('assigned_to_id').references(() => users.id, { onDelete: 'set null' }),
    estimatedValueCents: integer('estimated_value_cents'),
    lostReason: text('lost_reason'),
    convertedAt: timestamp('converted_at', { withTimezone: true }),
    convertedCustomerId: text('converted_customer_id'),
    convertedQuoteId: text('converted_quote_id'),
    convertedJobId: text('converted_job_id'),
    followUpAt: timestamp('follow_up_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('leads_org_status_idx').on(t.organizationId, t.status),
    index('leads_org_created_idx').on(t.organizationId, t.createdAt),
    index('leads_org_source_idx').on(t.organizationId, t.source),
  ],
);

export const serviceRequests = pgTable(
  'service_requests',
  {
    id: text('id').primaryKey().$defaultFn(() => newId('req')),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    contactName: text('contact_name'),
    contactPhone: text('contact_phone'),
    contactEmail: text('contact_email'),
    customerId: text('customer_id').references(() => customers.id, { onDelete: 'set null' }),
    street: text('street'),
    city: text('city'),
    postalCode: text('postal_code'),
    description: text('description').notNull(),
    serviceId: text('service_id').references(() => services.id, { onDelete: 'set null' }),
    preferredDate: date('preferred_date'),
    preferredTimeFrom: text('preferred_time_from'),
    preferredTimeTo: text('preferred_time_to'),
    urgency: urgencyEnum('urgency').default('NORMAL').notNull(),
    notes: text('notes'),
    status: requestStatusEnum('status').default('NEW').notNull(),
    channel: requestChannelEnum('channel').default('MANUAL').notNull(),
    rawPayload: jsonb('raw_payload').$type<Record<string, unknown>>(),
    aiParsed: jsonb('ai_parsed').$type<{
      serviceName?: string | null;
      items?: { label: string; quantity?: number | null; unit?: string | null; confidence?: string }[];
      preferredDate?: string | null;
      preferredTime?: string | null;
      urgency?: string | null;
      contact?: { name?: string | null; phone?: string | null; email?: string | null };
      address?: string | null;
      notes?: string[];
    }>(),
    aiStatus: text('ai_status').default('NOT_RUN').notNull(), // NOT_RUN | OK | NEEDS_CONFIRMATION | FAILED | NO_PROVIDER
    aiProvider: text('ai_provider'),
    aiAnalyzedAt: timestamp('ai_analyzed_at', { withTimezone: true }),
    convertedLeadId: text('converted_lead_id'),
    convertedQuoteId: text('converted_quote_id'),
    convertedJobId: text('converted_job_id'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('service_requests_org_status_idx').on(t.organizationId, t.status),
    index('service_requests_org_created_idx').on(t.organizationId, t.createdAt),
  ],
);

// ---------------------------------------------------------------------------
// Katalog usług
// ---------------------------------------------------------------------------

export const services = pgTable(
  'services',
  {
    id: text('id').primaryKey().$defaultFn(() => newId('srv')),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    description: text('description'),
    unit: unitEnum('unit').default('VISIT').notNull(),
    customUnitLabel: text('custom_unit_label'),
    pricingMode: text('pricing_mode').default('FIXED').notNull(), // FIXED | PER_UNIT | HOURLY | TIERED
    basePriceCents: integer('base_price_cents').default(0).notNull(),
    hourlyRateCents: integer('hourly_rate_cents'),
    minPriceCents: integer('min_price_cents').default(0).notNull(),
    taxRateBps: integer('tax_rate_bps'),
    durationMinutes: integer('duration_minutes').default(60).notNull(),
    isActive: boolean('is_active').default(true).notNull(),
    sortOrder: integer('sort_order').default(0).notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('services_org_active_idx').on(t.organizationId, t.isActive)],
);

export const servicePrices = pgTable(
  'service_prices',
  {
    id: text('id').primaryKey().$defaultFn(() => newId('prc')),
    serviceId: text('service_id')
      .notNull()
      .references(() => services.id, { onDelete: 'cascade' }),
    minQuantity: numeric('min_quantity', { precision: 12, scale: 3 }).default('0').notNull(),
    maxQuantity: numeric('max_quantity', { precision: 12, scale: 3 }),
    unitPriceCents: integer('unit_price_cents').default(0).notNull(),
    flatFeeCents: integer('flat_fee_cents').default(0).notNull(),
    sortOrder: integer('sort_order').default(0).notNull(),
  },
  (t) => [index('service_prices_service_idx').on(t.serviceId)],
);

export const addons = pgTable(
  'addons',
  {
    id: text('id').primaryKey().$defaultFn(() => newId('adn')),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    serviceId: text('service_id').references(() => services.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    description: text('description'),
    priceType: text('price_type').default('FLAT').notNull(), // FLAT | PERCENT
    priceCents: integer('price_cents').default(0).notNull(),
    percentBps: integer('percent_bps').default(0).notNull(),
    isActive: boolean('is_active').default(true).notNull(),
    createdAt: createdAt(),
  },
  (t) => [index('addons_org_active_idx').on(t.organizationId, t.isActive)],
);

// ---------------------------------------------------------------------------
// Wyceny i oferty
// ---------------------------------------------------------------------------

export const estimates = pgTable(
  'estimates',
  {
    id: text('id').primaryKey().$defaultFn(() => newId('est')),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    number: text('number').notNull(),
    customerId: text('customer_id')
      .notNull()
      .references(() => customers.id, { onDelete: 'cascade' }),
    addressId: text('address_id').references(() => customerAddresses.id, { onDelete: 'set null' }),
    leadId: text('lead_id'),
    status: estimateStatusEnum('status').default('DRAFT').notNull(),
    addressLabel: text('address_label'),
    addressStreet: text('address_street'),
    addressCity: text('address_city'),
    addressPostalCode: text('address_postal_code'),
    subtotalCents: money('subtotal_cents'),
    discountCents: money('discount_cents'),
    discountBps: integer('discount_bps').default(0).notNull(),
    travelCents: money('travel_cents'),
    travelDistanceKm: numeric('travel_distance_km', { precision: 10, scale: 2 }),
    urgencyFeeCents: money('urgency_fee_cents'),
    taxCents: money('tax_cents'),
    totalCents: money('total_cents'),
    validUntil: timestamp('valid_until', { withTimezone: true }),
    notes: text('notes'),
    terms: text('terms'),
    internalNotes: text('internal_notes'),
    createdById: text('created_by_id').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('estimates_org_number_uq').on(t.organizationId, t.number),
    index('estimates_org_status_idx').on(t.organizationId, t.status),
    index('estimates_org_created_idx').on(t.organizationId, t.createdAt),
  ],
);

export const estimateItems = pgTable(
  'estimate_items',
  {
    id: text('id').primaryKey().$defaultFn(() => newId('esi')),
    estimateId: text('estimate_id')
      .notNull()
      .references(() => estimates.id, { onDelete: 'cascade' }),
    serviceId: text('service_id').references(() => services.id, { onDelete: 'set null' }),
    addonId: text('addon_id').references(() => addons.id, { onDelete: 'set null' }),
    name: text('name').notNull(),
    description: text('description'),
    unit: unitEnum('unit').default('VISIT').notNull(),
    customUnitLabel: text('custom_unit_label'),
    quantity: quantity('quantity'),
    unitPriceCents: integer('unit_price_cents').default(0).notNull(),
    taxRateBps: integer('tax_rate_bps').default(2300).notNull(),
    discountCents: money('discount_cents'),
    discountBps: integer('discount_bps').default(0).notNull(),
    netCents: money('net_cents'),
    taxCents: money('tax_cents'),
    grossCents: money('gross_cents'),
    isCustom: boolean('is_custom').default(false).notNull(),
    sortOrder: integer('sort_order').default(0).notNull(),
  },
  (t) => [index('estimate_items_estimate_idx').on(t.estimateId)],
);

export const quotes = pgTable(
  'quotes',
  {
    id: text('id').primaryKey().$defaultFn(() => newId('qte')),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    number: text('number').notNull(),
    version: integer('version').default(1).notNull(),
    estimateId: text('estimate_id').references(() => estimates.id, { onDelete: 'set null' }),
    customerId: text('customer_id')
      .notNull()
      .references(() => customers.id, { onDelete: 'cascade' }),
    addressId: text('address_id').references(() => customerAddresses.id, { onDelete: 'set null' }),
    status: quoteStatusEnum('status').default('DRAFT').notNull(),
    publicToken: text('public_token').notNull().unique(),
    addressLabel: text('address_label'),
    addressStreet: text('address_street'),
    addressCity: text('address_city'),
    addressPostalCode: text('address_postal_code'),
    subtotalCents: money('subtotal_cents'),
    discountCents: money('discount_cents'),
    discountBps: integer('discount_bps').default(0).notNull(),
    travelCents: money('travel_cents'),
    urgencyFeeCents: money('urgency_fee_cents'),
    taxCents: money('tax_cents'),
    totalCents: money('total_cents'),
    validUntil: timestamp('valid_until', { withTimezone: true }),
    sentAt: timestamp('sent_at', { withTimezone: true }),
    viewedAt: timestamp('viewed_at', { withTimezone: true }),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    rejectionReason: text('rejection_reason'),
    changeRequest: text('change_request'),
    title: text('title'),
    notes: text('notes'),
    terms: text('terms'),
    internalNotes: text('internal_notes'),
    createdById: text('created_by_id').references(() => users.id, { onDelete: 'set null' }),
    convertedJobId: text('converted_job_id'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('quotes_org_number_uq').on(t.organizationId, t.number),
    index('quotes_org_status_idx').on(t.organizationId, t.status),
    index('quotes_org_created_idx').on(t.organizationId, t.createdAt),
  ],
);

export const quoteItems = pgTable(
  'quote_items',
  {
    id: text('id').primaryKey().$defaultFn(() => newId('qti')),
    quoteId: text('quote_id')
      .notNull()
      .references(() => quotes.id, { onDelete: 'cascade' }),
    serviceId: text('service_id').references(() => services.id, { onDelete: 'set null' }),
    addonId: text('addon_id').references(() => addons.id, { onDelete: 'set null' }),
    name: text('name').notNull(),
    description: text('description'),
    unit: unitEnum('unit').default('VISIT').notNull(),
    customUnitLabel: text('custom_unit_label'),
    quantity: quantity('quantity'),
    unitPriceCents: integer('unit_price_cents').default(0).notNull(),
    taxRateBps: integer('tax_rate_bps').default(2300).notNull(),
    discountCents: money('discount_cents'),
    discountBps: integer('discount_bps').default(0).notNull(),
    netCents: money('net_cents'),
    taxCents: money('tax_cents'),
    grossCents: money('gross_cents'),
    isCustom: boolean('is_custom').default(false).notNull(),
    sortOrder: integer('sort_order').default(0).notNull(),
  },
  (t) => [index('quote_items_quote_idx').on(t.quoteId)],
);

export const quoteEvents = pgTable(
  'quote_events',
  {
    id: text('id').primaryKey().$defaultFn(() => newId('qev')),
    quoteId: text('quote_id')
      .notNull()
      .references(() => quotes.id, { onDelete: 'cascade' }),
    type: quoteEventTypeEnum('type').notNull(),
    message: text('message'),
    actorName: text('actor_name'),
    ip: text('ip'),
    meta: jsonb('meta').$type<Record<string, unknown>>(),
    createdAt: createdAt(),
  },
  (t) => [index('quote_events_quote_idx').on(t.quoteId, t.createdAt)],
);

// ---------------------------------------------------------------------------
// Zlecenia, ekipy, czasy
// ---------------------------------------------------------------------------

export const jobs = pgTable(
  'jobs',
  {
    id: text('id').primaryKey().$defaultFn(() => newId('job')),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    number: text('number').notNull(),
    customerId: text('customer_id')
      .notNull()
      .references(() => customers.id, { onDelete: 'cascade' }),
    addressId: text('address_id').references(() => customerAddresses.id, { onDelete: 'set null' }),
    quoteId: text('quote_id').references(() => quotes.id, { onDelete: 'set null' }),
    estimateId: text('estimate_id'),
    crewId: text('crew_id').references(() => crews.id, { onDelete: 'set null' }),
    leadId: text('lead_id'),
    title: text('title').notNull(),
    description: text('description'),
    status: jobStatusEnum('status').default('UNSCHEDULED').notNull(),
    addressLabel: text('address_label'),
    addressStreet: text('address_street'),
    addressCity: text('address_city'),
    addressPostalCode: text('address_postal_code'),
    scheduledStart: timestamp('scheduled_start', { withTimezone: true }),
    scheduledEnd: timestamp('scheduled_end', { withTimezone: true }),
    estimatedMinutes: integer('estimated_minutes').default(60).notNull(),
    actualStart: timestamp('actual_start', { withTimezone: true }),
    actualEnd: timestamp('actual_end', { withTimezone: true }),
    subtotalCents: money('subtotal_cents'),
    taxCents: money('tax_cents'),
    totalCents: money('total_cents'),
    notes: text('notes'),
    internalNotes: text('internal_notes'),
    completionNote: text('completion_note'),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    completedById: text('completed_by_id').references(() => users.id, { onDelete: 'set null' }),
    cancelReason: text('cancel_reason'),
    responsibleId: text('responsible_id').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('jobs_org_number_uq').on(t.organizationId, t.number),
    index('jobs_org_status_idx').on(t.organizationId, t.status),
    index('jobs_org_scheduled_idx').on(t.organizationId, t.scheduledStart),
    index('jobs_org_crew_idx').on(t.organizationId, t.crewId, t.scheduledStart),
  ],
);

export const jobAssignments = pgTable(
  'job_assignments',
  {
    id: text('id').primaryKey().$defaultFn(() => newId('jas')),
    jobId: text('job_id')
      .notNull()
      .references(() => jobs.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    isLead: boolean('is_lead').default(false).notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('job_assignments_uq').on(t.jobId, t.userId), index('job_assignments_user_idx').on(t.userId)],
);

export const jobItems = pgTable(
  'job_items',
  {
    id: text('id').primaryKey().$defaultFn(() => newId('jit')),
    jobId: text('job_id')
      .notNull()
      .references(() => jobs.id, { onDelete: 'cascade' }),
    serviceId: text('service_id').references(() => services.id, { onDelete: 'set null' }),
    name: text('name').notNull(),
    description: text('description'),
    unit: unitEnum('unit').default('VISIT').notNull(),
    customUnitLabel: text('custom_unit_label'),
    quantity: quantity('quantity'),
    unitPriceCents: integer('unit_price_cents').default(0).notNull(),
    taxRateBps: integer('tax_rate_bps').default(2300).notNull(),
    netCents: money('net_cents'),
    taxCents: money('tax_cents'),
    grossCents: money('gross_cents'),
    sortOrder: integer('sort_order').default(0).notNull(),
  },
  (t) => [index('job_items_job_idx').on(t.jobId)],
);

export const crews = pgTable(
  'crews',
  {
    id: text('id').primaryKey().$defaultFn(() => newId('crw')),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    color: text('color').default('#337dff').notNull(),
    description: text('description'),
    isActive: boolean('is_active').default(true).notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('crews_org_name_uq').on(t.organizationId, t.name), index('crews_org_active_idx').on(t.organizationId, t.isActive)],
);

export const crewMembers = pgTable(
  'crew_members',
  {
    id: text('id').primaryKey().$defaultFn(() => newId('crm')),
    crewId: text('crew_id')
      .notNull()
      .references(() => crews.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    isLeader: boolean('is_leader').default(false).notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('crew_members_uq').on(t.crewId, t.userId), index('crew_members_user_idx').on(t.userId)],
);

export const schedules = pgTable(
  'schedules',
  {
    id: text('id').primaryKey().$defaultFn(() => newId('sch')),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    crewId: text('crew_id').references(() => crews.id, { onDelete: 'cascade' }),
    userId: text('user_id').references(() => users.id, { onDelete: 'cascade' }),
    type: scheduleTypeEnum('type').default('WORKING_HOURS').notNull(),
    weekday: integer('weekday'),
    date: date('date'),
    startMinute: integer('start_minute').default(480).notNull(),
    endMinute: integer('end_minute').default(960).notNull(),
    note: text('note'),
    createdAt: createdAt(),
  },
  (t) => [index('schedules_org_crew_idx').on(t.organizationId, t.crewId)],
);

export const timeEntries = pgTable(
  'time_entries',
  {
    id: text('id').primaryKey().$defaultFn(() => newId('tim')),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    jobId: text('job_id')
      .notNull()
      .references(() => jobs.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    status: timeEntryStatusEnum('status').default('RUNNING').notNull(),
    startedAt: timestamp('started_at', { withTimezone: true }).defaultNow().notNull(),
    pausedAt: timestamp('paused_at', { withTimezone: true }),
    endedAt: timestamp('ended_at', { withTimezone: true }),
    pausedMs: integer('paused_ms').default(0).notNull(),
    durationSeconds: integer('duration_seconds'),
    note: text('note'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('time_entries_org_job_idx').on(t.organizationId, t.jobId),
    index('time_entries_user_status_idx').on(t.userId, t.status),
    index('time_entries_job_user_idx').on(t.jobId, t.userId),
  ],
);

export const jobPhotos = pgTable(
  'job_photos',
  {
    id: text('id').primaryKey().$defaultFn(() => newId('jph')),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    jobId: text('job_id')
      .notNull()
      .references(() => jobs.id, { onDelete: 'cascade' }),
    fileId: text('file_id')
      .notNull()
      .references(() => files.id, { onDelete: 'cascade' }),
    type: photoTypeEnum('type').default('OTHER').notNull(),
    caption: text('caption'),
    takenAt: timestamp('taken_at', { withTimezone: true }).defaultNow().notNull(),
    authorId: text('author_id').references(() => users.id, { onDelete: 'set null' }),
  },
  (t) => [index('job_photos_org_job_idx').on(t.organizationId, t.jobId), index('job_photos_job_type_idx').on(t.jobId, t.type)],
);

export const jobNotes = pgTable(
  'job_notes',
  {
    id: text('id').primaryKey().$defaultFn(() => newId('jnt')),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    jobId: text('job_id')
      .notNull()
      .references(() => jobs.id, { onDelete: 'cascade' }),
    body: text('body').notNull(),
    authorId: text('author_id').references(() => users.id, { onDelete: 'set null' }),
    authorName: text('author_name'),
    isPinned: boolean('is_pinned').default(false).notNull(),
    createdAt: createdAt(),
  },
  (t) => [index('job_notes_org_job_idx').on(t.organizationId, t.jobId)],
);

export const checklists = pgTable(
  'checklists',
  {
    id: text('id').primaryKey().$defaultFn(() => newId('chk')),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    jobId: text('job_id').references(() => jobs.id, { onDelete: 'cascade' }),
    serviceId: text('service_id').references(() => services.id, { onDelete: 'set null' }),
    name: text('name').notNull(),
    isTemplate: boolean('is_template').default(false).notNull(),
    sortOrder: integer('sort_order').default(0).notNull(),
    createdAt: createdAt(),
  },
  (t) => [index('checklists_org_template_idx').on(t.organizationId, t.isTemplate), index('checklists_job_idx').on(t.jobId)],
);

export const checklistItems = pgTable(
  'checklist_items',
  {
    id: text('id').primaryKey().$defaultFn(() => newId('chi')),
    checklistId: text('checklist_id')
      .notNull()
      .references(() => checklists.id, { onDelete: 'cascade' }),
    label: text('label').notNull(),
    isDone: boolean('is_done').default(false).notNull(),
    doneAt: timestamp('done_at', { withTimezone: true }),
    doneById: text('done_by_id').references(() => users.id, { onDelete: 'set null' }),
    sortOrder: integer('sort_order').default(0).notNull(),
  },
  (t) => [index('checklist_items_checklist_idx').on(t.checklistId)],
);

// ---------------------------------------------------------------------------
// Faktury i płatności
// ---------------------------------------------------------------------------

export const invoices = pgTable(
  'invoices',
  {
    id: text('id').primaryKey().$defaultFn(() => newId('inv')),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    number: text('number').notNull(),
    customerId: text('customer_id')
      .notNull()
      .references(() => customers.id, { onDelete: 'cascade' }),
    jobId: text('job_id').references(() => jobs.id, { onDelete: 'set null' }),
    quoteId: text('quote_id').references(() => quotes.id, { onDelete: 'set null' }),
    status: invoiceStatusEnum('status').default('DRAFT').notNull(),
    publicToken: text('public_token').notNull().unique(),
    issueDate: timestamp('issue_date', { withTimezone: true }).defaultNow().notNull(),
    dueDate: timestamp('due_date', { withTimezone: true }).notNull(),
    buyerName: text('buyer_name').notNull(),
    buyerTaxId: text('buyer_tax_id'),
    buyerStreet: text('buyer_street'),
    buyerCity: text('buyer_city'),
    buyerPostalCode: text('buyer_postal_code'),
    subtotalCents: money('subtotal_cents'),
    taxCents: money('tax_cents'),
    totalCents: money('total_cents'),
    paidCents: money('paid_cents'),
    notes: text('notes'),
    paymentMethod: paymentMethodEnum('payment_method'),
    sentAt: timestamp('sent_at', { withTimezone: true }),
    paidAt: timestamp('paid_at', { withTimezone: true }),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
    // --- KSeF (integracja zewnętrzna) ---
    ksefStatus: ksefStatusEnum('ksef_status').default('NOT_CONFIGURED').notNull(),
    ksefMode: text('ksef_mode'), // TEST | PROD
    ksefReferenceNumber: text('ksef_reference_number'),
    ksefNumber: text('ksef_number'),
    ksefSubmittedAt: timestamp('ksef_submitted_at', { withTimezone: true }),
    ksefAcceptedAt: timestamp('ksef_accepted_at', { withTimezone: true }),
    ksefRejectedAt: timestamp('ksef_rejected_at', { withTimezone: true }),
    ksefErrorCode: text('ksef_error_code'),
    ksefErrorMessage: text('ksef_error_message'),
    ksefUpoAvailable: boolean('ksef_upo_available').default(false).notNull(),
    ksefUpoDownloadedAt: timestamp('ksef_upo_downloaded_at', { withTimezone: true }),
    ksefLastCheckedAt: timestamp('ksef_last_checked_at', { withTimezone: true }),
    ksefIdempotencyKey: text('ksef_idempotency_key'),
    createdById: text('created_by_id').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('invoices_org_number_uq').on(t.organizationId, t.number),
    index('invoices_org_status_idx').on(t.organizationId, t.status),
    index('invoices_org_due_idx').on(t.organizationId, t.dueDate),
  ],
);

export const invoiceItems = pgTable(
  'invoice_items',
  {
    id: text('id').primaryKey().$defaultFn(() => newId('ini')),
    invoiceId: text('invoice_id')
      .notNull()
      .references(() => invoices.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    description: text('description'),
    unit: unitEnum('unit').default('VISIT').notNull(),
    customUnitLabel: text('custom_unit_label'),
    quantity: quantity('quantity'),
    unitPriceCents: integer('unit_price_cents').default(0).notNull(),
    taxRateBps: integer('tax_rate_bps').default(2300).notNull(),
    netCents: money('net_cents'),
    taxCents: money('tax_cents'),
    grossCents: money('gross_cents'),
    sortOrder: integer('sort_order').default(0).notNull(),
  },
  (t) => [index('invoice_items_invoice_idx').on(t.invoiceId)],
);

export const payments = pgTable(
  'payments',
  {
    id: text('id').primaryKey().$defaultFn(() => newId('pay')),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    invoiceId: text('invoice_id')
      .notNull()
      .references(() => invoices.id, { onDelete: 'cascade' }),
    amountCents: integer('amount_cents').notNull(),
    method: paymentMethodEnum('method').default('BANK_TRANSFER').notNull(),
    paidAt: timestamp('paid_at', { withTimezone: true }).defaultNow().notNull(),
    reference: text('reference'),
    note: text('note'),
    recordedById: text('recorded_by_id').references(() => users.id, { onDelete: 'set null' }),
    stripePaymentIntentId: text('stripe_payment_intent_id'),
    createdAt: createdAt(),
  },
  (t) => [index('payments_org_invoice_idx').on(t.organizationId, t.invoiceId), index('payments_org_paid_idx').on(t.organizationId, t.paidAt)],
);

// ---------------------------------------------------------------------------
// Komunikacja, powiadomienia, opinie
// ---------------------------------------------------------------------------

export const communications = pgTable(
  'communications',
  {
    id: text('id').primaryKey().$defaultFn(() => newId('cmc')),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    channel: communicationChannelEnum('channel').default('EMAIL').notNull(),
    direction: communicationDirectionEnum('direction').default('OUTBOUND').notNull(),
    status: communicationStatusEnum('status').default('PENDING').notNull(),
    templateKey: text('template_key'),
    subject: text('subject'),
    body: text('body').notNull(),
    toAddress: text('to_address'),
    fromAddress: text('from_address'),
    provider: text('provider'),
    providerMessageId: text('provider_message_id'),
    error: text('error'),
    idempotencyKey: text('idempotency_key'),
    externalStatus: text('external_status'),
    sentAt: timestamp('sent_at', { withTimezone: true }),
    deliveredAt: timestamp('delivered_at', { withTimezone: true }),
    bouncedAt: timestamp('bounced_at', { withTimezone: true }),
    suppressedAt: timestamp('suppressed_at', { withTimezone: true }),
    openedAt: timestamp('opened_at', { withTimezone: true }),
    lastEventAt: timestamp('last_event_at', { withTimezone: true }),
    scheduledAt: timestamp('scheduled_at', { withTimezone: true }),
    customerId: text('customer_id').references(() => customers.id, { onDelete: 'set null' }),
    quoteId: text('quote_id').references(() => quotes.id, { onDelete: 'set null' }),
    jobId: text('job_id').references(() => jobs.id, { onDelete: 'set null' }),
    invoiceId: text('invoice_id').references(() => invoices.id, { onDelete: 'set null' }),
    userId: text('user_id').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
  },
  (t) => [
    index('communications_org_created_idx').on(t.organizationId, t.createdAt),
    index('communications_org_status_idx').on(t.organizationId, t.status),
    // klucz idempotencji: jeden automatyczny e-mail = jeden rekord, nawet przy restarcie workera
    uniqueIndex('communications_idempotency_idx').on(t.organizationId, t.idempotencyKey),
  ],
);

export const messageTemplates = pgTable(
  'message_templates',
  {
    id: text('id').primaryKey().$defaultFn(() => newId('mtp')),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    key: text('key').notNull(),
    name: text('name').notNull(),
    channel: communicationChannelEnum('channel').default('EMAIL').notNull(),
    subject: text('subject'),
    body: text('body').notNull(),
    isActive: boolean('is_active').default(true).notNull(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('message_templates_uq').on(t.organizationId, t.key)],
);

export const notifications = pgTable(
  'notifications',
  {
    id: text('id').primaryKey().$defaultFn(() => newId('ntf')),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    userId: text('user_id').references(() => users.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    body: text('body'),
    type: text('type').default('INFO').notNull(),
    link: text('link'),
    readAt: timestamp('read_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index('notifications_org_user_idx').on(t.organizationId, t.userId, t.readAt)],
);

export const reviewRequests = pgTable(
  'review_requests',
  {
    id: text('id').primaryKey().$defaultFn(() => newId('rvw')),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    customerId: text('customer_id')
      .notNull()
      .references(() => customers.id, { onDelete: 'cascade' }),
    jobId: text('job_id').references(() => jobs.id, { onDelete: 'set null' }),
    channel: reviewChannelEnum('channel').default('OWN_FORM').notNull(),
    status: reviewRequestStatusEnum('status').default('PENDING').notNull(),
    token: text('token').notNull().unique(),
    externalUrl: text('external_url'),
    rating: integer('rating'),
    comment: text('comment'),
    respondedAt: timestamp('responded_at', { withTimezone: true }),
    sentAt: timestamp('sent_at', { withTimezone: true }),
    error: text('error'),
    createdAt: createdAt(),
  },
  (t) => [index('review_requests_org_status_idx').on(t.organizationId, t.status)],
);

// ---------------------------------------------------------------------------
// Automatyzacje
// ---------------------------------------------------------------------------

export const automations = pgTable(
  'automations',
  {
    id: text('id').primaryKey().$defaultFn(() => newId('atm')),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    trigger: automationTriggerEnum('trigger').notNull(),
    action: automationActionEnum('action').notNull(),
    conditions: jsonb('conditions').$type<{ onlyIfUnaccepted?: boolean; minValueCents?: number }>().default({}).notNull(),
    actionConfig: jsonb('action_config')
      .$type<{ templateKey?: string; subject?: string; body?: string; title?: string; message?: string; status?: string; followUpDays?: number }>()
      .default({})
      .notNull(),
    delayMinutes: integer('delay_minutes').default(0).notNull(),
    isActive: boolean('is_active').default(true).notNull(),
    lastRunAt: timestamp('last_run_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('automations_org_active_idx').on(t.organizationId, t.isActive), index('automations_trigger_idx').on(t.trigger, t.isActive)],
);

export const automationRuns = pgTable(
  'automation_runs',
  {
    id: text('id').primaryKey().$defaultFn(() => newId('atr')),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    automationId: text('automation_id')
      .notNull()
      .references(() => automations.id, { onDelete: 'cascade' }),
    status: automationRunStatusEnum('status').default('PENDING').notNull(),
    scheduledAt: timestamp('scheduled_at', { withTimezone: true }).defaultNow().notNull(),
    startedAt: timestamp('started_at', { withTimezone: true }),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    attempts: integer('attempts').default(0).notNull(),
    targetType: text('target_type'),
    targetId: text('target_id'),
    result: text('result'),
    error: text('error'),
    createdAt: createdAt(),
  },
  (t) => [
    index('automation_runs_status_idx').on(t.status, t.scheduledAt),
    index('automation_runs_org_idx').on(t.organizationId, t.createdAt),
    index('automation_runs_automation_idx').on(t.automationId),
  ],
);

// ---------------------------------------------------------------------------
// Numeracja dokumentów (licznik atomowy — bezpieczny przy równoległych zapisach)
// ---------------------------------------------------------------------------

export const documentCounters = pgTable(
  'document_counters',
  {
    id: text('id').primaryKey().$defaultFn(() => newId('cnt')),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    prefix: text('prefix').notNull(),
    period: text('period').notNull(),
    current: integer('current').default(0).notNull(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('document_counters_uq').on(t.organizationId, t.prefix, t.period)],
);

// ---------------------------------------------------------------------------
// Pliki, aktywność, audyt
// ---------------------------------------------------------------------------

export const files = pgTable(
  'files',
  {
    id: text('id').primaryKey().$defaultFn(() => newId('fil')),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    /** Nazwa w storage — generowana przez system, nigdy nie pochodzi od użytkownika. */
    storageKey: text('storage_key').notNull().unique(),
    originalName: text('original_name').notNull(),
    mimeType: text('mime_type').notNull(),
    sizeBytes: integer('size_bytes').notNull(),
    checksum: text('checksum'),
    kind: text('kind').default('OTHER').notNull(),
    uploadedById: text('uploaded_by_id').references(() => users.id, { onDelete: 'set null' }),
    estimateId: text('estimate_id').references(() => estimates.id, { onDelete: 'set null' }),
    quoteId: text('quote_id').references(() => quotes.id, { onDelete: 'set null' }),
    requestId: text('request_id').references(() => serviceRequests.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
  },
  (t) => [index('files_org_created_idx').on(t.organizationId, t.createdAt)],
);

export const activities = pgTable(
  'activities',
  {
    id: text('id').primaryKey().$defaultFn(() => newId('act')),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    entityType: text('entity_type').notNull(),
    entityId: text('entity_id').notNull(),
    type: text('type').notNull(),
    message: text('message').notNull(),
    userId: text('user_id').references(() => users.id, { onDelete: 'set null' }),
    userName: text('user_name'),
    meta: jsonb('meta').$type<Record<string, unknown>>(),
    createdAt: createdAt(),
  },
  (t) => [
    index('activities_org_created_idx').on(t.organizationId, t.createdAt),
    index('activities_entity_idx').on(t.organizationId, t.entityType, t.entityId),
  ],
);

export const auditLogs = pgTable(
  'audit_logs',
  {
    id: text('id').primaryKey().$defaultFn(() => newId('aud')),
    organizationId: text('organization_id').references(() => organizations.id, { onDelete: 'cascade' }),
    userId: text('user_id').references(() => users.id, { onDelete: 'set null' }),
    action: text('action').notNull(),
    entityType: text('entity_type'),
    entityId: text('entity_id'),
    ip: text('ip'),
    userAgent: text('user_agent'),
    meta: jsonb('meta').$type<Record<string, unknown>>(),
    createdAt: createdAt(),
  },
  (t) => [index('audit_logs_org_idx').on(t.organizationId, t.createdAt), index('audit_logs_entity_idx').on(t.entityType, t.entityId)],
);

// ---------------------------------------------------------------------------
// Relacje (ułatwiają typowane zapytania z `db.query`)
// ---------------------------------------------------------------------------

/**
 * Zdarzenia przychodzące z webhooków (Stripe, Resend, KSeF).
 * Unikalny identyfikator zdarzenia u providera gwarantuje idempotencję:
 * powtórzony webhook nie wykona tej samej operacji dwa razy.
 */
export const webhookEvents = pgTable(
  'webhook_events',
  {
    id: text('id').primaryKey().$defaultFn(() => newId('whk')),
    provider: text('provider').notNull(), // STRIPE | RESEND | KSEF
    externalId: text('external_id').notNull(),
    type: text('type').notNull(),
    organizationId: text('organization_id').references(() => organizations.id, { onDelete: 'cascade' }),
    payload: jsonb('payload').$type<Record<string, unknown>>(),
    signatureValid: boolean('signature_valid').default(false).notNull(),
    error: text('error'),
    processedAt: timestamp('processed_at', { withTimezone: true }),
    receivedAt: createdAt(),
  },
  (t) => [
    uniqueIndex('webhook_events_provider_external_idx').on(t.provider, t.externalId),
    index('webhook_events_org_idx').on(t.organizationId),
  ],
);

export const organizationsRelations = relations(organizations, ({ many }) => ({
  memberships: many(memberships),
  customers: many(customers),
  services: many(services),
  jobs: many(jobs),
  invoices: many(invoices),
  quotes: many(quotes),
}));

export const membershipsRelations = relations(memberships, ({ one }) => ({
  organization: one(organizations, { fields: [memberships.organizationId], references: [organizations.id] }),
  user: one(users, { fields: [memberships.userId], references: [users.id] }),
}));

export const usersRelations = relations(users, ({ many }) => ({
  memberships: many(memberships),
  sessions: many(sessions),
  jobAssignments: many(jobAssignments),
}));

export const sessionsRelations = relations(sessions, ({ one }) => ({
  user: one(users, { fields: [sessions.userId], references: [users.id] }),
}));

export const customersRelations = relations(customers, ({ one, many }) => ({
  organization: one(organizations, { fields: [customers.organizationId], references: [organizations.id] }),
  addresses: many(customerAddresses),
  contacts: many(customerContacts),
  jobs: many(jobs),
  invoices: many(invoices),
  quotes: many(quotes),
}));

export const customerAddressesRelations = relations(customerAddresses, ({ one }) => ({
  customer: one(customers, { fields: [customerAddresses.customerId], references: [customers.id] }),
}));

export const jobsRelations = relations(jobs, ({ one, many }) => ({
  organization: one(organizations, { fields: [jobs.organizationId], references: [organizations.id] }),
  customer: one(customers, { fields: [jobs.customerId], references: [customers.id] }),
  crew: one(crews, { fields: [jobs.crewId], references: [crews.id] }),
  quote: one(quotes, { fields: [jobs.quoteId], references: [quotes.id] }),
  items: many(jobItems),
  assignments: many(jobAssignments),
  photos: many(jobPhotos),
  notes: many(jobNotes),
  timeEntries: many(timeEntries),
  checklists: many(checklists),
}));

export const jobAssignmentsRelations = relations(jobAssignments, ({ one }) => ({
  job: one(jobs, { fields: [jobAssignments.jobId], references: [jobs.id] }),
  user: one(users, { fields: [jobAssignments.userId], references: [users.id] }),
}));

export const jobPhotosRelations = relations(jobPhotos, ({ one }) => ({
  job: one(jobs, { fields: [jobPhotos.jobId], references: [jobs.id] }),
  file: one(files, { fields: [jobPhotos.fileId], references: [files.id] }),
}));

export const jobNotesRelations = relations(jobNotes, ({ one }) => ({
  job: one(jobs, { fields: [jobNotes.jobId], references: [jobs.id] }),
}));

export const timeEntriesRelations = relations(timeEntries, ({ one }) => ({
  job: one(jobs, { fields: [timeEntries.jobId], references: [jobs.id] }),
  user: one(users, { fields: [timeEntries.userId], references: [users.id] }),
}));

export const checklistsRelations = relations(checklists, ({ one, many }) => ({
  job: one(jobs, { fields: [checklists.jobId], references: [jobs.id] }),
  items: many(checklistItems),
}));

export const checklistItemsRelations = relations(checklistItems, ({ one }) => ({
  checklist: one(checklists, { fields: [checklistItems.checklistId], references: [checklists.id] }),
}));

export const crewsRelations = relations(crews, ({ many }) => ({
  members: many(crewMembers),
  jobs: many(jobs),
}));

export const crewMembersRelations = relations(crewMembers, ({ one }) => ({
  crew: one(crews, { fields: [crewMembers.crewId], references: [crews.id] }),
  user: one(users, { fields: [crewMembers.userId], references: [users.id] }),
}));

export const quotesRelations = relations(quotes, ({ one, many }) => ({
  customer: one(customers, { fields: [quotes.customerId], references: [customers.id] }),
  estimate: one(estimates, { fields: [quotes.estimateId], references: [estimates.id] }),
  items: many(quoteItems),
  events: many(quoteEvents),
}));

export const quoteItemsRelations = relations(quoteItems, ({ one }) => ({
  quote: one(quotes, { fields: [quoteItems.quoteId], references: [quotes.id] }),
}));

export const quoteEventsRelations = relations(quoteEvents, ({ one }) => ({
  quote: one(quotes, { fields: [quoteEvents.quoteId], references: [quotes.id] }),
}));

export const estimatesRelations = relations(estimates, ({ one, many }) => ({
  customer: one(customers, { fields: [estimates.customerId], references: [customers.id] }),
  items: many(estimateItems),
  quotes: many(quotes),
}));

export const estimateItemsRelations = relations(estimateItems, ({ one }) => ({
  estimate: one(estimates, { fields: [estimateItems.estimateId], references: [estimates.id] }),
}));

export const invoicesRelations = relations(invoices, ({ one, many }) => ({
  customer: one(customers, { fields: [invoices.customerId], references: [customers.id] }),
  job: one(jobs, { fields: [invoices.jobId], references: [jobs.id] }),
  items: many(invoiceItems),
  payments: many(payments),
}));

export const invoiceItemsRelations = relations(invoiceItems, ({ one }) => ({
  invoice: one(invoices, { fields: [invoiceItems.invoiceId], references: [invoices.id] }),
}));

export const paymentsRelations = relations(payments, ({ one }) => ({
  invoice: one(invoices, { fields: [payments.invoiceId], references: [invoices.id] }),
}));

export const servicesRelations = relations(services, ({ one, many }) => ({
  organization: one(organizations, { fields: [services.organizationId], references: [organizations.id] }),
  tiers: many(servicePrices),
}));

export const servicePricesRelations = relations(servicePrices, ({ one }) => ({
  service: one(services, { fields: [servicePrices.serviceId], references: [services.id] }),
}));

export const automationsRelations = relations(automations, ({ many }) => ({
  runs: many(automationRuns),
}));

export const automationRunsRelations = relations(automationRuns, ({ one }) => ({
  automation: one(automations, { fields: [automationRuns.automationId], references: [automations.id] }),
}));

export const filesRelations = relations(files, ({ one }) => ({
  organization: one(organizations, { fields: [files.organizationId], references: [organizations.id] }),
}));

// ---------------------------------------------------------------------------
// Typy pomocnicze
// ---------------------------------------------------------------------------

export type Organization = typeof organizations.$inferSelect;
export type User = typeof users.$inferSelect;
export type Membership = typeof memberships.$inferSelect;
export type Customer = typeof customers.$inferSelect;
export type CustomerAddress = typeof customerAddresses.$inferSelect;
export type Lead = typeof leads.$inferSelect;
export type ServiceRequest = typeof serviceRequests.$inferSelect;
export type Service = typeof services.$inferSelect;
export type ServicePrice = typeof servicePrices.$inferSelect;
export type Addon = typeof addons.$inferSelect;
export type Estimate = typeof estimates.$inferSelect;
export type EstimateItem = typeof estimateItems.$inferSelect;
export type Quote = typeof quotes.$inferSelect;
export type QuoteItem = typeof quoteItems.$inferSelect;
export type QuoteEvent = typeof quoteEvents.$inferSelect;
export type Job = typeof jobs.$inferSelect;
export type JobItem = typeof jobItems.$inferSelect;
export type JobPhoto = typeof jobPhotos.$inferSelect;
export type JobNote = typeof jobNotes.$inferSelect;
export type Crew = typeof crews.$inferSelect;
export type CrewMember = typeof crewMembers.$inferSelect;
export type Schedule = typeof schedules.$inferSelect;
export type TimeEntry = typeof timeEntries.$inferSelect;
export type Checklist = typeof checklists.$inferSelect;
export type ChecklistItem = typeof checklistItems.$inferSelect;
export type Invoice = typeof invoices.$inferSelect;
export type InvoiceItem = typeof invoiceItems.$inferSelect;
export type Payment = typeof payments.$inferSelect;
export type Communication = typeof communications.$inferSelect;
export type Notification = typeof notifications.$inferSelect;
export type ReviewRequest = typeof reviewRequests.$inferSelect;
export type Automation = typeof automations.$inferSelect;
export type AutomationRun = typeof automationRuns.$inferSelect;
export type Activity = typeof activities.$inferSelect;
export type FileRecord = typeof files.$inferSelect;
export type AuditLog = typeof auditLogs.$inferSelect;
export type MessageTemplate = typeof messageTemplates.$inferSelect;
export type DocumentCounter = typeof documentCounters.$inferSelect;
export type Invitation = typeof invitations.$inferSelect;
