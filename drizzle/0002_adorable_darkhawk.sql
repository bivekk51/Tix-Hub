CREATE INDEX "tickets_user_id_idx" ON "tickets" USING btree ("user_id");--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_available_tickets_check" CHECK ("events"."available_tickets" >= 0);--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_total_tickets_check" CHECK ("events"."total_tickets" >= 1);--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_price_check" CHECK ("events"."price" >= 0);--> statement-breakpoint
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_quantity_check" CHECK ("tickets"."quantity" >= 1);