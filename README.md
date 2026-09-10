# ServiceFlow

System operacyjny dla firm usługowych: od zapytania klienta do opłaconego zlecenia.
Prawdziwa, wielodzierżawcza aplikacja SaaS (Next.js 15 + PostgreSQL + Drizzle ORM) — **bez atrap**:
brak skonfigurowanej integracji oznacza jawny status „nie jest jeszcze skonfigurowana”, a nie udawany sukces.

## Szybki start

```bash
npm run setup     # zależności + .env + lokalny PostgreSQL + migracje
npm run dev       # http://localhost:3000
npm run db:seed   # opcjonalnie: organizacja DEMO (login: demo@serviceflow.test / DemoHaslo123!)
```

Wszystkie dane są zapisywane w prawdziwej bazie PostgreSQL — nic nie jest mockowane.

## Najważniejsze komendy

| Komenda | Opis |
| --- | --- |
| `npm run dev` | serwer deweloperski |
| `npm run build` / `npm start` | build produkcyjny i uruchomienie |
| `npm test` | wszystkie testy (148): jednostkowe, integracyjne, HTTP, bezpieczeństwo |
| `npm run typecheck` | kontrola typów TypeScript |
| `npm run db:seed` | dane demonstracyjne (organizacja `is_demo = true`) |
| `npm run cron` | jednorazowe uruchomienie zadań cyklicznych (wymaga `CRON_SECRET`) |
| `npm run worker` | pętla workera (automatyzacje, przeterminowania, nieaktywni klienci) |
| `npm run db:start` / `db:stop` / `db:status` | lokalny klaster PostgreSQL |

## Przebieg biznesowy (end-to-end)

rejestracja → konfiguracja firmy → klient → lead → zapytanie (+ analiza AI) → wycena →
oferta (PDF) → akceptacja w portalu klienta → zlecenie → harmonogram i ekipa →
wykonanie w terenie (status, zdjęcia, notatki, checklista, czas pracy) → faktura (PDF) →
płatność (ręczna lub Stripe) → KSeF → e-mail i automatyzacje (follow-up, prośba o opinię) →
analityka i asystent.

## Zasady architektury (egzekwowane testami)

1. **Izolacja danych** — każda operacja jest filtrowana po `organizationId` po stronie serwera;
   cudzy rekord = 404, cudzy moduł = 403 (patrz `tests/security/isolation.test.ts`).
2. **Pieniądze liczy kod** — kwoty, rabaty, VAT i podsumowania powstają w silniku cenowym i SQL,
   nigdy w modelu AI. AI jest opcjonalne i nie jest źródłem prawdy o cenie, podatku ani płatności.
3. **Brak udawanych integracji** — Stripe, Resend, KSeF i model AI mają status
   `CONNECTED / NOT_CONFIGURED / ERROR`. Przyjęcie żądania przez API (2xx) to **nie** to samo co
   dostarczenie e-maila, zaksięgowanie płatności ani numer KSeF.
4. **Audyt** — krytyczne akcje (faktury, płatności, oferty, zlecenia, KSeF, uprawnienia, zgody)
   są zapisywane w `audit_logs`.
5. **Idempotencja** — webhooki (unikalny `externalId`), płatności (`payment_intent`) i wysyłka
   wiadomości (`idempotencyKey`) nie wykonują się dwa razy.
6. **Paginacja i limity** — listy są stronicowane w SQL, a endpointy publiczne i wysyłkowe
   mają ograniczenia liczby żądań (rate limiting).

## Role i uprawnienia

`OWNER`, `ADMIN`, `DISPATCHER`, `WORKER`, `VIEWER`. Uprawnienia są sprawdzane serwerem
(`src/lib/authz/permissions.ts` + `src/lib/auth/guards.ts`). Pracownik (`job:self`) realizuje
wyłącznie zlecenia, do których jest przypisany.

## Subskrypcja i okres próbny

- nowa firma dostaje 10 dni próby (`trialEndsAt`, `subscriptionStatus = TRIALING`) — ustawia to serwer,
- po zakończeniu próby zapisy są blokowane (tryb „tylko do odczytu”), a droga płatności prowadzi przez
  prawdziwy checkout Stripe (`/api/webhooks/stripe` aktywuje subskrypcję po potwierdzeniu z serwera Stripe),
- plan START jest darmowy i nie wymaga płatności.

## Integracje (zmienne środowiskowe)

| Integracja | Zmienne | Zachowanie bez konfiguracji |
| --- | --- | --- |
| E-mail (Resend/SMTP) | `RESEND_API_KEY`, `RESEND_WEBHOOK_SECRET` lub `SMTP_*` | status `SKIPPED_NO_PROVIDER`, nic nie jest wysyłane |
| Płatności (Stripe) | `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_*` | brak płatności online, endpointy zwracają 503 |
| KSeF | `KSEF_MODE`, `KSEF_NIP`, `KSEF_TOKEN` | status „Nie skonfigurowano”, numer KSeF „nie nadano” |
| AI | `AI_PROVIDER` + `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` | działa silnik regułowy (wyraźnie oznaczony) |
| Cron / worker | `CRON_SECRET` | `/api/cron/run` zwraca 503 |

## Testy

```bash
npm test                      # 148 testów (wymaga uruchomionej bazy i serwera)
npx vitest run tests/unit     # reguły: ceny, pieniądze, subskrypcja, zgody, paginacja
npx vitest run tests/security # IDOR, role, webhooki, rate limiting — „brak dostępu = test zaliczony”
```

Zakres: silnik cenowy i podatki, płatności i idempotencja webhooków, automatyzacje (kolejka,
warunki, logi), opinie, analityka (agregaty SQL), paginacja, czas pracy, komunikacja (statusy
dostarczenia), KSeF, AI (silnik regułowy), izolacja danych, uprawnienia ról oraz renderowanie
każdej strony (HTTP).
