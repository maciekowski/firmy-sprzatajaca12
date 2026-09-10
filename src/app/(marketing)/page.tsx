import Link from 'next/link';
import {
  ArrowRight,
  Banknote,
  CalendarDays,
  CheckCircle2,
  ClipboardList,
  FileText,
  Gauge,
  MessageSquare,
  ShieldCheck,
  Sparkles,
  Users,
  Wrench,
  Zap,
} from 'lucide-react';
import { ButtonLink, Card } from '@/components/ui';

const STEPS = [
  {
    title: 'Zapytanie',
    description: 'Klient pisze, dzwoni albo wypełnia formularz. Zapytanie trafia do jednej skrzynki — koniec z kartkami i WhatsAppem.',
    icon: MessageSquare,
  },
  {
    title: 'Wycena',
    description: 'Wybierasz usługę, podajesz ilość. Silnik cenowy liczy netto, rabat, podatek i brutto — bez Excela.',
    icon: Gauge,
  },
  {
    title: 'Oferta',
    description: 'Generujesz PDF i wysyłasz bezpieczny link. Klient akceptuje jednym kliknięciem, a Ty widzisz kiedy otworzył ofertę.',
    icon: FileText,
  },
  {
    title: 'Zlecenie',
    description: 'Z zaakceptowanej oferty powstaje zlecenie z klientem, adresem, pozycjami i zdjęciami. Planujesz je w kalendarzu.',
    icon: ClipboardList,
  },
  {
    title: 'Realizacja',
    description: 'Ekipa widzi zlecenia na telefonie: start, zdjęcia przed i po, checklista, notatki, czas pracy.',
    icon: Users,
  },
  {
    title: 'Płatność',
    description: 'Po zakończeniu generujesz fakturę, rejestrujesz płatność, a system przypomina klientowi i prosi o opinię.',
    icon: Banknote,
  },
];

const FEATURES = [
  {
    icon: Gauge,
    title: 'Wyceny i oferty',
    points: [
      'Ceny stałe, za jednostkę, godzinowe i progowe',
      'Minimum usługi i minimum zlecenia',
      'Dojazd, dopłata za pilność, rabaty procentowe i kwotowe',
      'Prawdziwy PDF z danymi firmy i klienta',
    ],
  },
  {
    icon: ClipboardList,
    title: 'Zlecenia i ekipy',
    points: [
      'Statusy od zaplanowania do zakończenia',
      'Przypisanie ekipy lub konkretnych pracowników',
      'Wykrywanie konfliktów terminów',
      'Checklisty, zdjęcia przed/po, notatki',
    ],
  },
  {
    icon: CalendarDays,
    title: 'Kalendarz',
    points: [
      'Widok dnia, tygodnia i miesiąca',
      'Planowanie z uwzględnieniem godzin pracy',
      'Przeciąganie terminów i zmiana przypisania',
      'Widok dostępności ekip',
    ],
  },
  {
    icon: Banknote,
    title: 'Faktury i płatności',
    points: [
      'Faktura ze zlecenia jednym kliknięciem',
      'Statusy: szkic, wysłana, opłacona, przeterminowana',
      'Rejestracja płatności częściowych',
      'Automatyczne przypomnienia po terminie',
    ],
  },
  {
    icon: Zap,
    title: 'Automatyzacje',
    points: [
      'Follow-up oferty po 2, 5 i 10 dniach',
      'Prośba o opinię dzień po zleceniu',
      'Monity o płatność',
      'Pełna historia wykonania każdej reguły',
    ],
  },
  {
    icon: ShieldCheck,
    title: 'Bezpieczeństwo',
    points: [
      'Odseparowane dane każdej firmy',
      'Role: właściciel, admin, dyspozytor, pracownik, podgląd',
      'Kontrola dostępu wymuszana na serwerze',
      'Log audytowy i historia zdarzeń',
    ],
  },
];

const INDUSTRIES = [
  'Sprzątanie',
  'Mycie okien',
  'Mycie kostki i elewacji',
  'Detailing',
  'Pranie tapicerki',
  'Przeprowadzki',
  'Ogrodnictwo',
  'Hydraulika',
  'Elektryka',
  'Klimatyzacja i HVAC',
  'Remonty i malowanie',
  'Serwis techniczny',
  'Dezynsekcja',
  'Odśnieżanie',
  'Dachy i ogrodzenia',
  'Utrzymanie nieruchomości',
];

export default function LandingPage() {
  return (
    <>
      {/* HERO */}
      <section className="relative overflow-hidden border-b border-ink-100">
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-brand-50 via-white to-white" />
        <div className="relative mx-auto max-w-6xl px-5 py-20 md:py-28">
          <div className="mx-auto max-w-3xl text-center">
            <span className="badge bg-brand-50 text-brand-700">
              <Sparkles className="h-3.5 w-3.5" /> Dla firm usługowych pracujących w terenie
            </span>
            <h1 className="mt-5 text-4xl font-semibold tracking-tight text-ink-900 md:text-6xl">
              Wszystko, czego potrzebuje Twoja ekipa usługowa — w jednym miejscu.
            </h1>
            <p className="mx-auto mt-6 max-w-2xl text-lg leading-relaxed text-ink-600">
              Od pierwszego zapytania klienta, przez wycenę i grafik ekipy, aż po wykonanie zlecenia, fakturę i płatność.
            </p>
            <div className="mt-9 flex flex-wrap items-center justify-center gap-3">
              <ButtonLink href="/rejestracja" variant="primary" size="lg">
                Zacznij za darmo <ArrowRight className="h-4 w-4" />
              </ButtonLink>
              <ButtonLink href="#jak-to-dziala" variant="secondary" size="lg">
                Zobacz jak działa
              </ButtonLink>
            </div>
            <p className="mt-4 text-sm text-ink-500">
              Bez karty płatniczej. Konfiguracja firmy zajmuje kilka minut.
            </p>
          </div>

          <div className="mt-16 grid gap-4 md:grid-cols-3">
            {[
              { value: '1 system', label: 'zamiar Excela, WhatsAppa i kartek' },
              { value: '1 link', label: 'zamiast mailowania PDF-ów w kółko' },
              { value: '0 ręcznych', label: 'przypomnień o ofertach i płatnościach' },
            ].map((item) => (
              <div key={item.label} className="card px-6 py-5 text-center">
                <p className="text-2xl font-semibold tracking-tight text-brand-700">{item.value}</p>
                <p className="mt-1 text-sm text-ink-600">{item.label}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* PROBLEM */}
      <section className="border-b border-ink-100 bg-white">
        <div className="mx-auto max-w-6xl px-5 py-20">
          <div className="grid gap-12 md:grid-cols-2 md:items-center">
            <div>
              <h2 className="text-3xl font-semibold tracking-tight text-ink-900">
                Prowadzisz firmę usługową, a nie biuro obsługi arkuszy kalkulacyjnych.
              </h2>
              <p className="mt-4 text-ink-600">
                Zapytania rozsypują się po skrzynkach i komunikatorach. Wyceny powstają „na oko”. Terminy są w głowie albo na
                kartce. Faktury czekają, aż znajdzie się chwila. O płatnościach przypomina się przypadkiem.
              </p>
              <ul className="mt-6 space-y-3 text-sm text-ink-700">
                {[
                  'Klient dzwoni „i jak z tą wyceną?”, bo oferta utknęła w mailu',
                  'Ekipa nie wie, co i gdzie ma robić — szczegóły są na WhatsAppie',
                  'Zdjęcia przed i po giną w galerii telefonu',
                  'Faktury wystawiasz wieczorem, z pamięci',
                  'Nikt nie prosi klientów o opinię, bo nikt nie ma na to czasu',
                ].map((item) => (
                  <li key={item} className="flex items-start gap-2">
                    <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-red-400" />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div className="card p-7">
              <p className="text-xs font-semibold uppercase tracking-wide text-ink-500">ServiceFlow porządkuje</p>
              <div className="mt-5 space-y-3">
                {[
                  { from: 'Zapytania z 5 źródeł', to: 'Jedna skrzynka zapytań' },
                  { from: 'Wycena w Excelu', to: 'Wycena z silnika cenowego' },
                  { from: 'Plan na kartce', to: 'Kalendarz i ekipy' },
                  { from: 'Zdjęcia w galerii', to: 'Raport ze zlecenia' },
                  { from: 'Faktura „kiedyś”', to: 'Faktura ze zlecenia' },
                  { from: 'Brak opinii', to: 'Automatyczna prośba o opinię' },
                ].map((row) => (
                  <div key={row.from} className="flex items-center justify-between gap-4 rounded-lg bg-ink-50 px-4 py-3">
                    <span className="text-sm text-ink-500 line-through decoration-ink-300">{row.from}</span>
                    <ArrowRight className="h-4 w-4 shrink-0 text-ink-300" />
                    <span className="text-sm font-medium text-ink-900">{row.to}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* JAK TO DZIAŁA */}
      <section id="jak-to-dziala" className="border-b border-ink-100 bg-ink-50">
        <div className="mx-auto max-w-6xl px-5 py-20">
          <div className="mx-auto max-w-2xl text-center">
            <h2 className="text-3xl font-semibold tracking-tight text-ink-900">Jak to działa</h2>
            <p className="mt-3 text-ink-600">
              Jeden ciągły proces od zapytania do opłaconego zlecenia — bez przepisywania danych między narzędziami.
            </p>
          </div>
          <div className="mt-12 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {STEPS.map((step, index) => (
              <Card key={step.title} className="p-6">
                <div className="flex items-center gap-3">
                  <span className="grid h-10 w-10 place-items-center rounded-lg bg-brand-50 text-brand-700">
                    <step.icon className="h-5 w-5" />
                  </span>
                  <span className="text-xs font-semibold uppercase tracking-wide text-ink-400">Krok {index + 1}</span>
                </div>
                <h3 className="mt-4 text-lg font-semibold text-ink-900">{step.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-ink-600">{step.description}</p>
              </Card>
            ))}
          </div>
        </div>
      </section>

      {/* FUNKCJE */}
      <section id="funkcje" className="border-b border-ink-100 bg-white">
        <div className="mx-auto max-w-6xl px-5 py-20">
          <div className="mx-auto max-w-2xl text-center">
            <h2 className="text-3xl font-semibold tracking-tight text-ink-900">Funkcje, które zastępują codzienną administrację</h2>
            <p className="mt-3 text-ink-600">
              Wyceny, zlecenia, ekipy, faktury i automatyzacje w jednym systemie — nie w pięciu oddzielnych.
            </p>
          </div>
          <div className="mt-12 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map((feature) => (
              <Card key={feature.title} className="p-6">
                <span className="grid h-10 w-10 place-items-center rounded-lg bg-ink-900 text-white">
                  <feature.icon className="h-5 w-5" />
                </span>
                <h3 className="mt-4 text-lg font-semibold text-ink-900">{feature.title}</h3>
                <ul className="mt-3 space-y-2 text-sm text-ink-600">
                  {feature.points.map((point) => (
                    <li key={point} className="flex items-start gap-2">
                      <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" />
                      <span>{point}</span>
                    </li>
                  ))}
                </ul>
              </Card>
            ))}
          </div>
        </div>
      </section>

      {/* BRANŻE */}
      <section className="border-b border-ink-100 bg-ink-50">
        <div className="mx-auto max-w-6xl px-5 py-20">
          <div className="flex flex-col items-center text-center">
            <span className="grid h-11 w-11 place-items-center rounded-xl bg-white text-ink-700 shadow-card">
              <Wrench className="h-5 w-5" />
            </span>
            <h2 className="mt-5 text-3xl font-semibold tracking-tight text-ink-900">Nie jesteśmy systemem dla jednej branży</h2>
            <p className="mt-3 max-w-2xl text-ink-600">
              Konfigurujesz rodzaj działalności, usługi, jednostki, ceny, ekipy i obszar działania. System dopasowuje się do
              Twojej firmy, a nie odwrotnie.
            </p>
          </div>
          <div className="mt-10 flex flex-wrap justify-center gap-2">
            {INDUSTRIES.map((industry) => (
              <span key={industry} className="rounded-full border border-ink-200 bg-white px-3.5 py-1.5 text-sm text-ink-700 shadow-card">
                {industry}
              </span>
            ))}
          </div>
        </div>
      </section>

      {/* OPINIE — wyraźnie oznaczone jako demonstracyjne */}
      <section className="border-b border-ink-100 bg-white">
        <div className="mx-auto max-w-6xl px-5 py-20">
          <div className="mx-auto max-w-2xl text-center">
            <h2 className="text-3xl font-semibold tracking-tight text-ink-900">Opinie</h2>
            <p className="mt-3 text-ink-600">
              ServiceFlow jest świeżym produktem, dlatego nie publikujemy opinii, których nie otrzymaliśmy. Poniżej
              znajdują się przykładowe, wyraźnie oznaczone opinie demonstracyjne.
            </p>
          </div>
          <div className="mt-10 grid gap-4 md:grid-cols-3">
            {[
              {
                quote:
                  'Wyceny robię w minutę, a klient akceptuje je z linku. Przestałem przepisywać dane z kartki do Excela.',
                author: 'Przykład — firma sprzątająca',
              },
              {
                quote:
                  'Ekipa widzi rano, gdzie ma być i co ma zrobić. Zdjęcia po zleceniu mamy w jednym miejscu.',
                author: 'Przykład — mycie kostki',
              },
              {
                quote:
                  'Przypomnienia o ofertach chodzą same. To największa różnica względem poprzedniego sposobu pracy.',
                author: 'Przykład — serwis klimatyzacji',
              },
            ].map((testimonial) => (
              <Card key={testimonial.author} className="p-6">
                <p className="text-sm leading-relaxed text-ink-700">„{testimonial.quote}”</p>
                <p className="mt-4 text-xs font-medium uppercase tracking-wide text-ink-400">
                  {testimonial.author} · opinia demonstracyjna
                </p>
              </Card>
            ))}
          </div>
        </div>
      </section>

      {/* CENNIK */}
      <section id="cennik" className="border-b border-ink-100 bg-ink-50">
        <div className="mx-auto max-w-6xl px-5 py-20">
          <div className="mx-auto max-w-2xl text-center">
            <h2 className="text-3xl font-semibold tracking-tight text-ink-900">Cennik</h2>
            <p className="mt-3 text-ink-600">Zacznij za darmo i zmieniaj plan, gdy firma urośnie.</p>
          </div>
          <div className="mt-10">
            <p className="text-center text-sm text-ink-600">
              Pełne porównanie planów znajdziesz na{' '}
              <Link href="/cennik" className="font-medium text-brand-700 hover:underline">
                stronie cennika
              </Link>
              .
            </p>
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section className="border-b border-ink-100 bg-white">
        <div className="mx-auto max-w-3xl px-5 py-20">
          <h2 className="text-3xl font-semibold tracking-tight text-ink-900">Najczęstsze pytania</h2>
          <div className="mt-8 divide-y divide-ink-100">
            {[
              {
                q: 'Czy system jest przystosowany do mojej branży?',
                a: 'Tak. Konfigurujesz rodzaj działalności, własne usługi, jednostki (m², godzina, sztuka, własna), ceny progi, ekipy i obszar działania.',
              },
              {
                q: 'Czy klienci mogą sami akceptować oferty?',
                a: 'Tak. Każda oferta ma bezpieczny link. Klient widzi ofertę, może ją zaakceptować, odrzucić lub poprosić o zmiany — każda akcja jest zapisana w historii.',
              },
              {
                q: 'Czy system wysyła wiadomości za mnie?',
                a: 'Tak, ale tylko przez skonfigurowanego dostawcę. Jeżeli nie podłączysz SMTP lub providera SMS, wiadomości nie zostaną wysłane — system pokaże to wprost, zamiast udawać wysyłkę.',
              },
              {
                q: 'Czy pracownik może obsłużyć zlecenie z telefonu?',
                a: 'Tak. Widok pracownika jest prosty i mobilny: dzisiejsze zlecenia, start, jestem na miejscu, zdjęcia, notatki, checklista, czas pracy i zakończenie.',
              },
              {
                q: 'Czy dane mojej firmy są odseparowane od innych?',
                a: 'Tak. Każda firma ma oddzielne dane, a dostęp jest sprawdzany przy każdym zapytaniu po stronie serwera. Uprawnienia wynikają z ról, nie z ukrywania elementów interfejsu.',
              },
            ].map((item) => (
              <div key={item.q} className="py-5">
                <p className="font-medium text-ink-900">{item.q}</p>
                <p className="mt-2 text-sm leading-relaxed text-ink-600">{item.a}</p>
              </div>
            ))}
          </div>
          <p className="mt-6 text-sm text-ink-500">
            Więcej odpowiedzi na{' '}
            <Link href="/faq" className="font-medium text-brand-700 hover:underline">
              stronie FAQ
            </Link>
            .
          </p>
        </div>
      </section>

      {/* CTA */}
      <section className="bg-brand-700">
        <div className="mx-auto max-w-4xl px-5 py-16 text-center">
          <h2 className="text-3xl font-semibold tracking-tight text-white">
            Zacznij za darmo i przejdź pierwsze zlecenie od końca do końca.
          </h2>
          <p className="mx-auto mt-4 max-w-2xl text-brand-50">
            Rejestracja, konfiguracja firmy, pierwsza usługa, pierwszy klient i pierwsza oferta — bez karty płatniczej.
          </p>
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <ButtonLink href="/rejestracja" variant="secondary" size="lg">
              Zacznij za darmo <ArrowRight className="h-4 w-4" />
            </ButtonLink>
            <ButtonLink href="/cennik" variant="ghost" size="lg" className="text-white hover:bg-white/10 hover:text-white">
              Zobacz cennik
            </ButtonLink>
          </div>
        </div>
      </section>
    </>
  );
}
