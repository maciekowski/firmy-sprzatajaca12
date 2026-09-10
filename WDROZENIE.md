# Wdrożenie ServiceFlow — konfiguracja integracji krok po kroku

Ten dokument opisuje, jak uruchomić ServiceFlow na prawdziwych kluczach.
Zasada projektowa jest niezmienna: **bez skonfigurowanej integracji system jej nie udaje**.
Puste zmienne = status `NOT_CONFIGURED`, a UI pokazuje „Integracja nie jest jeszcze
skonfigurowana” (nigdy „Połączono”).

## 0. Podstawa

```bash
git clone <repo> && cd firmy-sprzatajaca12
npm install
cp .env.example .env        # uzupełnij APP_SECRET i CRON_SECRET losowymi ciągami
npm run db:init             # klaster PostgreSQL w .pgdata (port 5433)
npm run db:migrate          # migracje
npm run build && npm start  # lub npm run dev
```

`APP_URL` musi być publicznym adresem aplikacji (używanym w linkach do portalu klienta,
faktur, ofert i zaproszeń). W produkcji ustaw np. `https://app.twojadomena.pl`.

## 1. Poczta wychodząca (Resend lub SMTP)

Bez działającej poczty system **nie wysyła wiadomości** — zapisuje je ze statusem
`SKIPPED_NO_PROVIDER` (widać to w module Komunikacja). API providera przyjmujące wiadomość
(2xx) to **nie** to samo co dostarczenie: status `DELIVERED` pojawia się dopiero po webhooku.

### Opcja A — Resend (zalecane)

```env
RESEND_API_KEY="re_..."
RESEND_WEBHOOK_SECRET="whsec_..."
MAIL_FROM="Twoja Firma <faktury@twojadomena.pl>"
```

1. Konto na [resend.com](https://resend.com), weryfikacja domeny (rekordy SPF/DKIM/DMARC).
2. `MAIL_FROM` musi być na zweryfikowanej domenie — inaczej Resend odrzuci wysyłkę.
3. Webhook w panelu Resend → **Add webhook** → URL: `https://<APP_URL>/api/webhooks/resend`.
   Zaznacz zdarzenia: `email.sent`, `email.delivered`, `email.delivery_delayed`,
   `email.bounced`, `email.complained`. Skopiuj Signing Secret do `RESEND_WEBHOOK_SECRET`.

### Opcja B — SMTP

```env
SMTP_HOST="smtp.twojadomena.pl"
SMTP_PORT="587"
SMTP_SECURE="false"
SMTP_USER="..."
SMTP_PASSWORD="..."
MAIL_FROM="Twoja Firma <faktury@twojadomena.pl>"
```

SMTP daje tylko potwierdzenie przyjęcia przez serwer — status pozostaje `SENT`
(bez `DELIVERED`), co jest uczciwie pokazywane w aplikacji.

**Test:** Ustawienia → Integracje → wyślij testową wiadomość, a potem sprawdź w
Komunikacja, czy status to `SENT`/`DELIVERED`, a nie `SKIPPED_NO_PROVIDER`.

## 2. Płatności (Stripe)

```env
STRIPE_SECRET_KEY="sk_live_..."        # na początek sk_test_...
STRIPE_WEBHOOK_SECRET="whsec_..."
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY="pk_live_..."
STRIPE_PRICE_PRO="price_..."           # ceny subskrypcji z panelu Stripe
STRIPE_PRICE_BUSINESS="price_..."
```

1. W panelu Stripe utwórz dwa produkty (PRO, BUSINESS) z cenami miesięcznymi i skopiuj
   identyfikatory `price_...` do `.env`.
2. **Webhook** (Developers → Webhooks → Add endpoint):
   `https://<APP_URL>/api/webhooks/stripe`, zdarzenia:
   `checkout.session.completed`, `customer.subscription.created`,
   `customer.subscription.updated`, `customer.subscription.deleted`,
   `invoice.payment_succeeded`, `invoice.payment_failed`.
3. Skopiuj Signing Secret do `STRIPE_WEBHOOK_SECRET`.

**Bezpieczeństwo (egzekwowane w kodzie i testach):**

- pieniądze są księgowane **wyłącznie** po zweryfikowaniu podpisu webhooka
  (`constructStripeEvent`) i zapisaniu zdarzenia w `webhook_events` (idempotencja po `event.id`),
- przekierowanie po checkoutcie **nie** księguje płatności,
- bez kluczy płatności kartą są nieaktywne, a UI mówi to wprost (brak symulacji).

**Test:** tryb testowy Stripe → karta `4242 4242 4242 4242` → faktura zmienia status na
`PAID` dopiero po doręczeniu webhooka (można przyspieszyć: `stripe listen --forward-to
localhost:3000/api/webhooks/stripe`).

## 3. KSeF (status i wysyłka faktur)

```env
KSEF_MODE="test"                 # test | production (puste = nie skonfigurowano)
KSEF_NIP="1234567890"
KSEF_TOKEN="..."                 # token autoryzacyjny KSeF
KSEF_ENVIRONMENT_URL=""          # opcjonalnie: własny endpoint
```

KSeF w ServiceFlow to **zewnętrzna warstwa synchronizacji statusu** — nie generuje numerów
faktur ani kwot. Dopóki KSeF nie nada numeru, aplikacja pokazuje „nie nadano (numer
przydziela KSeF)”. Akcje (oznacz gotową / wyślij / odśwież / pobierz UPO) są audytowane.

Tryb `test` korzysta ze środowiska testowego KSeF; do produkcji wymagany jest token
i certyfikat wystawiony dla firmy.

## 4. AI (opcjonalnie)

```env
AI_PROVIDER="openai"         # openai | anthropic | puste = silnik regułowy
AI_MODEL="gpt-4o-mini"
OPENAI_API_KEY="sk-..."
# ANTHROPIC_API_KEY="..."    # gdy AI_PROVIDER=anthropic
```

Bez klucza działa **silnik regułowy** — wyraźnie oznaczony w interfejsie. AI nigdy nie liczy
pieniędzy: cena, VAT, numer faktury i status płatności powstają wyłącznie w kodzie.

## 5. Cron i worker (automatyzacje)

```env
CRON_SECRET="długi-losowy-ciąg"
WORKER_INTERVAL_SECONDS="60"              # pętla dla npm run worker
CRON_INACTIVE_CUSTOMER_DAYS="90"          # próg „klient nieaktywny”
```

- `curl -X POST -H "x-cron-secret: $CRON_SECRET" https://<APP_URL>/api/cron/run`
  (bez sekretu endpoint zwraca 401; gdy `CRON_SECRET` nie ustawiony — 503),
- albo w tle: `npm run worker` / `npm run cron`.

Endpoint uruchamia: przeterminowane faktury, przypomnienia, nieaktywnych klientów i
kolejkę automatyzacji (każdy przebieg jest logowany w `automation_runs`, z idempotencją).

## 6. Koszty i plany

```env
PLAN_PRO_PRICE_CENTS="8900"
PLAN_BUSINESS_PRICE_CENTS="24900"
```

Limity planów (liczba użytkowników, zlecenia) są w `src/lib/billing/plans.ts` i są
sprawdzane serwerem — START: 1 użytkownik / 20 zleceń, PRO: 5, BUSINESS: 20.

## 7. Checklista przed produkcją

- [ ] `APP_URL` na HTTPS, `APP_SECRET` i `CRON_SECRET` losowe i niepowtarzalne
- [ ] PostgreSQL poza katalogiem projektu, codzienne kopie zapasowe
- [ ] poczta zweryfikowana (SPF/DKIM/DMARC) + webhook Resend
- [ ] Stripe: ceny `price_...`, webhook + weryfikacja podpisu, tryb LIVE
- [ ] KSeF: tryb produkcyjny i token firmowy
- [ ] `npm run build` przechodzi, `npm test` zielone
- [ ] `npm run cron` (lub harmonogram zewnętrzny) działa
- [ ] logi audytowe (`audit_logs`) są archiwizowane

## 8. Diagnostyka

| Objaw | Przyczyna |
| --- | --- |
| „Integracja nie jest jeszcze skonfigurowana” | brakujące zmienne środowiskowe (celowe) |
| Wiadomość ma status `SKIPPED_NO_PROVIDER` | brak Resend/SMTP — nic nie wysłano |
| Wiadomość `SENT`, ale nie `DELIVERED` | brak webhooka Resend (API przyjęło, dostarczenie niepotwierdzone) |
| Faktura nadal nieopłacona po płatności | webhook Stripe nie dotarł — sprawdź podpis i `STRIPE_WEBHOOK_SECRET` |
| `/api/cron/run` → 401 | zły `x-cron-secret`; → 503: nie ustawiono `CRON_SECRET` |
| Faktura bez numeru KSeF | KSeF nie nadał numeru — aplikacja pokazuje prawdę, nie wymyśla numeru |
