// Generates a password + scrypt hash for one or more supplier logins, for
// pasting into SUPPLIER_ACCOUNTS in src/lib/gate.ts. Supplier accounts are
// for people outside the company, so only the hash is ever committed — the
// plaintext printed here is handed to the supplier once and not kept in the
// repo. Also how to rotate a single supplier's password: rerun for that
// username and replace its salt/hash.
//
//   node scripts/hash-gate-password.mjs domas sjim
//   node scripts/hash-gate-password.mjs domas --password 'chosen-password'
import { randomBytes, randomInt, scryptSync } from "node:crypto";

// No 0/O/1/l/I — these get read aloud or retyped from a chat message.
const CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789@#%+=";

function generatePassword(length = 15) {
  let out = "";
  for (let i = 0; i < length; i++) out += CHARS[randomInt(CHARS.length)];
  return out;
}

const args = process.argv.slice(2);
const pwIdx = args.indexOf("--password");
const fixedPassword = pwIdx >= 0 ? args[pwIdx + 1] : undefined;
const users = pwIdx >= 0 ? [...args.slice(0, pwIdx), ...args.slice(pwIdx + 2)] : args;

if (users.length === 0) {
  console.error("usage: node scripts/hash-gate-password.mjs <username>... [--password <pw>]");
  process.exit(1);
}

for (const user of users) {
  const password = fixedPassword ?? generatePassword();
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, Buffer.from(salt, "hex"), 32).toString("hex");
  console.log(`${user}\t${password}`);
  console.log(`  salt: "${salt}",\n  hash: "${hash}",`);
}
