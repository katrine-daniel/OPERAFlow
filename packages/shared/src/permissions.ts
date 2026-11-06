/**
 * Role-based access control matrix. This is the single source of truth used by
 * the API (enforced server-side) and the web app (only to hide UI it cannot use).
 */
export const ROLES = ['ADMIN', 'OPS_MANAGER', 'OPS_STAFF', 'QA'] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_LABELS: Record<Role, string> = {
  ADMIN: 'Administrator',
  OPS_MANAGER: 'Operations Manager',
  OPS_STAFF: 'Operations Staff',
  QA: 'QA Engineer',
};

export const PERMISSIONS = [
  'dashboard:read',
  'users:read',
  'users:manage',
  'audit:read',
  'bookings:read',
  'bookings:write',
  'bookings:import',
  'bookings:reconcile',
  'bookings:view-pii',
  'suppliers:read',
  'suppliers:manage',
  'followups:read',
  'followups:manage',
  'followups:approve-autosend',
  'reports:read',
  'reports:manage',
  'reports:approve-recipients',
  'tests:read',
  'tests:run',
  'tests:manage',
  'integrations:read',
  'integrations:manage',
  'settings:manage',
] as const;
export type Permission = (typeof PERMISSIONS)[number];

const ALL: readonly Permission[] = PERMISSIONS;

export const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  ADMIN: ALL,
  OPS_MANAGER: [
    'dashboard:read',
    'users:read',
    'audit:read',
    'bookings:read',
    'bookings:write',
    'bookings:import',
    'bookings:reconcile',
    'bookings:view-pii',
    'suppliers:read',
    'suppliers:manage',
    'followups:read',
    'followups:manage',
    'reports:read',
    'reports:manage',
    'tests:read',
    'integrations:read',
  ],
  OPS_STAFF: [
    'dashboard:read',
    'bookings:read',
    'bookings:write',
    'bookings:view-pii',
    'suppliers:read',
    'followups:read',
    'followups:manage',
    'reports:read',
  ],
  QA: ['dashboard:read', 'tests:read', 'tests:run', 'tests:manage', 'integrations:read'],
};

export function hasPermission(role: Role, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].includes(permission);
}

export function hasAllPermissions(role: Role, permissions: readonly Permission[]): boolean {
  return permissions.every((p) => hasPermission(role, p));
}
