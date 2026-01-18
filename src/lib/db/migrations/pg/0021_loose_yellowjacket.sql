CREATE TABLE "vector_index" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"qdrant_point_id" uuid NOT NULL,
	"collection_name" varchar(50) NOT NULL,
	"entity_type" varchar NOT NULL,
	"entity_id" text NOT NULL,
	"user_id" uuid,
	"metadata" json,
	"created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
	CONSTRAINT "vector_index_qdrant_point_id_unique" UNIQUE("qdrant_point_id")
);
--> statement-breakpoint
ALTER TABLE "vector_index" ADD CONSTRAINT "vector_index_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "vector_index_qdrant_point_idx" ON "vector_index" USING btree ("qdrant_point_id");--> statement-breakpoint
CREATE INDEX "vector_index_entity_idx" ON "vector_index" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "vector_index_user_idx" ON "vector_index" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "vector_index_collection_idx" ON "vector_index" USING btree ("collection_name");