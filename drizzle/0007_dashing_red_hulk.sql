ALTER TABLE "sessions" ADD COLUMN "awaiting_2fa" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "totp_secret" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "totp_enabled_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "recovery_code_hashes" text[] DEFAULT '{}'::text[] NOT NULL;