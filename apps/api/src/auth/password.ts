import { hash, verify } from '@node-rs/argon2';

// Argon2id with OWASP-recommended baseline parameters.
const OPTIONS = { algorithm: 2, memoryCost: 19456, timeCost: 2, parallelism: 1 } as const;

export function hashPassword(password: string): Promise<string> {
  return hash(password, OPTIONS);
}

export async function verifyPassword(passwordHash: string, password: string): Promise<boolean> {
  try {
    return await verify(passwordHash, password);
  } catch {
    return false;
  }
}

let dummyHash: Promise<string> | undefined;
/** Used to keep timing similar whether or not the account exists. */
export function dummyVerify(password: string): Promise<boolean> {
  dummyHash ??= hashPassword('operaflow-timing-equaliser');
  return dummyHash.then((h) => verifyPassword(h, password));
}
