import { sqliteTable, text, integer, index, primaryKey } from 'drizzle-orm/sqlite-core';

/**
 * F33 control.db schema. Lives on trail-admin Fly app's volume at
 * /data/control.db (separate from any tenant's trail.db).
 *
 * Naming convention: tables that exist in BOTH schemas get the
 * `control_` prefix here (control_users, control_tenants, etc.) so a
 * future code-grep can tell which DB a query is hitting.
 */

export const organizations = sqliteTable('organizations', {
  id: text('id').primaryKey(),
  slug: text('slug').notNull().unique(),
  name: text('name').notNull(),
  createdAt: text('created_at')
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
});

export const controlUsers = sqliteTable(
  'control_users',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    email: text('email').notNull().unique(),
    name: text('name'),
    onboarded: integer('onboarded', { mode: 'boolean' }).notNull().default(false),
    createdAt: text('created_at')
      .notNull()
      .$defaultFn(() => new Date().toISOString()),
  },
  (t) => ({
    emailIdx: index('idx_control_users_email').on(t.email),
    orgIdx: index('idx_control_users_org').on(t.organizationId),
  }),
);

export const controlTenants = sqliteTable(
  'control_tenants',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    slug: text('slug').notNull().unique(),
    name: text('name').notNull(),
    language: text('language').notNull().default('da'),
    createdAt: text('created_at')
      .notNull()
      .$defaultFn(() => new Date().toISOString()),
  },
  (t) => ({
    orgIdx: index('idx_control_tenants_org').on(t.organizationId),
  }),
);

export const tenantEngines = sqliteTable(
  'tenant_engines',
  {
    tenantId: text('tenant_id')
      .primaryKey()
      .references(() => controlTenants.id, { onDelete: 'cascade' }),
    engineId: text('engine_id').notNull(),
    engineUrl: text('engine_url').notNull(),
    engineInternalUrl: text('engine_internal_url'),
    provisionedAt: text('provisioned_at').notNull(),
    retiredAt: text('retired_at'),
    notes: text('notes'),
    /** Bearer key admin-server forwards as Authorization when proxying
     *  /api/v1/* to this engine. Set at provisioning time; migration
     *  back-fills from legacy TRAIL_ADMIN_PROXY_BEARER_<SLUG> env-vars. */
    bearer: text('bearer'),
  },
  (t) => ({
    engineIdx: index('idx_tenant_engines_engine').on(t.engineId, t.retiredAt),
  }),
);

export const controlApiKeys = sqliteTable(
  'control_api_keys',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => controlTenants.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => controlUsers.id, { onDelete: 'cascade' }),
    prefix: text('prefix').notNull(),
    keyHash: text('key_hash').notNull().unique(),
    scope: text('scope').notNull(),
    name: text('name'),
    createdAt: text('created_at')
      .notNull()
      .$defaultFn(() => new Date().toISOString()),
    revokedAt: text('revoked_at'),
    lastUsedAt: text('last_used_at'),
  },
  (t) => ({
    tenantIdx: index('idx_control_api_keys_tenant').on(t.tenantId, t.revokedAt),
  }),
);

export const invitations = sqliteTable(
  'invitations',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    email: text('email').notNull(),
    /** Forward-compat metadata — NOT enforced yet (no RBAC layer; F187 §Q3).
     *  One of VALID_ROLES in invite.ts: owner | admin | member | service. */
    role: text('role').notNull().default('member'),
    invitedByUserId: text('invited_by_user_id')
      .notNull()
      .references(() => controlUsers.id, { onDelete: 'cascade' }),
    /** pending | accepted | revoked | expired */
    status: text('status').notNull().default('pending'),
    createdAt: text('created_at')
      .notNull()
      .$defaultFn(() => new Date().toISOString()),
    expiresAt: text('expires_at').notNull(),
    acceptedAt: text('accepted_at'),
    acceptedUserId: text('accepted_user_id').references(() => controlUsers.id, {
      onDelete: 'set null',
    }),
  },
  (t) => ({
    orgIdx: index('idx_invitations_org').on(t.organizationId, t.status),
    emailIdx: index('idx_invitations_email').on(t.email),
  }),
);

/**
 * F187.4 — per-tenant membership roles. The first real RBAC primitive in
 * control.db; revisits F187's deferred "no role column" non-goal. role is
 * display + data today (NOT enforced as permissions yet). Seeded for every
 * existing user×org-tenant pair (default `member`); cb@webhouse.dk is forced
 * to `owner` on every boot (UFRAVIGELIG: repo-owner is always owner).
 */
export const controlMemberships = sqliteTable(
  'control_memberships',
  {
    userId: text('user_id')
      .notNull()
      .references(() => controlUsers.id, { onDelete: 'cascade' }),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => controlTenants.id, { onDelete: 'cascade' }),
    /** owner | admin | member — reuses VALID_ROLES from invite.ts. */
    role: text('role').notNull().default('member'),
    createdAt: text('created_at')
      .notNull()
      .$defaultFn(() => new Date().toISOString()),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.userId, t.tenantId] }),
    tenantIdx: index('idx_control_memberships_tenant').on(t.tenantId),
  }),
);

export const magicLinks = sqliteTable(
  'magic_links',
  {
    token: text('token').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => controlUsers.id, { onDelete: 'cascade' }),
    intent: text('intent').notNull().default('login'),
    expiresAt: text('expires_at').notNull(),
    usedAt: text('used_at'),
    createdAt: text('created_at')
      .notNull()
      .$defaultFn(() => new Date().toISOString()),
  },
  (t) => ({
    userIdx: index('idx_magic_links_user').on(t.userId),
  }),
);

export const sessions = sqliteTable(
  'sessions',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => controlUsers.id, { onDelete: 'cascade' }),
    expiresAt: text('expires_at').notNull(),
    createdAt: text('created_at')
      .notNull()
      .$defaultFn(() => new Date().toISOString()),
    lastSeenAt: text('last_seen_at'),
    userAgent: text('user_agent'),
  },
  (t) => ({
    userIdx: index('idx_sessions_user').on(t.userId, t.expiresAt),
  }),
);
