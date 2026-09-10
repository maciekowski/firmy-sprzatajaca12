import 'dotenv/config';
/**
 * Dane demonstracyjne — organizacja DEMO.
 *
 * Zasady:
 *  - organizacja jest jawnie oznaczona jako DEMO (`is_demo = true`) i całkowicie
 *    odseparowana od prawdziwych danych klientów,
 *  - skrypt jest bezpieczny do ponownego uruchomienia (aktualizuje istniejącą firmę DEMO),
 *  - wszystkie liczby są liczone przez te same serwisy, których używa aplikacja
 *    (żadnego „wstrzykiwania” wyników do bazy).
 *
 * Uruchomienie: npm run db:seed
 */
import { randomBytes } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { customers, memberships, organizations, services, users } from '@/lib/db/schema';
import { hashPassword } from '@/lib/auth/password';
import { seedDefaultAutomations, seedMessageTemplates } from '@/lib/org-defaults';
import { createService } from '@/lib/services/catalog';
import { createLead } from '@/lib/services/leads';
import { createRequest } from '@/lib/services/requests';
import { createEstimate, createQuoteFromEstimate } from '@/lib/services/estimates';
import { createJob, completeJob, scheduleJob } from '@/lib/services/jobs';
import { createInvoice, recordPayment } from '@/lib/services/invoices';
import { createAutomation } from '@/lib/services/automations';

const DEMO_EMAIL = 'demo@serviceflow.test';
const DEMO_PASSWORD = 'DemoHaslo123!';

async function main(): Promise<void> {
  // 1) użytkownik demo
  let [user] = await db.select().from(users).where(eq(users.email, DEMO_EMAIL)).limit(1);
  if (!user) {
    [user] = await db
      .insert(users)
      .values({ email: DEMO_EMAIL, name: 'Demo ServiceFlow', passwordHash: await hashPassword(DEMO_PASSWORD) })
      .returning();
    console.log(`✓ Utworzono użytkownika demo: ${DEMO_EMAIL}`);
  }

  // 2) organizacja demo (odseparowana od prawdziwych danych)
  let [organization] = await db.select().from(organizations).where(eq(organizations.slug, 'demo')).limit(1);
  if (!organization) {
    [organization] = await db
      .insert(organizations)
      .values({
        name: 'DEMO — Firma sprzątająca',
        slug: 'demo',
        businessType: 'CLEANING',
        city: 'Kraków',
        street: 'ul. Przykładowa 1',
        postalCode: '30-001',
        taxId: '6793087624',
        phone: '+48 600 100 200',
        email: 'biuro@demo.test',
        currency: 'PLN',
        taxRateBps: 2300,
        isDemo: true,
        subscriptionStatus: 'ACTIVE',
      })
      .returning();
    console.log('✓ Utworzono organizację DEMO');
  }

  const [membership] = await db
    .select()
    .from(memberships)
    .where(and(eq(memberships.organizationId, organization.id), eq(memberships.userId, user.id)))
    .limit(1);

  if (!membership) {
    await db.insert(memberships).values({ organizationId: organization.id, userId: user.id, role: 'OWNER' });
  }

  await seedMessageTemplates(organization.id);
  await seedDefaultAutomations(organization.id);

  const ctx = { organizationId: organization.id, userId: user.id, userName: user.name };

  // 3) katalog usług (tylko jeśli pusty)
  const existingServices = await db.select().from(services).where(eq(services.organizationId, organization.id)).limit(1);
  if (existingServices.length === 0) {
    await createService(ctx, {
      name: 'Sprzątanie mieszkania',
      description: 'Sprzątanie standardowe — przykład danych demo',
      unit: 'SQM',
      pricingMode: 'PER_UNIT',
      basePriceCents: 600,
      minPriceCents: 25_000,
      taxRateBps: 2300,
      durationMinutes: 120,
    });
    await createService(ctx, {
      name: 'Mycie okien',
      unit: 'PIECE',
      pricingMode: 'PER_UNIT',
      basePriceCents: 3_500,
      taxRateBps: 2300,
      durationMinutes: 30,
    });
    await createService(ctx, {
      name: 'Sprzątanie po remoncie',
      unit: 'HOUR',
      pricingMode: 'HOURLY',
      basePriceCents: 0,
      hourlyRateCents: 8_500,
      taxRateBps: 2300,
      durationMinutes: 240,
    });
    console.log('✓ Katalog usług demo');
  }

  const [serviceRows] = [await db.select().from(services).where(eq(services.organizationId, organization.id))];

  // 4) przykładowi klienci (wstawiani bezpośrednio — identyczne reguły jak w aplikacji)
  const [customerOne] = await db
    .insert(customers)
    .values({
      organizationId: organization.id,
      type: 'INDIVIDUAL',
      firstName: 'Anna',
      lastName: 'Demo',
      displayName: 'Anna Demo',
      email: 'anna.demo@example.com',
      phone: '+48 600 111 222',
      city: 'Kraków',
      street: 'ul. Demo 10',
      postalCode: '30-002',
      source: 'WEBSITE',
      emailOptIn: true,
    })
    .returning();

  const [customerTwo] = await db
    .insert(customers)
    .values({
      organizationId: organization.id,
      type: 'COMPANY',
      companyName: 'Biuro Demo Sp. z o.o.',
      displayName: 'Biuro Demo Sp. z o.o.',
      email: 'biuro.demo@example.com',
      phone: '+48 600 333 444',
      city: 'Kraków',
      street: 'ul. Testowa 5',
      postalCode: '30-003',
      taxId: '5252674798',
      source: 'REFERRAL',
      emailOptIn: true,
    })
    .returning();

  // 5) leady, zapytania, wyceny, oferty, zlecenia, faktury
  await createLead(ctx, {
    title: 'Sprzątanie mieszkania 60 m² — lead demo',
    description: 'Przykładowy lead (dane demonstracyjne)',
    contactName: 'Anna Demo',
    contactEmail: 'anna.demo@example.com',
    contactPhone: '+48 600 111 222',
    source: 'WEBSITE',
    estimatedValueCents: 45_000,
  });

  await createRequest(ctx, {
    contactName: 'Biuro Demo',
    contactEmail: 'biuro.demo@example.com',
    description: 'Proszę o wycenę sprzątania biura 120 m², dwa razy w tygodniu.',
    city: 'Kraków',
    channel: 'EMAIL',
    urgency: 'NORMAL',
  });

  const estimate = await createEstimate(ctx, {
    customerId: customerOne.id,
    lines: [
      { name: 'Sprzątanie mieszkania', quantity: 60, unit: 'SQM', unitPriceCents: 600, taxRateBps: 2300 },
      { name: 'Mycie okien', quantity: 6, unit: 'PIECE', unitPriceCents: 3_500, taxRateBps: 2300 },
    ],
    travelFeeType: 'FLAT',
    travelFlatFeeCents: 4_000,
  });

  const quote = await createQuoteFromEstimate(ctx, estimate.id, { validDays: 14 });

  const job = await createJob(ctx, {
    title: 'Sprzątanie mieszkania — DEMO',
    description: 'Zlecenie demonstracyjne',
    customerId: customerTwo.id,
    scheduledStart: new Date(Date.now() + 24 * 60 * 60 * 1000),
    scheduledEnd: new Date(Date.now() + 27 * 60 * 60 * 1000),
    estimatedMinutes: 180,
    notes: 'Przykładowe dane demonstracyjne',
  });

  if (job.ok) {
    await scheduleJob(ctx, job.data!.id, {
      scheduledStart: new Date(Date.now() + 24 * 60 * 60 * 1000),
      scheduledEnd: new Date(Date.now() + 27 * 60 * 60 * 1000),
      crewId: null,
    });
    await completeJob(ctx, job.data!.id, { note: 'Zlecenie demonstracyjne zakończone' });

    const invoice = await createInvoice(ctx, {
      customerId: customerTwo.id,
      jobId: job.data!.id,
      dueDate: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
      lines: [{ name: 'Sprzątanie biura — DEMO', quantity: 4, unitPriceCents: 25_000, unit: 'VISIT', taxRateBps: 2300 }],
    });

    if (invoice.ok) {
      await recordPayment(ctx, invoice.data!.id, { amountCents: 30_000, method: 'BANK_TRANSFER', reference: 'DEMO-1' });
    }
  }

  // 6) przykładowa automatyzacja (działająca, nie „demo-na-pokaz”)
  await createAutomation(ctx, {
    name: 'Przypomnienie o ofercie po 2 dniach (DEMO)',
    trigger: 'QUOTE_SENT',
    action: 'CREATE_NOTIFICATION',
    delayMinutes: 2 * 24 * 60,
    conditions: { onlyIfUnaccepted: true },
    actionConfig: { title: 'Oferta bez odpowiedzi', message: 'Przypomnij się klientowi — dane demonstracyjne.' },
  });

  console.log('✓ Dane demonstracyjne gotowe');
  console.log(`  login: ${DEMO_EMAIL}`);
  console.log(`  hasło: ${DEMO_PASSWORD}`);
  console.log(`  organizacja: ${organization.name} (id: ${organization.id}, is_demo = true)`);
  console.log(`  usługi w katalogu: ${serviceRows?.length ?? 0}`);
}

main()
  .then(() => {
    console.log('✓ Seed zakończony');
    process.exit(0);
  })
  .catch((error) => {
    console.error('✗ Seed nie powiódł się:', error instanceof Error ? error.message : error);
    process.exit(1);
  });

/** Losowy sufiks (używany, gdy potrzebna jest unikalność w seedzie). */
export const randomSuffix = (): string => randomBytes(3).toString('hex');
