ALTER TABLE "customers" ADD COLUMN "email_transactional_opt_in" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "email_system_opt_in" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "email_automation_opt_in" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "email_marketing_opt_in" boolean DEFAULT false NOT NULL;