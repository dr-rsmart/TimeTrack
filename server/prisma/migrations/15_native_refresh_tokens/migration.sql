CREATE TABLE "NativeRefreshToken" (
  "id" TEXT NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "revokedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "NativeRefreshToken_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "NativeRefreshToken_tokenHash_key" ON "NativeRefreshToken"("tokenHash");
CREATE INDEX "NativeRefreshToken_userId_revokedAt_idx" ON "NativeRefreshToken"("userId", "revokedAt");
CREATE INDEX "NativeRefreshToken_expiresAt_idx" ON "NativeRefreshToken"("expiresAt");
ALTER TABLE "NativeRefreshToken" ADD CONSTRAINT "NativeRefreshToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;