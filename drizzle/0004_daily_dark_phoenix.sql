ALTER TABLE "customers" ADD COLUMN "portal_token" text;--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "portal_token_created_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "invitations" ADD COLUMN "revoked_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "invitations_org_email_idx" ON "invitations" USING btree ("organization_id","email");--> statement-breakpoint
ALTER TABLE "customers" ADD CONSTRAINT "customers_portal_token_unique" UNIQUE("portal_token");