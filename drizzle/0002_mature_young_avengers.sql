CREATE TYPE "public"."ksef_status" AS ENUM('NOT_CONFIGURED', 'READY', 'SUBMITTING', 'SUBMITTED', 'PROCESSING', 'ACCEPTED', 'REJECTED', 'ERROR');--> statement-breakpoint
CREATE TABLE "webhook_events" (
	"id" text PRIMARY KEY NOT NULL,
	"provider" text NOT NULL,
	"external_id" text NOT NULL,
	"type" text NOT NULL,
	"organization_id" text,
	"payload" jsonb,
	"signature_valid" boolean DEFAULT false NOT NULL,
	"error" text,
	"processed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "communications" ALTER COLUMN "status" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "communications" ALTER COLUMN "status" SET DEFAULT 'PENDING'::text;--> statement-breakpoint
DROP TYPE "public"."communication_status";--> statement-breakpoint
CREATE TYPE "public"."communication_status" AS ENUM('PENDING', 'QUEUED', 'SENT', 'DELIVERED', 'FAILED', 'BOUNCED', 'SUPPRESSED', 'SKIPPED_NO_PROVIDER', 'SKIPPED_NO_CONSENT');--> statement-breakpoint
ALTER TABLE "communications" ALTER COLUMN "status" SET DEFAULT 'PENDING'::"public"."communication_status";--> statement-breakpoint
ALTER TABLE "communications" ALTER COLUMN "status" SET DATA TYPE "public"."communication_status" USING "status"::"public"."communication_status";--> statement-breakpoint
ALTER TABLE "communications" ADD COLUMN "idempotency_key" text;--> statement-breakpoint
ALTER TABLE "communications" ADD COLUMN "external_status" text;--> statement-breakpoint
ALTER TABLE "communications" ADD COLUMN "delivered_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "communications" ADD COLUMN "bounced_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "communications" ADD COLUMN "suppressed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "communications" ADD COLUMN "opened_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "communications" ADD COLUMN "last_event_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "ksef_status" "ksef_status" DEFAULT 'NOT_CONFIGURED' NOT NULL;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "ksef_mode" text;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "ksef_reference_number" text;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "ksef_number" text;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "ksef_submitted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "ksef_accepted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "ksef_rejected_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "ksef_error_code" text;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "ksef_error_message" text;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "ksef_upo_available" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "ksef_upo_downloaded_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "ksef_last_checked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "ksef_idempotency_key" text;--> statement-breakpoint
ALTER TABLE "webhook_events" ADD CONSTRAINT "webhook_events_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "webhook_events_provider_external_idx" ON "webhook_events" USING btree ("provider","external_id");--> statement-breakpoint
CREATE INDEX "webhook_events_org_idx" ON "webhook_events" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "communications_idempotency_idx" ON "communications" USING btree ("organization_id","idempotency_key");