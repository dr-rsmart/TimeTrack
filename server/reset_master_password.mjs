/**
 * One-off script: reset the password for a master operator account to the
 * default password "Password123" and flag it for change on first login.
 *
 * Usage:
 *   node reset_master_password.mjs [email]
 *   (defaults to master@smartpatel.co.za)
 */
import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const email = (process.argv[2] || 'master@smartpatel.co.za').toLowerCase();
const DEFAULT_PASSWORD = 'Password123';

async function main() {
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    console.error(`No user found with email ${email}`);
    process.exit(1);
  }

  const passwordHash = await bcrypt.hash(DEFAULT_PASSWORD, 10);

  await prisma.user.update({
    where: { id: user.id },
    data: { passwordHash, mustChangePassword: true },
  });

  console.log('──────────────────────────────────────────────');
  console.log(`Password reset for: ${user.email} (role: ${user.role})`);
  console.log(`Temporary password: ${DEFAULT_PASSWORD}`);
  console.log('The user will be prompted to change it on first login.');
  console.log('──────────────────────────────────────────────');
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());