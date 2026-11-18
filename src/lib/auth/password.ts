import "server-only";
import { hash, verify } from "@node-rs/argon2";

// argon2id, OWASP-recommended minimum (19 MiB, 2 passes, 1 lane). Prebuilt
// binaries: no native compilation in the Docker build.
const OPTS = { memoryCost: 19456, timeCost: 2, parallelism: 1 } as const;

export const MIN_PASSWORD_LENGTH = 10;

export function hashPassword(password: string) {
  return hash(password, OPTS);
}

// Verified against when the email doesn't exist, so response time doesn't
// reveal which emails have accounts.
let dummyHash: Promise<string> | null = null;

export async function verifyPassword(passwordHash: string | null, password: string): Promise<boolean> {
  if (!passwordHash) {
    dummyHash ??= hash("not-a-real-password", OPTS);
    await verify(await dummyHash, password).catch(() => false);
    return false;
  }
  return verify(passwordHash, password).catch(() => false);
}

export function passwordProblem(password: string): string | null {
  if (password.length < MIN_PASSWORD_LENGTH) return `Use at least ${MIN_PASSWORD_LENGTH} characters.`;
  if (password.length > 200) return "That password is too long.";
  return null;
}
