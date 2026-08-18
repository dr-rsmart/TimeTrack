/**
 * TimeTrack — Stress Test Database Seeding Strategy
 * ==================================================
 * Generates synthetic workforce data for k6 load/stress testing phases:
 *
 *   Phase A — Baseline:  1,000 VUs → 1 worker  → seeds 1,000 employees
 *   Phase B — Stress:    3,000 VUs → 1 worker  → seeds 3,000 employees
 *   Phase C — Peak:      5,000 VUs → 2 workers → seeds 5,000 employees
 *
 * Usage:
 *   npx tsx src/seed-stress.ts --phase A   (1,000 employees)
 *   npx tsx src/seed-stress.ts --phase B   (3,000 employees)
 *   npx tsx src/seed-stress.ts --phase C   (5,000 employees)
 *   npx tsx src/seed-stress.ts --count 500 (custom count)
 *
 * All stress accounts use password: "Password123"
 * Tenant: Stress Test Corp (isolated from demo data)
 */

import 'dotenv/config';
import bcrypt from 'bcryptjs';
import prisma from './prisma.js';

// ── Phase Configuration ──
const PHASE_CONFIG: Record<string, { employees: number; label: string }> = {
  A: { employees: 1000, label: 'Phase A — Baseline (1,000 VUs / 1 worker)' },
  B: { employees: 3000, label: 'Phase B — Stress (3,000 VUs / 1 worker)' },
  C: { employees: 5000, label: 'Phase C — Peak (5,000 VUs / 2 workers)' },
};

const FIRST_NAMES = [
  'Sipho', 'Thabo', 'Naledi', 'Ayesha', 'Riaan', 'Pieter', 'Lerato', 'Zanele',
  'Mandla', 'Nomsa', 'Johan', 'Fatima', 'David', 'Sarah', 'Michael', 'Grace',
  'Daniel', 'Precious', 'Kagiso', 'Tebogo', 'Nandi', 'Sibusiso', 'Lindiwe', 'Themba',
];
const SURNAMES = [
  'Ndlovu', 'Mokoena', 'Khumalo', 'Pillay', 'Botha', 'van der Merwe', 'Dlamini',
  'Nkosi', 'Zulu', 'Mthembu', 'Smith', 'Naidoo', 'Govender', 'Moodley', 'Chetty',
  'Pretorius', 'du Toit', 'Venter', 'Kruger', 'Mahlangu', 'Sithole', 'Mnguni',
];
const BRANCHES = ['Sandton HQ', 'Cape Town', 'Durban', 'Pretoria', 'Bloemfontein'];
const DEPARTMENTS = ['Operations', 'Finance', 'Sales', 'Support', 'Engineering', 'HR', 'Logistics'];
const POSITIONS = ['Clerk', 'Analyst', 'Coordinator', 'Specialist', 'Technician', 'Supervisor', 'Associate'];

function toDateStr(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function daysAgo(n: number): Date {
  const d = new Date();
  d.setDate(d.getDate() - n);
  d.setHours(0, 0, 0, 0);
  return d;
}

function randomFrom<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

async function main() {
  // Parse CLI args
  const args = process.argv.slice(2);
  let phase = 'A';
  let customCount = 0;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--phase' && args[i + 1]) phase = args[i + 1].toUpperCase();
    if (args[i] === '--count' && args[i + 1]) customCount = parseInt(args[i + 1], 10);
  }

  const config = PHASE_CONFIG[phase] || PHASE_CONFIG.A;
  const employeeCount = customCount > 0 ? customCount : config.employees;
  const label = customCount > 0 ? `Custom (${customCount} employees)` : config.label;

  console.log(`[seed-stress] ${label}`);
  console.log(`[seed-stress] Target: ${employeeCount} employees + users + shifts + time entries`);
  console.log('');

  const PASSWORD_HASH = bcrypt.hashSync('Password123', 10);
  const STRESS_TENANT_EMAIL = 'stress@timetrack.com';

  // ── Clean existing stress data only (preserve demo data) ──
  console.log('[seed-stress] Cleaning previous stress test data...');
  const stressCompany = await prisma.companyProfile.findFirst({
    where: { name: 'Stress Test Corp' },
  });

  if (stressCompany) {
    await prisma.auditLog.deleteMany({ where: { companyProfileId: stressCompany.id } });
    await prisma.employmentHistory.deleteMany({
      where: { employee: { companyProfileId: stressCompany.id } },
    });
    await prisma.timeEntry.deleteMany({ where: { companyProfileId: stressCompany.id } });
    await prisma.shift.deleteMany({ where: { companyProfileId: stressCompany.id } });
    await prisma.companySettings.deleteMany({ where: { companyProfileId: stressCompany.id } });
    await prisma.employee.deleteMany({ where: { companyProfileId: stressCompany.id } });
    await prisma.geofence.deleteMany({ where: { companyProfileId: stressCompany.id } });
    await prisma.user.deleteMany({ where: { companyProfileId: stressCompany.id } });
    await prisma.companyProfile.delete({ where: { id: stressCompany.id } });
    console.log('[seed-stress] Previous stress data removed.');
  }

  // ── Create stress tenant ──
  const company = await prisma.companyProfile.create({
    data: {
      name: 'Stress Test Corp',
      phone: '+27 11 000 0000',
      address: '1 Stress Lane, Load City',
      vatNumber: 'ZA0000000000',
      registrationNumber: '2026/000000/07',
      billingTier: 'enterprise',
      primaryContactName: 'Load Tester',
    },
  });
  console.log(`[seed-stress] Tenant created: ${company.name} (${company.id})`);

  // ── Admin user for stress tenant ──
  const adminUser = await prisma.user.create({
    data: {
      email: STRESS_TENANT_EMAIL,
      fullName: 'Stress Admin',
      role: 'admin',
      passwordHash: PASSWORD_HASH,
      companyProfileId: company.id,
    },
  });

  // ── Geofence ──
  const geofence = await prisma.geofence.create({
    data: {
      name: 'Stress HQ',
      address: '1 Stress Lane, Load City',
      latitude: -26.2041,
      longitude: 28.0473,
      radiusMeters: 500,
      companyProfileId: company.id,
    },
  });

  // ── Company Settings ──
  await prisma.companySettings.create({
    data: {
      companyProfileId: company.id,
      ordinaryHoursPerDay: 8,
      overtimeThresholdHours: 8,
      workDays: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'],
      useMonthlyOvertimeThreshold: false,
      monthlyOvertimeThresholdHours: 195,
      sundayOvertimeEnabled: true,
      sundayOvertimeMultiplier: 1.5,
      publicHolidayOvertimeEnabled: true,
      publicHolidayOvertimeMultiplier: 2.0,
      publicHolidays: [],
    },
  });

  // ── Batch create employees + users ──
  console.log(`[seed-stress] Creating ${employeeCount} employees...`);
  const BATCH_SIZE = 500;
  const employeeIds: string[] = [];
  const employeeEmails: string[] = [];

  for (let batch = 0; batch < employeeCount; batch += BATCH_SIZE) {
    const batchSize = Math.min(BATCH_SIZE, employeeCount - batch);
    const empData: Array<{
      firstName: string; surname: string; email: string; position: string;
      role: 'employee' | 'manager'; branch: string; department: string;
      employeeNumber: string; hireDate: Date; phone: string;
      employmentType: string; jurisdiction: string; salaryInfo: object;
      companyProfileId: string; createdBy: string; updatedBy: string;
      geofenceId: string;
    }> = [];

    for (let i = 0; i < batchSize; i++) {
      const idx = batch + i;
      const email = `stress.user${idx}@timetrack.com`;
      const isManager = idx % 50 === 0; // 1 manager per 50 employees
      empData.push({
        firstName: randomFrom(FIRST_NAMES),
        surname: randomFrom(SURNAMES),
        email,
        position: isManager ? 'Branch Manager' : randomFrom(POSITIONS),
        role: isManager ? 'manager' : 'employee',
        branch: randomFrom(BRANCHES),
        department: randomFrom(DEPARTMENTS),
        employeeNumber: `STRESS-${String(idx + 1).padStart(5, '0')}`,
        hireDate: daysAgo(100 + Math.floor(Math.random() * 800)),
        phone: `+27 82 ${String(100 + Math.floor(Math.random() * 899))} ${String(1000 + Math.floor(Math.random() * 8999))}`,
        employmentType: 'permanent',
        jurisdiction: 'ZA',
        salaryInfo: { base: 20000 + Math.floor(Math.random() * 40000), currency: 'ZAR' },
        companyProfileId: company.id,
        createdBy: adminUser.id,
        updatedBy: adminUser.id,
        geofenceId: geofence.id,
      });
      employeeEmails.push(email);
    }

    const created = await prisma.employee.createMany({ data: empData, skipDuplicates: true });
    console.log(`[seed-stress]   Batch ${Math.floor(batch / BATCH_SIZE) + 1}: ${created.count} employees created`);
  }

  // Fetch created employee IDs for shift/entry generation
  const employees = await prisma.employee.findMany({
    where: { companyProfileId: company.id },
    select: { id: true, email: true, firstName: true, surname: true, branch: true, department: true },
  });
  console.log(`[seed-stress] Total employees in DB: ${employees.length}`);

  // ── Create User accounts for all employees ──
  console.log(`[seed-stress] Creating ${employees.length} user accounts...`);
  for (let batch = 0; batch < employees.length; batch += BATCH_SIZE) {
    const slice = employees.slice(batch, batch + BATCH_SIZE);
    await prisma.user.createMany({
      data: slice.map((emp) => ({
        email: emp.email,
        fullName: `${emp.firstName} ${emp.surname}`,
        role: 'employee' as const,
        passwordHash: PASSWORD_HASH,
        mustChangePassword: false, // Allow immediate login for stress tests
        companyProfileId: company.id,
      })),
      skipDuplicates: true,
    });
  }
  console.log(`[seed-stress] User accounts created.`);

  // ── Generate shifts (last 7 days) ──
  console.log('[seed-stress] Generating shifts (7 days)...');
  let shiftCount = 0;
  const SHIFT_BATCH = 1000;
  let shiftBatch: Array<{
    date: Date; startTime: string; endTime: string;
    status: 'scheduled' | 'active' | 'completed' | 'cancelled' | 'no_show';
    shiftType: 'full_day' | 'half_day' | 'Leave' | 'Sick' | 'PTO';
    employeeId: string; branch: string; department: string;
    employeeEmail: string; employeeName: string; location: string;
    companyProfileId: string; createdBy: string; updatedBy: string;
  }> = [];

  for (let dayOffset = 7; dayOffset >= 0; dayOffset--) {
    const date = daysAgo(dayOffset);
    const dow = date.getDay();
    if (dow === 6) continue; // Skip Saturdays

    for (const emp of employees) {
      if (Math.random() < 0.05) continue; // 5% absence rate
      const isPast = dayOffset > 0;
      const status: 'scheduled' | 'active' | 'completed' | 'cancelled' | 'no_show' = isPast
        ? (Math.random() < 0.9 ? 'completed' : 'no_show')
        : (dayOffset === 0 ? 'active' : 'scheduled');

      shiftBatch.push({
        date,
        startTime: '08:00',
        endTime: '17:00',
        status,
        shiftType: 'full_day',
        employeeId: emp.id,
        branch: emp.branch,
        department: emp.department,
        employeeEmail: emp.email,
        employeeName: `${emp.firstName} ${emp.surname}`,
        location: emp.branch,
        companyProfileId: company.id,
        createdBy: adminUser.id,
        updatedBy: adminUser.id,
      });
      shiftCount++;

      if (shiftBatch.length >= SHIFT_BATCH) {
        await prisma.shift.createMany({ data: shiftBatch as never[], skipDuplicates: true });
        shiftBatch = [];
      }
    }
  }
  if (shiftBatch.length > 0) {
    await prisma.shift.createMany({ data: shiftBatch as never[], skipDuplicates: true });
  }
  console.log(`[seed-stress] Created ${shiftCount} shifts`);

  // ── Generate time entries (last 7 days) ──
  console.log('[seed-stress] Generating time entries (7 days)...');
  let entryCount = 0;
  let entryBatch: Array<{
    employeeId: string; employeeEmail: string; employeeName: string;
    branch: string; department: string; clockIn: Date; clockOut: Date;
    date: Date; totalHours: number; status: string; breakMinutes: number;
    geofenceName: string; isAutoGeofence: boolean; companyProfileId: string;
    createdBy: string; updatedBy: string;
  }> = [];

  for (let dayOffset = 7; dayOffset >= 1; dayOffset--) {
    const date = daysAgo(dayOffset);
    const dow = date.getDay();
    if (dow === 6) continue;

    for (const emp of employees) {
      if (Math.random() < 0.1) continue; // 10% absence
      const startHour = 7 + Math.floor(Math.random() * 2);
      const startMin = Math.floor(Math.random() * 60);
      const clockIn = new Date(date);
      clockIn.setHours(startHour, startMin, 0, 0);
      const workHours = 8 + Math.floor(Math.random() * 2);
      const clockOut = new Date(clockIn.getTime() + workHours * 3_600_000);
      const breakMinutes = 30 + Math.floor(Math.random() * 31);
      const totalHours = Math.round((workHours - breakMinutes / 60) * 100) / 100;

      entryBatch.push({
        employeeId: emp.id,
        employeeEmail: emp.email,
        employeeName: `${emp.firstName} ${emp.surname}`,
        branch: emp.branch,
        department: emp.department,
        clockIn,
        clockOut,
        date,
        totalHours,
        status: 'completed',
        breakMinutes,
        geofenceName: 'Stress HQ',
        isAutoGeofence: true,
        companyProfileId: company.id,
        createdBy: emp.id,
        updatedBy: emp.id,
      });
      entryCount++;

      if (entryBatch.length >= SHIFT_BATCH) {
        await prisma.timeEntry.createMany({ data: entryBatch as never[], skipDuplicates: true });
        entryBatch = [];
      }
    }
  }
  if (entryBatch.length > 0) {
    await prisma.timeEntry.createMany({ data: entryBatch as never[], skipDuplicates: true });
  }
  console.log(`[seed-stress] Created ${entryCount} time entries`);

  // ── Summary ──
  console.log('');
  console.log('═══════════════════════════════════════════════════════');
  console.log(`  STRESS SEED COMPLETE — ${label}`);
  console.log('═══════════════════════════════════════════════════════');
  console.log(`  Tenant:     Stress Test Corp (${company.id})`);
  console.log(`  Employees:  ${employees.length}`);
  console.log(`  Users:      ${employees.length + 1} (incl. admin)`);
  console.log(`  Shifts:     ${shiftCount}`);
  console.log(`  Entries:    ${entryCount}`);
  console.log('');
  console.log('  Login credentials for k6:');
  console.log(`    Admin:  ${STRESS_TENANT_EMAIL} / Password123`);
  console.log(`    Users:  stress.user0@timetrack.com ... stress.user${employeeCount - 1}@timetrack.com / Password123`);
  console.log('═══════════════════════════════════════════════════════');
}

main()
  .catch((err) => {
    console.error('[seed-stress] Fatal error:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });