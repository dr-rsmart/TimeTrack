-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "Role" AS ENUM ('master', 'admin', 'manager', 'employee');

-- CreateEnum
CREATE TYPE "EmployeeStatus" AS ENUM ('active', 'suspended', 'terminated');

-- CreateEnum
CREATE TYPE "ShiftStatus" AS ENUM ('scheduled', 'active', 'completed', 'cancelled', 'no_show');

-- CreateEnum
CREATE TYPE "ShiftType" AS ENUM ('full_day', 'half_day', 'Holiday', 'Leave', 'Sick', 'PTO', 'Unpaid');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "role" "Role" NOT NULL DEFAULT 'employee',
    "passwordHash" TEXT,
    "mustChangePassword" BOOLEAN NOT NULL DEFAULT false,
    "companyProfileId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CompanyProfile" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "ownerUserId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "phone" TEXT,
    "address" TEXT,
    "vatNumber" TEXT,
    "registrationNumber" TEXT,
    "billingTier" TEXT NOT NULL DEFAULT 'standard',
    "primaryContactName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CompanyProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Employee" (
    "id" TEXT NOT NULL,
    "firstName" TEXT NOT NULL,
    "surname" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "position" TEXT,
    "avatarUrl" TEXT,
    "role" "Role" NOT NULL DEFAULT 'employee',
    "status" "EmployeeStatus" NOT NULL DEFAULT 'active',
    "employeeNumber" TEXT,
    "phone" TEXT,
    "branch" TEXT NOT NULL DEFAULT 'Unassigned',
    "department" TEXT NOT NULL DEFAULT 'General',
    "hireDate" TIMESTAMP(3),
    "salaryInfo" JSONB,
    "jurisdiction" TEXT,
    "taxId" TEXT,
    "employmentType" TEXT,
    "managerId" TEXT,
    "geofenceId" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "companyProfileId" TEXT,
    "createdBy" TEXT,
    "updatedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Employee_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Shift" (
    "id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "startTime" TEXT,
    "endTime" TEXT,
    "status" "ShiftStatus" NOT NULL DEFAULT 'scheduled',
    "shiftType" "ShiftType" NOT NULL DEFAULT 'full_day',
    "location" TEXT,
    "notes" TEXT,
    "employeeId" TEXT,
    "branch" TEXT,
    "department" TEXT,
    "employeeEmail" TEXT,
    "employeeName" TEXT,
    "companyProfileId" TEXT,
    "createdBy" TEXT,
    "updatedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Shift_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TimeEntry" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT,
    "employeeEmail" TEXT NOT NULL,
    "employeeName" TEXT,
    "branch" TEXT,
    "department" TEXT,
    "clockIn" TIMESTAMP(3) NOT NULL,
    "clockOut" TIMESTAMP(3),
    "date" DATE NOT NULL,
    "totalHours" DOUBLE PRECISION,
    "status" TEXT NOT NULL DEFAULT 'completed',
    "breakMinutes" INTEGER,
    "isManualOverride" BOOLEAN NOT NULL DEFAULT false,
    "clockedById" TEXT,
    "clockedByName" TEXT,
    "geofenceName" TEXT,
    "geofenceAddress" TEXT,
    "geofenceLatitude" DOUBLE PRECISION,
    "geofenceLongitude" DOUBLE PRECISION,
    "geofenceRadius" INTEGER,
    "isAutoGeofence" BOOLEAN NOT NULL DEFAULT false,
    "companyProfileId" TEXT,
    "createdBy" TEXT,
    "updatedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TimeEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CompanySettings" (
    "id" TEXT NOT NULL,
    "ordinaryHoursPerDay" DOUBLE PRECISION NOT NULL DEFAULT 8,
    "overtimeThresholdHours" DOUBLE PRECISION NOT NULL DEFAULT 8,
    "workDays" TEXT[] DEFAULT ARRAY['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday']::TEXT[],
    "useMonthlyOvertimeThreshold" BOOLEAN NOT NULL DEFAULT false,
    "monthlyOvertimeThresholdHours" DOUBLE PRECISION NOT NULL DEFAULT 195,
    "sundayOvertimeEnabled" BOOLEAN NOT NULL DEFAULT true,
    "sundayOvertimeMultiplier" DOUBLE PRECISION NOT NULL DEFAULT 1.5,
    "publicHolidayOvertimeEnabled" BOOLEAN NOT NULL DEFAULT true,
    "publicHolidayOvertimeMultiplier" DOUBLE PRECISION NOT NULL DEFAULT 2.0,
    "publicHolidays" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "companyProfileId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CompanySettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Geofence" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "address" TEXT,
    "latitude" DOUBLE PRECISION NOT NULL,
    "longitude" DOUBLE PRECISION NOT NULL,
    "radiusMeters" INTEGER NOT NULL DEFAULT 200,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "companyProfileId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Geofence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LocationPreset" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "address" TEXT,
    "latitude" DOUBLE PRECISION NOT NULL,
    "longitude" DOUBLE PRECISION NOT NULL,
    "radiusMeters" INTEGER NOT NULL DEFAULT 200,
    "companyProfileId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LocationPreset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "actorEmail" TEXT NOT NULL,
    "actorRole" TEXT NOT NULL,
    "changes" JSONB,
    "justification" TEXT,
    "ipAddress" TEXT,
    "branch" TEXT,
    "department" TEXT,
    "companyProfileId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RetentionPolicy" (
    "id" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "retentionDays" INTEGER NOT NULL,
    "autoPurge" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RetentionPolicy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CronLock" (
    "id" TEXT NOT NULL,
    "jobName" TEXT NOT NULL,
    "acquiredBy" TEXT NOT NULL,
    "acquiredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CronLock_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmploymentHistory" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "managerId" TEXT,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3),
    "role" TEXT,
    "department" TEXT,
    "branch" TEXT,
    "notes" TEXT,
    "createdBy" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmploymentHistory_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_companyProfileId_idx" ON "User"("companyProfileId");

-- CreateIndex
CREATE INDEX "CompanyProfile_ownerUserId_idx" ON "CompanyProfile"("ownerUserId");

-- CreateIndex
CREATE INDEX "Employee_managerId_idx" ON "Employee"("managerId");

-- CreateIndex
CREATE INDEX "Employee_geofenceId_idx" ON "Employee"("geofenceId");

-- CreateIndex
CREATE INDEX "Employee_branch_idx" ON "Employee"("branch");

-- CreateIndex
CREATE INDEX "Employee_department_idx" ON "Employee"("department");

-- CreateIndex
CREATE INDEX "Employee_status_idx" ON "Employee"("status");

-- CreateIndex
CREATE INDEX "Employee_companyProfileId_idx" ON "Employee"("companyProfileId");

-- CreateIndex
CREATE UNIQUE INDEX "Employee_email_companyProfileId_key" ON "Employee"("email", "companyProfileId");

-- CreateIndex
CREATE INDEX "Shift_date_idx" ON "Shift"("date");

-- CreateIndex
CREATE INDEX "Shift_employeeId_idx" ON "Shift"("employeeId");

-- CreateIndex
CREATE INDEX "Shift_status_idx" ON "Shift"("status");

-- CreateIndex
CREATE INDEX "Shift_date_employeeId_idx" ON "Shift"("date", "employeeId");

-- CreateIndex
CREATE INDEX "Shift_employeeId_status_idx" ON "Shift"("employeeId", "status");

-- CreateIndex
CREATE INDEX "Shift_companyProfileId_idx" ON "Shift"("companyProfileId");

-- CreateIndex
CREATE INDEX "Shift_employeeEmail_date_status_idx" ON "Shift"("employeeEmail", "date", "status");

-- CreateIndex
CREATE INDEX "Shift_companyProfileId_date_idx" ON "Shift"("companyProfileId", "date");

-- CreateIndex
CREATE INDEX "TimeEntry_date_idx" ON "TimeEntry"("date");

-- CreateIndex
CREATE INDEX "TimeEntry_employeeEmail_idx" ON "TimeEntry"("employeeEmail");

-- CreateIndex
CREATE INDEX "TimeEntry_status_idx" ON "TimeEntry"("status");

-- CreateIndex
CREATE INDEX "TimeEntry_date_employeeEmail_idx" ON "TimeEntry"("date", "employeeEmail");

-- CreateIndex
CREATE INDEX "TimeEntry_status_date_idx" ON "TimeEntry"("status", "date");

-- CreateIndex
CREATE INDEX "TimeEntry_companyProfileId_idx" ON "TimeEntry"("companyProfileId");

-- CreateIndex
CREATE INDEX "TimeEntry_employeeEmail_date_status_idx" ON "TimeEntry"("employeeEmail", "date", "status");

-- CreateIndex
CREATE INDEX "TimeEntry_companyProfileId_date_idx" ON "TimeEntry"("companyProfileId", "date");

-- CreateIndex
CREATE INDEX "CompanySettings_companyProfileId_idx" ON "CompanySettings"("companyProfileId");

-- CreateIndex
CREATE INDEX "Geofence_companyProfileId_idx" ON "Geofence"("companyProfileId");

-- CreateIndex
CREATE INDEX "LocationPreset_companyProfileId_idx" ON "LocationPreset"("companyProfileId");

-- CreateIndex
CREATE INDEX "AuditLog_entity_entityId_idx" ON "AuditLog"("entity", "entityId");

-- CreateIndex
CREATE INDEX "AuditLog_actorId_idx" ON "AuditLog"("actorId");

-- CreateIndex
CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_action_idx" ON "AuditLog"("action");

-- CreateIndex
CREATE INDEX "AuditLog_companyProfileId_idx" ON "AuditLog"("companyProfileId");

-- CreateIndex
CREATE UNIQUE INDEX "RetentionPolicy_entity_key" ON "RetentionPolicy"("entity");

-- CreateIndex
CREATE UNIQUE INDEX "CronLock_jobName_key" ON "CronLock"("jobName");

-- CreateIndex
CREATE INDEX "CronLock_expiresAt_idx" ON "CronLock"("expiresAt");

-- CreateIndex
CREATE INDEX "EmploymentHistory_employeeId_idx" ON "EmploymentHistory"("employeeId");

-- CreateIndex
CREATE INDEX "EmploymentHistory_managerId_idx" ON "EmploymentHistory"("managerId");

-- CreateIndex
CREATE INDEX "EmploymentHistory_employeeId_startDate_endDate_idx" ON "EmploymentHistory"("employeeId", "startDate", "endDate");

-- CreateIndex
CREATE INDEX "EmploymentHistory_employeeId_endDate_idx" ON "EmploymentHistory"("employeeId", "endDate");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_companyProfileId_fkey" FOREIGN KEY ("companyProfileId") REFERENCES "CompanyProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompanyProfile" ADD CONSTRAINT "CompanyProfile_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Employee" ADD CONSTRAINT "Employee_geofenceId_fkey" FOREIGN KEY ("geofenceId") REFERENCES "Geofence"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Employee" ADD CONSTRAINT "Employee_managerId_fkey" FOREIGN KEY ("managerId") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Employee" ADD CONSTRAINT "Employee_companyProfileId_fkey" FOREIGN KEY ("companyProfileId") REFERENCES "CompanyProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Shift" ADD CONSTRAINT "Shift_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Shift" ADD CONSTRAINT "Shift_companyProfileId_fkey" FOREIGN KEY ("companyProfileId") REFERENCES "CompanyProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimeEntry" ADD CONSTRAINT "TimeEntry_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimeEntry" ADD CONSTRAINT "TimeEntry_companyProfileId_fkey" FOREIGN KEY ("companyProfileId") REFERENCES "CompanyProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompanySettings" ADD CONSTRAINT "CompanySettings_companyProfileId_fkey" FOREIGN KEY ("companyProfileId") REFERENCES "CompanyProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Geofence" ADD CONSTRAINT "Geofence_companyProfileId_fkey" FOREIGN KEY ("companyProfileId") REFERENCES "CompanyProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LocationPreset" ADD CONSTRAINT "LocationPreset_companyProfileId_fkey" FOREIGN KEY ("companyProfileId") REFERENCES "CompanyProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmploymentHistory" ADD CONSTRAINT "EmploymentHistory_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmploymentHistory" ADD CONSTRAINT "EmploymentHistory_managerId_fkey" FOREIGN KEY ("managerId") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;
