/**
 * One-off data update: ensure the company formerly "Acme Holdings (Pty) Ltd"
 * (now "TimeTrack (Pty) Ltd") has admin Diana Prince <admin@timetrack.com>.
 *
 * The company was already renamed in a previous run. This run:
 *  1. Finds the company "TimeTrack (Pty) Ltd"
 *  2. Creates or updates the admin user Diana Prince <admin@timetrack.com>
 *  3. Links the user as company owner if not already linked
 *  4. Ensures a matching Employee record exists (firstName, surname, email)
 *
 * Usage: node update_acme_company.mjs
 */

import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

const COMPANY_NAME = 'TimeTrack (Pty) Ltd';
const NEW_ADMIN_FIRST_NAME = 'Diana';
const NEW_ADMIN_SURNAME = 'Prince';
const NEW_ADMIN_EMAIL = 'admin@timetrack.com';
const DEFAULT_PASSWORD = 'Password123';

async function main() {
  // 1. Find the company (by new name, fallback to Acme in case rename didn't persist)
  let company = await prisma.companyProfile.findFirst({
    where: { name: COMPANY_NAME },
    include: { owner: true },
  });
  if (!company) {
    company = await prisma.companyProfile.findFirst({
      where: { name: { contains: 'Acme', mode: 'insensitive' } },
      include: { owner: true },
    });
  }

  if (!company) {
    console.log('Company not found. Listing all companies:');
    const all = await prisma.companyProfile.findMany({ select: { id: true, name: true } });
    console.table(all);
    return;
  }

  console.log(`Found company: "${company.name}" (id: ${company.id})`);
  console.log(`Current owner: ${company.owner ? `${company.owner.fullName} <${company.owner.email}>` : 'none'}`);

  const fullName = `${NEW_ADMIN_FIRST_NAME} ${NEW_ADMIN_SURNAME}`;

  await prisma.$transaction(async (tx) => {
    // 2. Ensure company name is correct
    if (company.name !== COMPANY_NAME) {
      await tx.companyProfile.update({
        where: { id: company.id },
        data: { name: COMPANY_NAME },
      });
      console.log(`Renamed company to "${COMPANY_NAME}"`);
    }

    // 3. Create or update the admin user
    let adminUser = await tx.user.findUnique({ where: { email: NEW_ADMIN_EMAIL } });
    if (adminUser) {
      adminUser = await tx.user.update({
        where: { id: adminUser.id },
        data: {
          fullName,
          role: 'admin',
          companyProfileId: company.id,
        },
      });
      console.log(`Updated existing user <${NEW_ADMIN_EMAIL}> -> ${fullName}`);
    } else {
      const passwordHash = await bcrypt.hash(DEFAULT_PASSWORD, 10);
      adminUser = await tx.user.create({
        data: {
          email: NEW_ADMIN_EMAIL,
          fullName,
          role: 'admin',
          passwordHash,
          mustChangePassword: true,
          companyProfileId: company.id,
        },
      });
      console.log(`Created admin user ${fullName} <${NEW_ADMIN_EMAIL}> (temp password: ${DEFAULT_PASSWORD})`);
    }

    // 4. Link as owner if not already
    if (company.ownerUserId !== adminUser.id) {
      await tx.companyProfile.update({
        where: { id: company.id },
        data: { ownerUserId: adminUser.id, primaryContactName: fullName },
      });
      console.log('Linked admin user as company owner.');
    }

    // 5. Ensure employee record exists for the admin
    let emp = await tx.employee.findFirst({
      where: { email: NEW_ADMIN_EMAIL, companyProfileId: company.id },
    });
    if (emp) {
      await tx.employee.update({
        where: { id: emp.id },
        data: { firstName: NEW_ADMIN_FIRST_NAME, surname: NEW_ADMIN_SURNAME, role: 'admin' },
      });
      console.log(`Updated employee record for <${NEW_ADMIN_EMAIL}>`);
    } else {
      await tx.employee.create({
        data: {
          firstName: NEW_ADMIN_FIRST_NAME,
          surname: NEW_ADMIN_SURNAME,
          email: NEW_ADMIN_EMAIL,
          role: 'admin',
          status: 'active',
          position: 'Administrator',
          companyProfileId: company.id,
        },
      });
      console.log(`Created employee record for ${fullName} <${NEW_ADMIN_EMAIL}>`);
    }
  });

  // 6. Verify
  const updated = await prisma.companyProfile.findUnique({
    where: { id: company.id },
    include: { owner: true },
  });
  console.log('\n✅ Update complete:');
  console.log(`   Company: "${updated.name}"`);
  console.log(`   Admin:   ${updated.owner ? `${updated.owner.fullName} <${updated.owner.email}>` : 'NOT LINKED'}`);
}

main()
  .catch((err) => {
    console.error('Update failed:', err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());