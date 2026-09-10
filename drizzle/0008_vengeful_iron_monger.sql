ALTER TABLE "estimates" ADD COLUMN "currency" text DEFAULT 'PLN' NOT NULL;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "currency" text DEFAULT 'PLN' NOT NULL;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "currency" text DEFAULT 'PLN' NOT NULL;--> statement-breakpoint
ALTER TABLE "quotes" ADD COLUMN "currency" text DEFAULT 'PLN' NOT NULL;