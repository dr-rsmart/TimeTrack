/**
 * Privacy Policy (public, unauthenticated)
 * ----------------------------------------
 * Required by Apple App Store (privacy URL declared in submission metadata:
 * https://time-track.tech/privacy) and Google Play (Data Safety policy URL).
 * Content reflects TimeTrack's ACTUAL documented processing practices:
 * geofence-based attendance, POPIA/GDPR posture (IP redaction for managers,
 * append-only audit, retention policies, RLS tenant isolation).
 * Rendered outside the auth guard in App.tsx so store reviewers and data
 * subjects can read it without an account.
 */

import { Link } from 'react-router-dom';
import { ShieldCheck } from 'lucide-react';

const UPDATED = '16 September 2026';

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-6">
      <h2 className="text-base font-semibold text-foreground mb-2">{title}</h2>
      <div className="text-sm text-muted-foreground leading-relaxed space-y-2">{children}</div>
    </section>
  );
}

export default function Privacy() {
  return (
    <div className="min-h-screen bg-background py-10 px-4">
      <div className="max-w-3xl mx-auto">
        <div className="flex items-center gap-3 mb-2">
          <ShieldCheck className="w-7 h-7 text-brand" />
          <h1 className="text-2xl font-bold text-foreground">Privacy Policy</h1>
        </div>
        <p className="text-xs text-muted-foreground mb-8">
          TimeTrack — workforce time tracking, scheduling and payroll · Last updated: {UPDATED}
        </p>

        <Section title="1. Who we are">
          <p>
            TimeTrack (&ldquo;the app&rdquo;, &ldquo;we&rdquo;) is a workforce management platform
            operated by Smart Patel Tech Solutions and made available at{' '}
            <a className="text-brand underline" href="https://time-track.tech">
              time-track.tech
            </a>{' '}
            and via the TimeTrack iOS and Android applications. Employers (&ldquo;company
            administrators&rdquo;) use TimeTrack to record employee attendance, schedule shifts and
            produce payroll reports. This policy explains what personal information is processed,
            why, and the rights of the people whose data it holds. It is written to comply with the
            Protection of Personal Information Act (POPIA, South Africa) and, where applicable, the
            EU General Data Protection Regulation (GDPR).
          </p>
        </Section>

        <Section title="2. Information we process">
          <ul className="list-disc pl-5 space-y-1">
            <li>
              <strong>Identity &amp; employment records:</strong> name, work email address, role,
              employee number, position, branch, department, manager, hire date, contact number and
              hourly pay rate (used for attendance-cost reporting).
            </li>
            <li>
              <strong>Attendance &amp; location data:</strong> clock-in/clock-out timestamps, break
              minutes, shift schedules, and device location used to verify presence within an
              assigned workplace geofence. Location is processed to record and validate attendance
              (including automatic clock-in/out) — it is not used to track employees continuously
              outside attendance events at assigned work locations.
            </li>
            <li>
              <strong>Device &amp; notification data:</strong> push-notification tokens and basic
              device details so the app can confirm automatic punches and send shift reminders.
            </li>
            <li>
              <strong>Authentication data:</strong> email and a bcrypt-hashed password (never stored
              in plain text), session tokens, and password-reset metadata.
            </li>
            <li>
              <strong>Audit &amp; security logs:</strong> records of administrative actions (who
              changed what, when) including IP addresses. IP addresses are redacted for
              non-administrative viewers. Audit logs are append-only and are never silently purged.
            </li>
          </ul>
        </Section>

        <Section title="3. Why we process it (purposes &amp; legal grounds)">
          <ul className="list-disc pl-5 space-y-1">
            <li>
              <strong>Employment contract / your employer&apos;s legitimate interest:</strong>{' '}
              recording attendance, scheduling, payroll and overtime computation, and attendance
              cost reporting.
            </li>
            <li>
              <strong>Consent (withdrawable at any time):</strong> precise and background location
              for automatic geofence clock-in/out, and push notifications. Permissions are requested
              in-app and can be revoked in your device settings; the app remains usable with manual
              clock-in/out.
            </li>
            <li>
              <strong>Legal obligation &amp; security:</strong> audit trails, tenant isolation and
              abuse prevention.
            </li>
          </ul>
        </Section>
        <Section title="4. Location permissions in the mobile app">
          <p>
            On iOS and Android, TimeTrack may request &ldquo;While Using&rdquo; and
            &ldquo;Always&rdquo; location access. &ldquo;Always&rdquo; access enables automatic
            clock-in when you arrive at an assigned work location and clock-out when you leave, even
            when the app is closed or the device is locked. Location checks are limited to the
            geofence perimeters your employer assigns to you. Location data is transmitted to the
            TimeTrack server over TLS to create attendance records and is not sold, rented or used
            for advertising.
          </p>
        </Section>

        <Section title="5. Who we share data with">
          <p>
            We do not sell personal information. Data is shared only with: (a) your employer&apos;s
            TimeTrack administrators and managers, within their assigned branch/department scope;
            (b) service providers that host and operate the platform — Railway (application hosting
            and PostgreSQL database), Expo (push notification delivery), and Apple/Google (push
            transport) — each processing data solely to provide these services; and (c) authorities
            where legally compelled. Some processors operate infrastructure outside South Africa;
            transfers are limited to what is necessary to provide the service and are protected by
            applicable data-transfer safeguards.
          </p>
        </Section>

        <Section title="6. Retention">
          <p>
            Attendance and employment records are retained for the period configured by your
            employer&apos;s retention policy in TimeTrack, and as required by applicable labour and
            tax law. Security audit logs are retained on an append-only basis (with optional
            archival after long retention periods). When an employee account is terminated or
            deleted, identity records are removed or anonymised while historical attendance records
            required for payroll and legal purposes are retained for the configured period.
          </p>
        </Section>

        <Section title="7. Security">
          <p>
            We enforce HTTPS/TLS with HSTS, a strict Content-Security-Policy, hashed passwords,
            httpOnly session cookies with revocation on password change, CSRF and rate-limiting
            protections, role-based access control, and PostgreSQL row-level security with
            least-privilege database roles so each company&apos;s data is isolated from every other
            tenant. Weekly encrypted backups and restore drills are performed.
          </p>
        </Section>

        <Section title="8. Your rights">
          <p>
            Under POPIA (and the GDPR where applicable) you may request access to, correction of, or
            deletion of your personal information; object to or restrict certain processing;
            withdraw location/notification consent at any time via device settings; and lodge a
            complaint with the Information Regulator (South Africa) or your local supervisory
            authority. Employees should ordinarily address attendance-record corrections to their
            company administrator first, who can amend records in-app (every amendment is audited).
          </p>
        </Section>

        <Section title="9. Children">
          <p>
            TimeTrack is a workforce tool and is not directed at children. We do not knowingly
            process personal information of children.
          </p>
        </Section>

        <Section title="10. Changes &amp; contact">
          <p>
            We may update this policy; the &ldquo;last updated&rdquo; date above always reflects the
            current version. Questions about this policy or privacy requests can be sent to the app
            support and data-protection contact:{' '}
            <a className="text-brand underline" href="mailto:ricardovsmart@gmail.com">
              ricardovsmart@gmail.com
            </a>
            . See also our{' '}
            <Link className="text-brand underline" to="/support">
              Support page
            </Link>
            .
          </p>
        </Section>

        <div className="mt-10 pt-6 border-t border-border/40 text-center">
          <Link to="/login" className="text-sm text-brand hover:underline">
            ← Back to sign in
          </Link>
        </div>
      </div>
    </div>
  );
}
