import argon2 from 'argon2';

// argon2id with the library defaults (m=64 MiB, t=3, p=4), above the OWASP
// minimums. Parameters are embedded in the hash, so they can be raised later
// without invalidating existing passwords.
export function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, { type: argon2.argon2id });
}

export async function verifyPassword(
  hash: string,
  password: string,
): Promise<boolean> {
  try {
    return await argon2.verify(hash, password);
  } catch {
    // Malformed hash (e.g. legacy format): treat as a failed match.
    return false;
  }
}
