import { Prisma } from '@operaflow/db';

export function isUniqueViolation(err: unknown, field?: string): boolean {
  if (!(err instanceof Prisma.PrismaClientKnownRequestError) || err.code !== 'P2002') return false;
  if (!field) return true;
  const target = (err.meta?.target ?? []) as string[] | string;
  return (Array.isArray(target) ? target : [target]).some((t) => t.includes(field));
}

export type Tx = Prisma.TransactionClient;
