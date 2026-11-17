import assert from "node:assert/strict";
import { test } from "node:test";
import pino from "pino";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createMediaService, MediaConflictError, MediaDeletionError } from "./media-service.js";
import type { CloudinaryMediaClient } from "./cloudinary-service.js";

const mediaId = "1b7b2848-94d1-4482-bfe8-06f3a5f94f1f";
const mediaRow = {
  id: mediaId,
  media_type: "image",
  cloudinary_asset_id: "cloud-asset-id",
  cloudinary_public_id: "media/photo",
  original_filename: "photo.jpg",
  media_url: "https://media.example/photo.jpg",
  alt_text: null,
  poster_media_library_id: null,
  created_at: "2026-01-01T00:00:00.000Z",
  deleted_at: null,
  cleanup_pending_assets: [],
};

interface DeleteTestState {
  assigned: boolean;
  cloudinaryFailure: boolean;
  databaseFailure: boolean;
  events: string[];
}

class DeleteQuery implements PromiseLike<{ data: unknown; error: unknown }> {
  private operation: "select" | "delete" | "insert" = "select";
  private selection = "";
  private filters: Record<string, unknown> = {};

  constructor(private readonly table: string, private readonly state: DeleteTestState) {}

  select(selection: string): this {
    this.selection = selection;
    return this;
  }

  eq(column: string, value: unknown): this {
    this.filters[column] = value;
    return this;
  }

  or(_filter: string): this { return this; }
  limit(_count: number): this { return this; }

  delete(): this {
    this.operation = "delete";
    return this;
  }

  insert(_values: unknown): this {
    this.operation = "insert";
    return this;
  }

  maybeSingle(): Promise<{ data: unknown; error: unknown }> {
    return Promise.resolve(this.resolve());
  }

  then<TResult1 = { data: unknown; error: unknown }, TResult2 = never>(
    onfulfilled?: ((value: { data: unknown; error: unknown }) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    return Promise.resolve(this.resolve()).then(onfulfilled, onrejected);
  }

  private resolve(): { data: unknown; error: unknown } {
    if (this.table === "product_media") {
      return { data: this.state.assigned ? [{ id: "assignment" }] : [], error: null };
    }
    if (this.table === "homepage_content") return { data: [], error: null };
    if (this.table === "admin_audit_logs") return { data: [], error: null };
    if (this.table !== "media_library") return { data: [], error: null };

    if (this.operation === "delete") {
      this.state.events.push("database-delete");
      if (this.state.databaseFailure) {
        return { data: null, error: new Error("database delete failed") };
      }
      return { data: { id: mediaId }, error: null };
    }
    if (this.filters.poster_media_library_id) return { data: [], error: null };
    if (this.filters.id === mediaId) return { data: mediaRow, error: null };
    return { data: [], error: null };
  }
}

function createService(state: DeleteTestState) {
  const supabase = {
    from: (table: string) => new DeleteQuery(table, state),
  } as unknown as SupabaseClient;
  const cloudinary = {
    configured: true,
    imageMaxBytes: 15_000_000,
    videoMaxBytes: 90_000_000,
    upload: async () => { throw new Error("not used"); },
    delete: async () => {
      state.events.push("cloudinary-delete");
      if (state.cloudinaryFailure) throw new Error("Cloudinary unavailable");
    },
    deleteByAssetId: async () => {
      state.events.push("cloudinary-delete-by-id");
      if (state.cloudinaryFailure) throw new Error("Cloudinary unavailable");
    },
    deliveryUrl: () => "",
  } as CloudinaryMediaClient;
  return createMediaService(supabase, cloudinary, pino({ enabled: false }));
}

function makeState(overrides: Partial<DeleteTestState> = {}): DeleteTestState {
  return {
    assigned: false,
    cloudinaryFailure: false,
    databaseFailure: false,
    events: [],
    ...overrides,
  };
}

test("permanent deletion removes Cloudinary asset before deleting the media record", async () => {
  const state = makeState();
  const result = await createService(state).deleteLibraryMedia("owner-id", mediaId);

  assert.deepEqual(result, { deleted: true });
  assert.deepEqual(state.events, ["cloudinary-delete", "database-delete"]);
});

test("Cloudinary deletion failure preserves the database record and surfaces an error", async () => {
  const state = makeState({ cloudinaryFailure: true });

  await assert.rejects(
    createService(state).deleteLibraryMedia("owner-id", mediaId),
    (error: unknown) => error instanceof MediaDeletionError && error.status === 502,
  );
  assert.deepEqual(state.events, ["cloudinary-delete"]);
});

test("assigned media cannot be deleted from the library", async () => {
  const state = makeState({ assigned: true });

  await assert.rejects(
    createService(state).deleteLibraryMedia("owner-id", mediaId),
    (error: unknown) => error instanceof MediaConflictError,
  );
  assert.deepEqual(state.events, []);
});
