/**
 * Seed Script
 * -----------
 * Populates the database with a realistic demo dataset:
 * - 1 company (Acme Holdings)
 * - Users: master, admin, 2 managers, 6 employees
 * - Geofences, shifts, time entries, settings, audit logs
 *
 * All demo accounts use password: "Password123"
 */

import 'dotenv/config';
import bcrypt from 'bcryptjs';
import prisma from './prisma.js';

const PASSWORD_HASH = bcrypt.hashSync('Password123', 10);
function toDateStr(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function daysAgo(n: number): Date {
  const d = new Date();
  d.setDate(d.getDate() - n);
  d.setHours(0, 0, 0, 0);
  return d;
}

async function main() {
  console.log('[seed] Starting database seed...');

  // ── Clean existing data (in dependency order) ──
  await prisma.retentionPolicy.deleteMany();
  await prisma.auditLog.deleteMany();
  await prisma.cronLock.deleteMany();
  await prisma.employmentHistory.deleteMany();
  await prisma.timeEntry.deleteMany();
  await prisma.shift.deleteMany();
  await prisma.companySettings.deleteMany();
  await prisma.employee.deleteMany();
  await prisma.geofence.deleteMany();
  await prisma.user.deleteMany();
  await prisma.companyProfile.deleteMany();

  // ── Company ──
  const company = await prisma.companyProfile.create({
    data: {
      name: 'Acme Holdings (Pty) Ltd',
      phone: '+27 11 555 0100',
      address: '12 Rivonia Road, Sandton, Johannesburg',
      vatNumber: 'ZA8123456789',
      registrationNumber: '2020/123456/07',
      billingTier: 'enterprise',
      primaryContactName: 'Diana Prince',
    },
  });
  console.log(`[seed] Company created: ${company.name} (${company.id})`);

  // ── Master user (platform owner) ──
  const masterUser = await prisma.user.create({
    data: {
      email: 'master@smartpatel.co.za',
      fullName: 'Platform Master',
      role: 'master',
      passwordHash: PASSWORD_HASH,
    },
  });

  // ── Admin user ──
  const adminUser = await prisma.user.create({
    data: {
      email: 'admin@timetrack.com',
      fullName: 'Diana Prince',
      role: 'admin',
      passwordHash: PASSWORD_HASH,
      companyProfileId: company.id,
    },
  });

  // ── Geofences ──
  const hqGeofence = await prisma.geofence.create({
    data: {
      name: 'Sandton HQ',
      address: '12 Rivonia Road, Sandton, Johannesburg',
      latitude: -26.1076,
      longitude: 28.0567,
      radiusMeters: 300,
      companyProfileId: company.id,
    },
  });

  const branchGeofence = await prisma.geofence.create({
    data: {
      name: 'Cape Town Branch',
      address: '45 Long Street, Cape Town',
      latitude: -33.9249,
      longitude: 18.4241,
      radiusMeters: 250,
      companyProfileId: company.id,
    },
  });

  const sitariGeofence = await prisma.geofence.create({
    data: {
      name: 'Sitari Country Estate',
      address: 'Old Main Rd, Firgrove Rural, Somerset West, 7130',
      latitude: -34.0841,
      longitude: 18.7842,
      radiusMeters: 5000, // 5km radius
      companyProfileId: company.id,
    },
  });
  console.log(`[seed] Geofence created: ${sitariGeofence.name} (${sitariGeofence.radiusMeters}m radius)`);

  // ── Employees ──
  const mkEmp = async (data: {
    firstName: string;
    surname: string;
    email: string;
    position: string;
    role: 'admin' | 'manager' | 'employee';
    branch: string;
    department: string;
    managerId?: string;
    geofenceId?: string;
    employeeNumber: string;
    hireDate: Date;
  }) => {
    return prisma.employee.create({
      data: {
        firstName: data.firstName,
        surname: data.surname,
        email: data.email,
        position: data.position,
        role: data.role,
        branch: data.branch,
        department: data.department,
        managerId: data.managerId ?? null,
        geofenceId: data.geofenceId ?? null,
        employeeNumber: data.employeeNumber,
        hireDate: data.hireDate,
        phone: '+27 82 555 0' + Math.floor(100 + Math.random() * 899),
        employmentType: 'permanent',
        jurisdiction: 'ZA',
        salaryInfo: { base: 25000 + Math.floor(Math.random() * 30000), currency: 'ZAR' },
        companyProfileId: company.id,
        createdBy: adminUser.id,
        updatedBy: adminUser.id,
      },
    });
  };

  // Admin employee record
  const adminEmp = await mkEmp({
    firstName: 'Diana',
    surname: 'Prince',
    email: 'admin@timetrack.com',
    position: 'Operations Director',
    role: 'admin',
    branch: 'Sandton HQ',
    department: 'Executive',
    geofenceId: hqGeofence.id,
    employeeNumber: 'EMP-001',
    hireDate: daysAgo(900),
  });

  // Managers
  const managerJhb = await mkEmp({
    firstName: 'Thabo',
    surname: 'Mokoena',
    email: 'thabo@timetrack.com',
    position: 'JHB Branch Manager',
    role: 'manager',
    branch: 'Sandton HQ',
    department: 'Operations',
    geofenceId: hqGeofence.id,
    employeeNumber: 'EMP-002',
    hireDate: daysAgo(700),
  });

  const managerCpt = await mkEmp({
    firstName: 'Ayesha',
    surname: 'Pillay',
    email: 'ayesha@timetrack.com',
    position: 'CPT Branch Manager',
    role: 'manager',
    branch: 'Cape Town',
    department: 'Operations',
    geofenceId: branchGeofence.id,
    employeeNumber: 'EMP-003',
    hireDate: daysAgo(600),
  });

  // Employees — Sitari Country Estate (Cape Town)
  const emp1 = await mkEmp({
    firstName: 'Sipho',
    surname: 'Ndlovu',
    email: 'sipho@timetrack.com',
    position: 'Accounts Clerk',
    role: 'employee',
    branch: 'Sitari Country Estate',
    department: 'Finance',
    managerId: managerCpt.id,
    geofenceId: sitariGeofence.id,
    employeeNumber: 'EMP-001',
    hireDate: daysAgo(350),
  });

  const emp3 = await mkEmp({
    firstName: 'Pieter',
    surname: 'van der Merwe',
    email: 'pieter@timetrack.com',
    position: 'Sales Representative',
    role: 'employee',
    branch: 'Sandton HQ',
    department: 'Sales',
    managerId: managerJhb.id,
    geofenceId: hqGeofence.id,
    employeeNumber: 'EMP-006',
    hireDate: daysAgo(200),
  });

  // Employees — CPT

  const emp4 = await mkEmp({
    firstName: 'Naledi',
    surname: 'Khumalo',
    email: 'naledi@timetrack.com',
    position: 'Customer Support Lead',
    role: 'employee',
    branch: 'Cape Town',
    department: 'Support',
    managerId: managerCpt.id,
    geofenceId: branchGeofence.id,
    employeeNumber: 'EMP-007',
    hireDate: daysAgo(300),
  });

  const emp5 = await mkEmp({
    firstName: 'Riaan',
    surname: 'Botha',
    email: 'riaan@timetrack.com',
    position: 'Technician',
    role: 'employee',
    branch: 'Cape Town',
    department: 'Engineering',
    managerId: managerCpt.id,
    geofenceId: branchGeofence.id,
    employeeNumber: 'EMP-008',
    hireDate: daysAgo(150),
  });

  // ── Users for managers & employees ──

 const userDefs = [
    { email: 'thabo@timetrack.com', fullName: 'Thabo Mokoena', role: 'manager' as const },
    { email: 'ayesha@timetrack.com', fullName: 'Ayesha Pillay', role: 'manager' as const },
    { email: 'sipho@timetrack.com', fullName: 'Sipho Ndlovu', role: 'employee' as const },
    { email: 'lerato@timetrack.com', fullName: 'Lerato Dlamini', role: 'employee' as const },
    { email: 'pieter@timetrack.com', fullName: 'Pieter van der Merwe', role: 'employee' as const },
    { email: 'naledi@timetrack.com', fullName: 'Naledi Khumalo', role: 'employee' as const },
    { email: 'riaan@timetrack.com', fullName: 'Riaan Botha', role: 'employee' as const },
  ];
  for (const u of userDefs) {
    await prisma.user.create({
      data: { ...u, passwordHash: PASSWORD_HASH, companyProfileId: company.id },
    });
  }

 // ── Company Settings ──
  const nextMonday = (() => {
    const d = new Date();
    const day = d.getDay();
    const diff = (8 - day) % 7 || 7;
    d.setDate(d.getDate() + diff);
    return toDateStr(d);
  })();

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
      publicHolidays: [nextMonday], // demo public holiday
    },
  });

  // ── Shifts (past 14 days + next 7 days) ──
  const allEmployees = [adminEmp, managerJhb, managerCpt, emp1, emp3, emp4, emp5];
  const shiftStatusPool = ['completed', 'completed', 'completed', 'completed', 'no_show', 'cancelled'];
  let shiftCount = 0;


 for (let dayOffset = 14; dayOffset >= -7; dayOffset--) {
    const date = daysAgo(dayOffset);
    const dow = date.getDay();
    if (dow === 6) continue; // skip Saturdays

    for (const emp of allEmployees) {
      const isPast = dayOffset > 0;
      const isToday = dayOffset === 0;

      // Sundays: only some employees work (holiday pay demo)
      if (dow === 0 && !['EMP-004', 'EMP-007'].includes(emp.employeeNumber ?? '')) continue;
      let status: string = 'scheduled';
      if (isPast) {
        status = shiftStatusPool[Math.floor(Math.random() * shiftStatusPool.length)];
      } else if (isToday) {
        status = Math.random() > 0.5 ? 'active' : 'scheduled';
      }

      // Leave types demo
      let shiftType: 'full_day' | 'half_day' | 'Leave' | 'Sick' | 'PTO' = 'full_day';
      if (isPast && Math.random() < 0.08) shiftType = 'Leave';
      else if (isPast && Math.random() < 0.04) shiftType = 'Sick';
      else if (isPast && dow === 5 && Math.random() < 0.05) shiftType = 'half_day';

      await prisma.shift.create({
        data: {
          date,
          startTime: shiftType === 'half_day' ? '08:00' : '08:00',
          endTime: shiftType === 'half_day' ? '12:00' : '17:00',
          status: status as 'scheduled' | 'active' | 'completed' | 'cancelled' | 'no_show',
          shiftType,
          employeeId: emp.id,
          branch: emp.branch,
          department: emp.department,
          employeeEmail: emp.email,
          employeeName: `${emp.firstName} ${emp.surname}`,
          location: emp.branch,
          notes: status === 'no_show' ? 'No-show: no clock-in recorded' : status === 'cancelled' ? 'Cancelled: operational requirements' : null,
          companyProfileId: company.id,
          createdBy: adminUser.id,
          updatedBy: adminUser.id,
        },
      });
      shiftCount++;
    }
  }
  console.log(`[seed] Created ${shiftCount} shifts`);

  // ── Time Entries (past 14 days) ──
  let entryCount = 0;
  for (let dayOffset = 14; dayOffset >= 1; dayOffset--) {
    const date = daysAgo(dayOffset);
    const dow = date.getDay();
    if (dow === 6) continue;

    for (const emp of allEmployees) {
      // Skip some days randomly (absences)
      if (Math.random() < 0.1) continue;
      if (dow === 0 && !['EMP-004', 'EMP-007'].includes(emp.employeeNumber ?? '')) continue;
      const startHour = 7 + Math.floor(Math.random() * 2); // 07-08
      const startMin = Math.floor(Math.random() * 60);
      const clockIn = new Date(date);
      clockIn.setHours(startHour, startMin, 0, 0);
      const workHours = 8 + Math.floor(Math.random() * 3); // 8-10 hours
      const clockOut = new Date(clockIn.getTime() + workHours * 3_600_000);
      const breakMinutes = 30 + Math.floor(Math.random() * 31); // 30-60
      const totalHours = Math.round((workHours - breakMinutes / 60) * 100) / 100;
      await prisma.timeEntry.create({
        data: {
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
          geofenceName: emp.branch === 'Cape Town' ? 'Cape Town Branch' : emp.branch === 'Sitari Country Estate' ? 'Sitari Country Estate' : 'Sandton HQ',
          isAutoGeofence: true,
          companyProfileId: company.id,
          createdBy: emp.id,
          updatedBy: emp.id,
        },
      });
      entryCount++;
    }
  }
  console.log(`[seed] Created ${entryCount} time entries`);

  // ── Employment history for a couple of employees ──
  await prisma.employmentHistory.createMany({
    data: [
      {
        employeeId: emp1.id,
        managerId: managerCpt.id,
        startDate: daysAgo(400),
        endDate: daysAgo(100),
        role: 'Accounts Assistant',
        department: 'Finance',
        branch: 'Cape Town',
        notes: 'Initial assignment',
        createdBy: adminUser.id,
      },
      {
        employeeId: emp1.id,
        managerId: managerCpt.id,
        startDate: daysAgo(100),
        endDate: null,
        role: 'Accounts Clerk',
        department: 'Finance',
        branch: 'Sitari Country Estate',
        notes: 'Transferred to Sitari Country Estate',
        createdBy: adminUser.id,
      },
    ],
  });

  // ── Audit log samples ──
  await prisma.auditLog.createMany({
    data: [
      {
        entity: 'CompanyProfile',
        entityId: company.id,
        action: 'create',
        actorId: masterUser.id,
        actorEmail: masterUser.email,
        actorRole: 'master',
        justification: 'Company onboarding',
        ipAddress: '127.0.0.1',
      },
      {
        entity: 'Employee',
        entityId: emp1.id,
        action: 'update',
        actorId: adminUser.id,
        actorEmail: adminUser.email,
        actorRole: 'admin',
        changes: { position: { before: 'Accounts Assistant', after: 'Accounts Clerk' } },
        justification: 'Transfer to Sitari Country Estate',
        ipAddress: '192.168.1.10',
        branch: 'Sitari Country Estate',
        department: 'Finance',
      },
      {
        entity: 'User',
        entityId: adminUser.id,
        action: 'login',
        actorId: adminUser.id,
        actorEmail: adminUser.email,
        actorRole: 'admin',
        ipAddress: '192.168.1.10',
      },
    ],
  });

  // ── Retention policies ──
  await prisma.retentionPolicy.createMany({
    data: [
      { entity: 'TimeEntry', retentionDays: 365, autoPurge: false },
      { entity: 'Shift', retentionDays: 365, autoPurge: false },
      { entity: 'AuditLog', retentionDays: 1825, autoPurge: false },
    ],
  });
  console.log('[seed] Seed complete!');
  console.log('');
  console.log('  Demo accounts (password: Password123):');
  console.log('  ─────────────────────────────────────────');
  console.log('  master@smartpatel.co.za    → Platform Master (cross-tenant)');
  console.log('  admin@timetrack.com   → Company Admin');
  console.log('  thabo@timetrack.com   → Manager (Sandton HQ)');
  console.log('  ayesha@timetrack.com  → Manager (Cape Town)');
  console.log('  sipho@timetrack.com   → Employee (Sitari Country Estate)');
  console.log('  lerato@timetrack.com  → Employee (Sandton HQ)');
  console.log('  pieter@timetrack.com  → Employee (Sandton HQ)');
  console.log('  naledi@timetrack.com  → Employee (Cape Town)');
  console.log('  riaan@timetrack.com   → Employee (Cape Town)');
}

main()
  .catch((err) => {
    console.error('[seed] Fatal error:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });