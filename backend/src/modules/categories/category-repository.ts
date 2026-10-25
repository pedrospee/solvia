import type { Category } from "@solvia/core";
import { asc, eq, isNull } from "drizzle-orm";
import type { DbExecutor } from "../../infrastructure/database/client.ts";
import { categories } from "../../infrastructure/database/schema/categories.ts";

/** A category as persisted: the core Category plus its lifecycle timestamps. */
export type CategoryRecord = Readonly<{
  category: Category;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
}>;

type CategoryRow = typeof categories.$inferSelect;

export type CategoryRepository = ReturnType<typeof createCategoryRepository>;

export function createCategoryRepository(db: DbExecutor) {
  return {
    insert(record: CategoryRecord): void {
      db.insert(categories).values(toRow(record)).run();
    },

    findById(id: string): CategoryRecord | undefined {
      const row = db.select().from(categories).where(eq(categories.id, id)).get();
      return row === undefined ? undefined : fromRow(row);
    },

    list(options: { includeArchived: boolean }): CategoryRecord[] {
      return db
        .select()
        .from(categories)
        .where(options.includeArchived ? undefined : isNull(categories.archivedAt))
        .orderBy(asc(categories.createdAt), asc(categories.id))
        .all()
        .map(fromRow);
    },

    /** Writes the mutable fields only: nature and createdAt never change. */
    update(record: CategoryRecord): void {
      const { name, parentId, archivedAt, updatedAt } = toRow(record);
      db.update(categories)
        .set({ name, parentId, archivedAt, updatedAt })
        .where(eq(categories.id, record.category.id))
        .run();
    },

    delete(id: string): void {
      db.delete(categories).where(eq(categories.id, id)).run();
    },
  };
}

function toRow({ category, archivedAt, createdAt, updatedAt }: CategoryRecord): CategoryRow {
  return {
    id: category.id,
    name: category.name,
    nature: category.nature,
    parentId: category.parentId ?? null,
    archivedAt,
    createdAt,
    updatedAt,
  };
}

function fromRow(row: CategoryRow): CategoryRecord {
  const category: Category = {
    id: row.id,
    name: row.name,
    nature: row.nature,
    ...(row.parentId === null ? {} : { parentId: row.parentId }),
  };
  return {
    category,
    archivedAt: row.archivedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
