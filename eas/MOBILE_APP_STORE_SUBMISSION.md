# TimeTrack — iOS & Android Store Submission Dossier

This document contains all the assets, metadata, privacy declarations, reviewer test accounts, and policy justification texts required for submitting **TimeTrack** to the **Apple App Store (iOS)** and the **Google Play Store (Android)**.

---

## 1. Store Screenshot & Asset Registry

All screenshot assets have been generated via Playwright directly from the production-ready application UI without simulated device bezels or mockup frames (in strict compliance with Apple App Store Review Guideline 2.3.3 and Google Play Store Listing Policies).

### 1.1 iOS App Store Screenshots

| Device / Form Factor                              | Resolution         | Aspect Ratio | Directory Path                 | Included Screens |
| :------------------------------------------------ | :----------------- | :----------- | :----------------------------- | :--------------- |
| **iPhone 6.7" Display** (iPhone 16/15/14 Pro Max) | **1290 x 2796 px** | 19.5:9       | `store-assets/ios/iphone-6.7/` | 7 core screens   |
| **iPhone 5.5" Display** (iPhone 8 Plus / 7 Plus)  | **1242 x 2208 px** | 16:9         | `store-assets/ios/iphone-5.5/` | 7 core screens   |
| **iPad Pro 12.9" Display** (6th Gen iPad Pro)     | **2048 x 2732 px** | 4:3          | `store-assets/ios/ipad-12.9/`  | 7 core screens   |

### 1.2 Google Play Store Screenshots

| Device / Form Factor   | Resolution         | Aspect Ratio | Directory Path                          | Included Screens |
| :--------------------- | :----------------- | :----------- | :-------------------------------------- | :--------------- |
| **Android Phone**      | **1080 x 2400 px** | 20:9         | `store-assets/android/phone-1080x2400/` | 7 core screens   |
| **Android 10" Tablet** | **1600 x 2560 px** | 16:10        | `store-assets/android/tablet-10in/`     | 7 core screens   |
| **Android 7" Tablet**  | **1200 x 1920 px** | 16:10        | `store-assets/android/tablet-7in/`      | 7 core screens   |

### 1.3 Store Graphic Assets

| Asset Type                      | Resolution        | Format     | File Path                                            |
| :------------------------------ | :---------------- | :--------- | :--------------------------------------------------- |
| **High-Res App Icon**           | **512 x 512 px**  | 32-bit PNG | `store-assets/graphics/app-icon-512x512.png`         |
| **Google Play Feature Graphic** | **1024 x 500 px** | 24-bit PNG | `store-assets/graphics/feature-graphic-1024x500.png` |

### 1.4 Screenshot Sequence & Captions

1. **`01_Login.png`**: _Secure Enterprise Authentication & Role Access_
2. **`02_Dashboard_Attendance.png`**: _Real-Time Attendance KPIs & Workforce Overview_
3. **`03_TimeTracking_Live_Clock.png`**: _Hands-Free Geofence Punch & Live Shift Timer_
4. **`04_WorkLocation_Geofence_Management.png`**: _GPS Geofence Perimeter & Work Location Rules_
5. **`05_Payroll_Timesheets_Reports.png`**: _Automated Timesheets, Daily & Sunday Overtime_
6. **`06_Workforce_Employee_Directory.png`**: _Team Roster, Multi-Branch & Department Directory_
7. **`07_Shift_Roster_Schedule.png`**: _Shift Scheduling, Roster Planner & Absence Tracking_

---

## 2. Store Listing Metadata

### 2.1 Apple App Store Connect

| Field                    | Character Limit | Text / Content                                                                                                                                         |
| :----------------------- | :-------------- | :----------------------------------------------------------------------------------------------------------------------------------------------------- |
| **App Name**             | 30              | `TimeTrack: Workforce & Payroll`                                                                                                                       |
| **Subtitle**             | 30              | `Geofence Clock In & Payroll`                                                                                                                          |
| **Primary Category**     | —               | `Business`                                                                                                                                             |
| **Secondary Category**   | —               | `Productivity`                                                                                                                                         |
| **Bundle ID**            | —               | `com.timetrack.workforce`                                                                                                                              |
| **SKU**                  | —               | `TIMETRACK-PROD-001`                                                                                                                                   |
| **Keywords**             | 100             | `time tracking,timesheet,clock in,geofence,attendance,payroll,roster,overtime,workforce,shifts,gps`                                                    |
| **Promotional Text**     | 170             | `Effortless workforce attendance with automated GPS geofence clock-in/out, live shift rosters, overtime calculation, and compliance-ready timesheets.` |
| **Privacy Policy URL**   | —               | `https://time-track.tech/privacy`                                                                                                                      |
| **Terms of Service URL** | —               | `https://time-track.tech/terms`                                                                                                                        |
| **Support URL**          | —               | `https://time-track.tech/support`                                                                                                                      |
| **Marketing URL**        | —               | `https://time-track.tech`                                                                                                                              |

### 2.2 Google Play Console

| Field                 | Character Limit | Text / Content                                                               |
| :-------------------- | :-------------- | :--------------------------------------------------------------------------- |
| **App Name**          | 30              | `TimeTrack: Workforce & Payroll`                                             |
| **Short Description** | 80              | `Automated geofence time tracking, live shift rosters & payroll timesheets.` |
| **Category**          | —               | `Business` / `Productivity`                                                  |
| **Tags**              | —               | `Business`, `Productivity`, `Time Tracking`, `Employee Management`           |
| **Target Audience**   | —               | `18 and over` (Workforce & Enterprise)                                       |

| **Privacy Policy URL** | — | `https://time-track.tech/privacy` |
| **Support URL** | — | `https://time-track.tech/support` |

> ⚠️ NEVER enter `https://timetrack.smartpatel.co.za/privacy` (or any other
> subdomain of `smartpatel.co.za`): the parent domain is a parked GoDaddy
> lander and the subdomain has no DNS record. Submitting it caused the
> 2026-09-21 Play "Invalid privacy policy" rejection. The canonical policy URL
> is `https://time-track.tech/privacy` — it serves the full policy text as
> static HTML over GET **and** HEAD (`dist/privacy.html`, generated at build
> time from `src/content/privacyPolicy.json`).

### 2.3 Full Description (Both Platforms)

```markdown
TimeTrack is an enterprise-grade time tracking, shift scheduling, and payroll attendance platform engineered for modern workforces. With automated GPS geofencing, TimeTrack ensures accurate, hands-free clock-in and clock-out when employees enter or leave designated workplace perimeters.

KEY FEATURES:

📍 AUTOMATED GEOFENCE CLOCK-IN & OUT
• Seamless hands-free attendance recording: auto clock-in upon entering your workplace and auto clock-out upon departure.
• High-precision GPS perimeter validation prevents off-site clocking errors.
• Multi-location support for headquarters, regional branches, and field project sites.

⏱️ LIVE TIME TRACKING & BREAK MANAGEMENT
• Real-time shift duration counter and one-tap break logging.
• Instant visibility into who is currently clocked in, on break, or scheduled.
• Offline resilience with automatic background synchronization upon reconnection.

📅 SHIFT SCHEDULING & ROSTER MANAGEMENT
• Interactive shift planner with customizable shift patterns and leave tracking.
• Instant roster visibility for employees and branch managers.
• Automated notifications for upcoming shifts and schedule adjustments.

📊 COMPLIANCE-READY PAYROLL & TIMESHEETS
• Automatic calculation of ordinary hours, daily overtime, and Sunday overtime multipliers.
• Public holiday compensation rules and automated timesheet aggregation.
• One-click export to CSV and Excel for direct integration with payroll processors.

👥 MULTI-TENANT & ROLE-BASED ACCESS CONTROL
• Dedicated portals for Employees, Department Managers, and Company Administrators.
• Comprehensive tamper-proof audit trails for every attendance punch and manual adjustment.
• Enterprise data isolation ensuring strict compliance with GDPR and POPIA regulations.

Optimize workforce productivity, eliminate buddy punching, and streamline your payroll cycle with TimeTrack.
```

---

## 3. Background Location & Geofencing Declarations

Both Apple and Google strictly regulate background location access (`Always Allow` / `ACCESS_BACKGROUND_LOCATION`). Because TimeTrack features automated, hands-free clock-in and clock-out as employees enter or depart assigned work sites, the following declarations must be submitted to the review teams.

### 3.1 iOS Configuration (`Info.plist`)

```xml
<!-- Required Info.plist keys -->
<key>NSLocationWhenInUseUsageDescription</key>
<string>TimeTrack uses your location to verify your presence at designated workplace geofence perimeters for clock-in and clock-out operations.</string>

<key>NSLocationAlwaysAndWhenInUseUsageDescription</key>
<string>TimeTrack requires background location access to automatically clock you in when entering your assigned work location geofence and clock you out when leaving, even when the app is closed or running in the background.</string>

<key>NSLocationAlwaysUsageDescription</key>
<string>TimeTrack requires continuous background location monitoring to provide automated hands-free attendance recording when you cross designated workplace geofence boundaries.</string>

<key>UIBackgroundModes</key>
<array>
    <string>location</string>
    <string>fetch</string>
    <string>processing</string>
</array>
```

#### Apple App Review Notes for Background Location:

> **Location Feature Explanation for Reviewer:**
> "TimeTrack utilizes background location monitoring (`location` background mode) exclusively for geofence-based employee attendance automation. When an employee arrives at their assigned work site (e.g., Sandton HQ), the iOS Region Monitoring API detects entry into the geofence perimeter and automatically triggers a clock-in event without requiring the user to open the app. When the employee departs the perimeter, the app logs a clock-out event. Location coordinates are strictly used for boundary verification and are not continuously tracked, sold, or shared with third parties."

---

### 3.2 Android Configuration (`AndroidManifest.xml`)

```xml
<!-- Required Android Permissions -->
<uses-permission android:name="android.permission.ACCESS_FINE_LOCATION" />
<uses-permission android:name="android.permission.ACCESS_COARSE_LOCATION" />
<uses-permission android:name="android.permission.ACCESS_BACKGROUND_LOCATION" />
<uses-permission android:name="android.permission.FOREGROUND_SERVICE" />
<uses-permission android:name="android.permission.FOREGROUND_SERVICE_LOCATION" />
```

#### Google Play Background Location Declaration Form Answers:

1. **Why does your app need background location access?**

   > _Answer:_ TimeTrack is a workforce attendance and safety application. The core feature of TimeTrack is hands-free, automated clock-in and clock-out. When an employee arrives at or departs from their designated workplace geofence boundary, the application must detect the geofence boundary crossing in the background (even when the device is locked or the app is closed) to record shift start and end times accurately.

2. **Can the feature be delivered without background location access?**

   > _Answer:_ No. If location access is limited to the foreground only, employees who arrive on site with their phones in their pockets or bags will fail to be clocked in. This causes missed work hours, inaccurate payroll records, and compliance violations under labor regulations.

3. **Does the user initiate the background location feature?**

   > _Answer:_ Yes. Background geofencing is an opt-in setting configured within the employee's profile and settings. An in-app prominent disclosure dialog explains why background location is needed before requesting runtime permissions.

4. **Link to Video Demonstration (Google Play & Apple Review Requirement):**
   > _Provide an unlisted YouTube or Vimeo URL demonstrating:_
   >
   > 1. User signing in and viewing the in-app prominent disclosure dialog explaining location access.
   > 2. User granting location permission ("Allow all the time" / "Always Allow").
   > 3. Moving or simulating GPS coordinates entering the geofence perimeter.
   > 4. Receiving the "Auto Clock In" system notification and seeing the active shift recorded on the dashboard.

---

### 3.3 In-App Prominent Disclosure & Consent Flow (Android native shell, vc19+)

After the vc18 rejection ("Missing Prominent Disclosure", `ACCESS_BACKGROUND_LOCATION`), the native shell (`mobile/App.js`) implements the full Play User Data Prominent Disclosure & Consent requirement:

1. **Disclosure before any request.** On cold start, whenever foreground + background location are not both granted, a full-screen native disclosure ("Background Location Disclosure") is presented BEFORE any permission request or background access. It states: precise location is collected **in the background, including while the app is closed or not in use**; the purpose (automatic clock-in/out at assigned work geofences); that confirmed punch events (place + time) are sent securely **only to the employer's TimeTrack server** to record attendance; no selling, no third-party sharing, no movement history; duration and stop controls (Auto Clock toggle, sign-out, OS settings); the persistent "Monitoring work location" foreground-service notification and OS background indicator; and that **manual Clock In/Out remains fully available if the user declines**.
2. **Affirmative consent.** "Agree & Continue" persists consent (`timetrack_bg_disclosure_consent = 'granted'`) and only then calls `requestForegroundPermissionsAsync()` → `requestBackgroundPermissionsAsync()`. "Not Now" persists `'declined'` and requests nothing.
3. **Single background gate.** `ensureBackgroundLocationUpdates()` returns early unless the OS background permission is `granted`, so no caller (app resume, geofence assignment, iOS BGTask watchdog) can ever start background location pre-consent.
4. **Re-disclosure on later opt-in.** If the employee enables Auto Clock In/Out from the web UI (`AUTO_CLOCK_ENABLED` bridge message) while background location is ungranted and consent ≠ granted — or a geofence assignment arrives with no recorded decision — the disclosure is re-presented BEFORE any new request.
5. **Resubmission (vc20).** Build with `eas build --platform android --profile production` (remote auto-increment → vc20), then roll out with `TT_AAB=timetrack-vc20.aab TT_RELEASE=20 node scripts/update-closed-alpha-vc19.mjs` followed by `TT_AAB=timetrack-vc20.aab TT_RELEASE=20 node scripts/promote-production-vc19.mjs`, replacing the rejected vc18 change set. In Play Console, complete the background-location declaration with justification text mirroring the in-app disclosure plus a demo video of the flow in §3.2 item 4, verify the Data-safety location entries (§4.2), and resubmit from the Publishing overview.

---

## 4. App Privacy & Data Safety Declarations

### 4.1 Apple App Privacy (App Store Connect)

| Data Type               | Collected? | Linked to User? | Used for Tracking? | Purpose                                                                |
| :---------------------- | :--------- | :-------------- | :----------------- | :--------------------------------------------------------------------- |
| **Precise Location**    | Yes        | Yes             | No                 | **App Functionality**: Geofence attendance verification.               |
| **Coarse Location**     | Yes        | Yes             | No                 | **App Functionality**: Regional branch assignment.                     |
| **Name & Email**        | Yes        | Yes             | No                 | **App Functionality**: User authentication and profile identification. |
| **User ID**             | Yes        | Yes             | No                 | **App Functionality**: Account management and RBAC security.           |
| **Product Interaction** | Yes        | Yes             | No                 | **App Functionality**: Audit logs and shift adjustment compliance.     |

### 4.2 Google Play Data Safety

- **Data Encryption in Transit:** Yes (HTTPS / TLS 1.3).
- **Data Deletion Mechanism:** Yes (Account deletion & data purge policy supported).
- **Data Types Shared:** None (0 third-party data sharing).
- **Data Types Collected:**
  - _Location -> Precise Location:_ Ephemeral GPS verification during geofence boundary crossings.
  - _Personal Info -> Name, Email address, User IDs, Employee IDs:_ Account management.
  - _App Activity -> App interactions:_ Audit trail logging.

---

## 5. Reviewer Demo Accounts & Test Script

The following pre-seeded test accounts can be provided to Apple and Google App Review teams for testing:

| Role                      | Email                 | Password      | Assigned Geofence                 | Scope                       |
| :------------------------ | :-------------------- | :------------ | :-------------------------------- | :-------------------------- |
| **Company Administrator** | `admin@timetrack.com` | `Password123` | Sandton HQ (-26.1076, 28.0567)    | Full company access         |
| **Branch Manager**        | `thabo@timetrack.com` | `Password123` | Sandton HQ (-26.1076, 28.0567)    | Team & roster management    |
| **Staff Employee**        | `sipho@timetrack.com` | `Password123` | Sitari Estate (-34.0841, 18.7842) | Clock in/out & self-service |

### Step-by-Step Reviewer Verification Guide:

1. Log in with `admin@timetrack.com` / `Password123`.
2. Observe the **Dashboard** displaying live workforce attendance rates, active shift counts, and departmental hours.
3. Navigate to **Time Tracking** (`/time`) to observe the active geofence badge (_Sandton HQ, 300m radius_) and clock-in widget.
4. Navigate to **Settings -> Geofences** to view configured work perimeters and radius definitions.
5. Navigate to **Reports** (`/reports`) to inspect automated timesheet aggregations with daily and Sunday overtime breakdowns.
6. Navigate to **Employees** (`/employees`) to view the multi-branch workforce directory.

---

## 6. Pre-Submission Checklist

- [x] High-resolution store screenshots generated via Playwright (NO mockups used).
- [x] iOS 6.7", 5.5", and 12.9" iPad Pro screenshot suites placed in `store-assets/ios/`.
- [x] Android Phone, 10" Tablet, and 7" Tablet screenshot suites placed in `store-assets/android/`.
- [x] 512x512 App Icon and 1024x500 Feature Graphic placed in `store-assets/graphics/`.
- [x] `mobile/ios/Info.plist` configured with background location usage descriptions and `UIBackgroundModes`.
- [x] `mobile/android/AndroidManifest.xml` configured with `ACCESS_BACKGROUND_LOCATION` and `FOREGROUND_SERVICE_LOCATION`.
- [x] Prominent location disclosure copy and privacy questionnaire answers prepared.
- [x] Native full-screen Prominent Disclosure + consent gate implemented in `mobile/App.js` (vc19), hardened with persisted consent, a single background-start gate and re-disclosure on later opt-in (vc20).
- [x] Demo credentials and reviewer test instructions validated.
