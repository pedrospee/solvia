import { randomUUID } from "node:crypto";
import { assertValidCategoryHierarchy, type Category, createCategory } from "@solvia/core";
import type { AppDatabase } from "../../infrastructure/database/client.ts";
import { ConflictError, NotFoundError } from "../errors.ts";
import { createTransactionRepository } from "../transactions/transaction-repository.ts";
import {
  type CategoryRecord,
  type CategoryRepository,
  createCategoryRepository,
} from "./category-repository.ts";

export type NewCategory = Omit<Category, "id">;

/** A field left out stays unchanged; `parentId: null` moves the category to the top level. */
export type CategoryChanges = Readonly<{ name?: string; parentId?: string | null }>;

export type CategoryService = ReturnType<typeof createCategoryService>;

/**
 * Category use cases. Every write validates the resulting tree with the core
 * (BR-70, BR-71). The lifecycle rules live here: a parent must exist and be
 * active, archiving never leaves an active child under an archived parent, and
 * nothing is deleted in cascade.
 */
export function createCategoryService(
  db: AppDatabase,
  options: { now?: () => Date; newId?: () => string } = {},
) {
  const repository = createCategoryRepository(db);
  const now = () => (options.now ?? (() => new Date()))().toISOString();
  const newId = options.newId ?? randomUUID;

  function load(id: string): CategoryRecord {
    const record = repository.findById(id);
    if (record === undefined) {
      throw new NotFoundError("CATEGORY_NOT_FOUND", `No category with id "${id}".`);
    }
    return record;
  }

  /** A new parent must exist and must not be archived. */
  function assertUsableParent(parentId: string | undefined): void {
    if (parentId !== undefined && load(parentId).archivedAt !== null) {
      throw new ConflictError(
        "CATEGORY_PARENT_ARCHIVED",
        `The parent category "${parentId}" is archived.`,
      );
    }
  }

  /** Validates the whole tree as it would be with `category` written (BR-70, BR-71). */
  function assertValidTreeWith(category: Category): void {
    const others = repository
      .list({ includeArchived: true })
      .map((record) => record.category)
      .filter(({ id }) => id !== category.id);
    assertValidCategoryHierarchy([...others, category]);
  }

  function children(id: string, categories: CategoryRepository = repository): CategoryRecord[] {
    return categories
      .list({ includeArchived: true })
      .filter(({ category }) => category.parentId === id);
  }

  function save(current: CategoryRecord, changes: Partial<CategoryRecord>): CategoryRecord {
    const record = { ...current, ...changes, updatedAt: now() };
    repository.update(record);
    return record;
  }

  return {
    list(options: { includeArchived: boolean }): CategoryRecord[] {
      return repository.list(options);
    },

    get: load,

    create(input: NewCategory): CategoryRecord {
      const category = createCategory({ ...input, id: newId() });
      assertUsableParent(category.parentId);
      assertValidTreeWith(category);
      const timestamp = now();
      const record = { category, archivedAt: null, createdAt: timestamp, updatedAt: timestamp };
      repository.insert(record);
      return record;
    },

    /** An update that changes nothing is a no-op: updatedAt marks the last effective change. */
    update(id: string, changes: CategoryChanges): CategoryRecord {
      const current = load(id);
      const category = createCategory(applyChanges(current.category, changes));
      if (sameEditableFields(category, current.category)) {
        return current;
      }
      if (category.parentId !== current.category.parentId) {
        assertUsableParent(category.parentId);
      }
      assertValidTreeWith(category);
      return save(current, { category });
    },

    /** Archiving an archived category changes nothing. */
    archive(id: string): CategoryRecord {
      const current = load(id);
      if (current.archivedAt !== null) {
        return current;
      }
      if (children(id).some(({ archivedAt }) => archivedAt === null)) {
        throw new ConflictError(
          "CATEGORY_HAS_ACTIVE_CHILDREN",
          "Archive the child categories before their parent.",
        );
      }
      return save(current, { archivedAt: now() });
    },

    unarchive(id: string): CategoryRecord {
      const current = load(id);
      if (current.archivedAt === null) {
        return current;
      }
      assertUsableParent(current.category.parentId);
      return save(current, { archivedAt: null });
    },

    /**
     * Deletes a category nothing depends on, checked and deleted in one database
     * transaction. Children take precedence over postings; postings of voided
     * transactions count, because they are kept (CATEGORY_IN_USE, ADR-0004 L9).
     */
    delete(id: string): void {
      db.transaction(
        (tx) => {
          const categories = createCategoryRepository(tx);
          if (categories.findById(id) === undefined) {
            throw new NotFoundError("CATEGORY_NOT_FOUND", `No category with id "${id}".`);
          }
          if (children(id, categories).length > 0) {
            throw new ConflictError(
              "CATEGORY_HAS_CHILDREN",
              "A category with child categories cannot be deleted.",
            );
          }
          if (createTransactionRepository(tx).isCategoryReferenced(id)) {
            throw new ConflictError(
              "CATEGORY_IN_USE",
              "The category has transactions, so it cannot be deleted; archive it instead.",
            );
          }
          categories.delete(id);
        },
        { behavior: "immediate" },
      );
    },
  };
}

function sameEditableFields(left: Category, right: Category): boolean {
  return left.name === right.name && left.parentId === right.parentId;
}

function applyChanges(category: Category, changes: CategoryChanges): Category {
  const { parentId, ...fixed } = category;
  const nextParentId = changes.parentId === undefined ? parentId : (changes.parentId ?? undefined);

  return {
    ...fixed,
    ...(changes.name === undefined ? {} : { name: changes.name }),
    ...(nextParentId === undefined ? {} : { parentId: nextParentId }),
  };
}
