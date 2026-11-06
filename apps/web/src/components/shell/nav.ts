import type { Permission } from '@operaflow/shared';

export interface NavItem {
  href: string;
  label: string;
  permission: Permission;
  /** Phase in which the module is delivered; undefined = available now. */
  phase?: number;
}

export const NAV_SECTIONS: { title: string; items: NavItem[] }[] = [
  {
    title: 'Operations',
    items: [
      { href: '/', label: 'Dashboard', permission: 'dashboard:read' },
      { href: '/bookings', label: 'Booking registry', permission: 'bookings:read' },
      { href: '/reconciliation', label: 'Reconciliation', permission: 'bookings:read' },
      { href: '/imports', label: 'Imports', permission: 'bookings:import' },
      { href: '/follow-ups', label: 'Supplier follow-ups', permission: 'followups:read', phase: 4 },
      { href: '/reports', label: 'Daily reports', permission: 'reports:read', phase: 3 },
    ],
  },
  {
    title: 'Quality',
    items: [{ href: '/testing', label: 'Booking-site tests', permission: 'tests:read', phase: 5 }],
  },
  {
    title: 'Directory',
    items: [
      { href: '/suppliers', label: 'Suppliers', permission: 'suppliers:read' },
      { href: '/hotels', label: 'Hotels', permission: 'bookings:read' },
      { href: '/sources', label: 'Booking sources', permission: 'bookings:read' },
      { href: '/integrations', label: 'Integrations', permission: 'integrations:read', phase: 4 },
    ],
  },
  {
    title: 'Administration',
    items: [
      { href: '/users', label: 'Users & roles', permission: 'users:read' },
      { href: '/audit', label: 'Audit log', permission: 'audit:read' },
    ],
  },
];
