CREATE TABLE "DevicePushToken" (
  "id" TEXT NOT NULL,
  "token" TEXT NOT NULL,
  "platform" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "employeeEmail" TEXT,
  "companyProfileId" TEXT,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "DevicePushToken_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "DevicePushToken_token_key" ON "DevicePushToken"("token");
CREATE INDEX "DevicePushToken_userId_isActive_idx" ON "DevicePushToken"("userId", "isActive");
CREATE INDEX "DevicePushToken_companyProfileId_isActive_idx" ON "DevicePushToken"("companyProfileId", "isActive");
ALTER TABLE "DevicePushToken" ADD CONSTRAINT "DevicePushToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DevicePushToken" ADD CONSTRAINT "DevicePushToken_companyProfileId_fkey" FOREIGN KEY ("companyProfileId") REFERENCES "CompanyProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "PayrollPeriodSnapshot" (
  "id" TEXT NOT NULL,
  "companyProfileId" TEXT NOT NULL,
  "periodFrom" DATE NOT NULL,
  "periodTo" DATE NOT NULL,
  "employeeId" TEXT NOT NULL,
  "employeeEmail" TEXT NOT NULL,
  "settings" JSONB NOT NULL,
  "result" JSONB NOT NULL,
  "createdBy" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PayrollPeriodSnapshot_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "PayrollPeriodSnapshot_companyProfileId_periodFrom_periodTo_employeeId_key" ON "PayrollPeriodSnapshot"("companyProfileId", "periodFrom", "periodTo", "employeeId");
CREATE INDEX "PayrollPeriodSnapshot_companyProfileId_periodFrom_periodTo_idx" ON "PayrollPeriodSnapshot"("companyProfileId", "periodFrom", "periodTo");
ALTER TABLE "PayrollPeriodSnapshot" ADD CONSTRAINT "PayrollPeriodSnapshot_companyProfileId_fkey" FOREIGN KEY ("companyProfileId") REFERENCES "CompanyProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;