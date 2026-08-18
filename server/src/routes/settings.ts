/**
 * Settings & Geofence Routes
 * --------------------------
 * Company payroll settings and geofence management (admin-only).
 */

import { Router } from 'express';
import prisma from '../prisma.js';
import { requireAuth, requireAdmin, requireAdminOrManager } from '../middleware/auth.js';
import { validate, updateSettingsSchema, createGeofenceSchema, updateGeofenceSchema } from '../validation.js';
import { logAudit, getClientIp, computeChanges } from '../audit.js';
import { broadcastScoped } from '../sse.js';
import { haversineDistance } from '../geoValidationService.js';
import {
  badRequest,
  notFound,
  accessDenied,
  conflict,
  badGateway,
  internalError,
} from '../errorResponse.js';

const router = Router();

router.use(requireAuth);

// ── GET /settings — get company payroll settings ──
router.get('/settings', requireAuth, async (req, res) => {
  try {
    const authUser = req.authUser!;

    // Master without a tenant context must not receive arbitrary company settings.
    // Require an explicit companyProfileId (e.g. via impersonation/company switching).
    if (!authUser.companyProfileId) {
      return res.json({ settings: null });
    }

    const settings = await prisma.companySettings.findFirst({
      where: { companyProfileId: authUser.companyProfileId },
      orderBy: { updatedAt: 'desc' },
    });

    // Merge system-wide holidays (Master-managed) into the response
    const systemSettings = await prisma.companySettings.findFirst({
      where: { companyProfileId: null },
      orderBy: { updatedAt: 'desc' },
    });

    const merged = settings
      ? {
          ...settings,
          systemHolidays: systemSettings?.publicHolidays ?? [],
        }
      : null;

    res.json({ settings: merged });
  } catch (err) {
    console.error('[settings] Get error:', err);
    internalError(res, 'fetching settings');
  }
});

// ── PUT /settings — update company payroll settings (admin only) ──
router.put('/settings', requireAdmin, validate(updateSettingsSchema), async (req, res) => {
  try {
    const authUser = req.authUser!;
    const data = req.body;

    const existing = await prisma.companySettings.findFirst({
      where: { companyProfileId: authUser.companyProfileId ?? undefined },
    });

    let settings;
    if (existing) {
      settings = await prisma.companySettings.update({
        where: { id: existing.id },
        data,
      });
    } else {
      settings = await prisma.companySettings.create({
        data: { ...data, companyProfileId: authUser.companyProfileId },
      });
    }

    // Compliance: record a before/after diff so payroll-rule changes are
    // fully attributable and reversible in the audit trail.
    const changes = existing
      ? computeChanges(existing as unknown as Record<string, unknown>, settings as unknown as Record<string, unknown>)
      : undefined;

    logAudit({
      entity: 'CompanySettings',
      entityId: settings.id,
      action: 'update',
      actorId: authUser.id,
      actorEmail: authUser.email,
      actorRole: authUser.role,
      changes,
      ipAddress: getClientIp(req),
      companyProfileId: authUser.companyProfileId,
    });

    broadcastScoped('CompanySettings', 'update', settings, { companyProfileId: authUser.companyProfileId });

    res.json({ settings });
  } catch (err) {
    console.error('[settings] Update error:', err);
    internalError(res, 'updating settings');
  }
});

// ── GET /holidays — list system-wide + company holidays ──
// Master sees system-wide holidays; Admin sees both system-wide and company-specific.
router.get('/holidays', requireAuth, async (req, res) => {
  try {
    const authUser = req.authUser!;

    // System-wide holidays (companyProfileId = null, managed by Master)
    const systemSettings = await prisma.companySettings.findFirst({
      where: { companyProfileId: null },
      select: { publicHolidays: true },
    });
    const systemHolidays = systemSettings?.publicHolidays ?? [];

    // Company-specific holidays
    let companyHolidays: string[] = [];
    if (authUser.companyProfileId) {
      const companySettings = await prisma.companySettings.findFirst({
        where: { companyProfileId: authUser.companyProfileId },
        select: { publicHolidays: true },
      });
      companyHolidays = companySettings?.publicHolidays ?? [];
    }

    res.json({ systemHolidays, companyHolidays });
  } catch (err) {
    console.error('[settings] Holidays list error:', err);
    internalError(res, 'fetching holidays');
  }
});

// ── POST /holidays — add a holiday ──
// Master adds system-wide holidays; Admin adds company-specific holidays.
// Body: { date: string (YYYY-MM-DD), name?: string, scope?: 'system' | 'company' }
router.post('/holidays', requireAdmin, async (req, res) => {
  try {
    const authUser = req.authUser!;
    const { date, scope } = req.body as { date?: string; name?: string; scope?: string };

    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return badRequest(res, 'A valid date (YYYY-MM-DD) is required.');
    }

    // Determine target scope: Master can manage system-wide; Admin manages company
    const isSystemScope = authUser.role === 'master' && scope === 'system';

    if (isSystemScope) {
      // Master: update system-wide holidays (companyProfileId = null)
      const existing = await prisma.companySettings.findFirst({
        where: { companyProfileId: null },
      });
      if (existing) {
        if (existing.publicHolidays.includes(date)) {
          return conflict(res, 'This holiday already exists in the system calendar.');
        }
        await prisma.companySettings.update({
          where: { id: existing.id },
          data: { publicHolidays: [...existing.publicHolidays, date] },
        });
      } else {
        await prisma.companySettings.create({
          data: { companyProfileId: null, publicHolidays: [date] },
        });
      }
    } else {
      // Admin: update company-specific holidays
      if (!authUser.companyProfileId) {
        return badRequest(res, 'No company context available.');
      }
      const existing = await prisma.companySettings.findFirst({
        where: { companyProfileId: authUser.companyProfileId },
      });
      if (existing) {
        if (existing.publicHolidays.includes(date)) {
          return conflict(res, 'This holiday already exists in your company calendar.');
        }
        await prisma.companySettings.update({
          where: { id: existing.id },
          data: { publicHolidays: [...existing.publicHolidays, date] },
        });
      } else {
        await prisma.companySettings.create({
          data: { companyProfileId: authUser.companyProfileId, publicHolidays: [date] },
        });
      }
    }

    logAudit({
      entity: 'CompanySettings',
      entityId: isSystemScope ? 'system' : authUser.companyProfileId ?? 'unknown',
      action: 'add_holiday',
      actorId: authUser.id,
      actorEmail: authUser.email,
      actorRole: authUser.role,
      justification: `Added ${isSystemScope ? 'system-wide' : 'company'} holiday: ${date}`,
      ipAddress: getClientIp(req),
    });

    res.status(201).json({ success: true, date, scope: isSystemScope ? 'system' : 'company' });
  } catch (err) {
    console.error('[settings] Add holiday error:', err);
    internalError(res, 'adding holiday');
  }
});

// ── DELETE /holidays/:date — remove a holiday ──
// Master can remove system-wide holidays; Admin can remove company-specific holidays.
router.delete('/holidays/:date', requireAdmin, async (req, res) => {
  try {
    const authUser = req.authUser!;
    const date = req.params.date as string;
    const scope = req.query.scope as string;

    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return badRequest(res, 'Invalid date format.');
    }

    const isSystemScope = authUser.role === 'master' && scope === 'system';

    if (isSystemScope) {
      const existing = await prisma.companySettings.findFirst({
        where: { companyProfileId: null },
      });
      if (!existing || !existing.publicHolidays.includes(date)) {
        return notFound(res, 'Holiday in system calendar');
      }
      await prisma.companySettings.update({
        where: { id: existing.id },
        data: { publicHolidays: existing.publicHolidays.filter((d) => d !== date) },
      });
    } else {
      if (!authUser.companyProfileId) {
        return badRequest(res, 'No company context available.');
      }
      const existing = await prisma.companySettings.findFirst({
        where: { companyProfileId: authUser.companyProfileId },
      });
      if (!existing || !existing.publicHolidays.includes(date)) {
        return notFound(res, 'Holiday in company calendar');
      }
      await prisma.companySettings.update({
        where: { id: existing.id },
        data: { publicHolidays: existing.publicHolidays.filter((d) => d !== date) },
      });
    }

    logAudit({
      entity: 'CompanySettings',
      entityId: isSystemScope ? 'system' : authUser.companyProfileId ?? 'unknown',
      action: 'remove_holiday',
      actorId: authUser.id,
      actorEmail: authUser.email,
      actorRole: authUser.role,
      justification: `Removed ${isSystemScope ? 'system-wide' : 'company'} holiday: ${date}`,
      ipAddress: getClientIp(req),
    });

    res.json({ success: true, removed: date });
  } catch (err) {
    console.error('[settings] Remove holiday error:', err);
    internalError(res, 'removing holiday');
  }
});

// ── GET /geofences/my — employee-facing: own assignment + all active company geofences ──
// Accessible by ANY authenticated user (including employees) so the
// MyWorkLocation dashboard can display distances without admin privileges.
router.get('/geofences/my', requireAuth, async (req, res) => {
  try {
    const authUser = req.authUser!;

    // Find the employee record for this user
    const employee = await prisma.employee.findFirst({
      where: { email: authUser.email.toLowerCase() },
      select: {
        id: true,
        firstName: true,
        surname: true,
        email: true,
        branch: true,
        department: true,
        geofenceId: true,
        companyProfileId: true,
      },
    });

    // Fetch all active geofences for the employee's company
    const geofences = await prisma.geofence.findMany({
      where: {
        companyProfileId: employee?.companyProfileId ?? authUser.companyProfileId ?? '__none__',
        isActive: true,
      },
      orderBy: { name: 'asc' },
      select: {
        id: true,
        name: true,
        address: true,
        latitude: true,
        longitude: true,
        radiusMeters: true,
        isActive: true,
      },
    });

    res.json({
      employee: employee
        ? {
            id: employee.id,
            firstName: employee.firstName,
            surname: employee.surname,
            email: employee.email,
            branch: employee.branch,
            department: employee.department,
            geofenceId: employee.geofenceId,
          }
        : null,
      geofences,
    });
  } catch (err) {
    console.error('[settings] My geofences error:', err);
    internalError(res, 'fetching my geofences');
  }
});

// ── GET /geofences — list geofences with employee assignment counts (admin/manager/master only) ──
// Master (non-impersonating) is scoped to global geofences only (companyProfileId: null).
// Master must use Impersonate to manage tenant-specific geofences.
router.get('/geofences', requireAdminOrManager, async (req, res) => {
  try {
    const authUser = req.authUser!;
    // Master without a tenant context (not impersonating) sees only global geofences
    const tenantWhere =
      authUser.role === 'master' && !authUser.companyProfileId
        ? { companyProfileId: null }
        : { companyProfileId: authUser.companyProfileId ?? '__none__' };

    const geofences = await prisma.geofence.findMany({
      where: tenantWhere,
      orderBy: { name: 'asc' },
      include: {
        _count: {
          select: {
            employees: true,
          },
        },
      },
    });

    // Shape response with employee count
    const formatted = geofences.map((g) => ({
      id: g.id,
      name: g.name,
      address: g.address,
      latitude: g.latitude,
      longitude: g.longitude,
      radiusMeters: g.radiusMeters,
      isActive: g.isActive,
      companyProfileId: g.companyProfileId,
      createdAt: g.createdAt,
      updatedAt: g.updatedAt,
      employeeCount: g._count.employees,
    }));

    res.json({ geofences: formatted });
  } catch (err) {
    console.error('[settings] Geofences list error:', err);
    internalError(res, 'fetching geofences');
  }
});

// ── POST /geofences — create geofence (admin only) ──
router.post('/geofences', requireAdmin, validate(createGeofenceSchema), async (req, res) => {
  try {
    const authUser = req.authUser!;
    const data = req.body;

    const geofence = await prisma.geofence.create({
      data: { ...data, companyProfileId: authUser.companyProfileId },
    });

    logAudit({
      entity: 'Geofence',
      entityId: geofence.id,
      action: 'create',
      actorId: authUser.id,
      actorEmail: authUser.email,
      actorRole: authUser.role,
      ipAddress: getClientIp(req),
    });

    broadcastScoped('Geofence', 'create', geofence, { companyProfileId: authUser.companyProfileId });

    res.status(201).json({ geofence });
  } catch (err) {
    console.error('[settings] Geofence create error:', err);
    internalError(res, 'creating geofence');
  }
});

// ── PUT /geofences/:id — update geofence (admin only) ──
router.put('/geofences/:id', requireAdmin, validate(updateGeofenceSchema), async (req, res) => {
  try {
    const authUser = req.authUser!;
    const id = req.params.id as string;
    const data = req.body;

    const existing = await prisma.geofence.findUnique({ where: { id } });
    if (!existing) return notFound(res, 'Geofence');

    // Master without tenant context can only modify global geofences
    if (authUser.role === 'master' && !authUser.companyProfileId) {
      if (existing.companyProfileId !== null) {
        return accessDenied(res, 'Master cannot modify tenant geofences directly. Use Impersonate to manage company locations.');
      }
    } else if (existing.companyProfileId !== authUser.companyProfileId) {
      return accessDenied(res);
    }

    const geofence = await prisma.geofence.update({ where: { id }, data });

    logAudit({
      entity: 'Geofence',
      entityId: id,
      action: 'update',
      actorId: authUser.id,
      actorEmail: authUser.email,
      actorRole: authUser.role,
      ipAddress: getClientIp(req),
    });

    broadcastScoped('Geofence', 'update', geofence, { companyProfileId: authUser.companyProfileId });

    res.json({ geofence });
  } catch (err) {
    console.error('[settings] Geofence update error:', err);
    internalError(res, 'updating geofence');
  }
});

// ── POST /geofences/test-distance — test if coordinates fall within a geofence radius ──
// Used by the "Add Location" distance tester tool in the frontend.
// Accessible by any authenticated user (including employees) so they can
// verify their position against their assigned work location.
router.post('/geofences/test-distance', requireAuth, async (req, res) => {
  try {
    const authUser = req.authUser!;
    const { latitude, longitude, radiusMeters, geofenceId } = req.body as Record<string, unknown>;

    if (latitude == null || longitude == null || typeof latitude !== 'number' || typeof longitude !== 'number') {
      return badRequest(res, 'latitude and longitude are required numbers.');
    }
    if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
      return badRequest(res, 'Coordinates out of valid range.');
    }

    // If testing against an existing geofence
    if (typeof geofenceId === 'string' && geofenceId) {
      const gf = await prisma.geofence.findUnique({ where: { id: geofenceId } });
      if (!gf) return notFound(res, 'Geofence');
      if (authUser.role !== 'master' && gf.companyProfileId !== authUser.companyProfileId) {
        return accessDenied(res);
      }
      const distance = haversineDistance(latitude, longitude, gf.latitude, gf.longitude);
      const passed = distance <= gf.radiusMeters;
      return res.json({
        passed,
        distanceMetres: Math.round(distance),
        radiusMetres: gf.radiusMeters,
        geofenceName: gf.name,
        message: passed
          ? `✅ Within range — ${Math.round(distance)}m from "${gf.name}" centre (radius: ${gf.radiusMeters}m).`
          : `❌ Outside range — ${Math.round(distance)}m from "${gf.name}" centre (radius: ${gf.radiusMeters}m). Move ~${Math.round(distance - gf.radiusMeters)}m closer.`,
      });
    }

    // Test against arbitrary coordinates + radius (for new geofence preview)
    if (typeof radiusMeters !== 'number' || radiusMeters < 10 || radiusMeters > 100000) {
      return badRequest(res, 'radiusMeters must be between 10 and 100,000.');
    }

    // Compare against all company geofences AND the proposed centre
    // Master without tenant context is scoped to global geofences only
    const tenantWhere =
      authUser.role === 'master' && !authUser.companyProfileId
        ? { companyProfileId: null }
        : { companyProfileId: authUser.companyProfileId ?? '__none__' };
    const companyGeofences = await prisma.geofence.findMany({
      where: { ...tenantWhere, isActive: true },
      select: { id: true, name: true, latitude: true, longitude: true, radiusMeters: true },
    });

    const results = companyGeofences.map((gf) => {
      const distance = haversineDistance(latitude, longitude, gf.latitude, gf.longitude);
      return {
        geofenceId: gf.id,
        geofenceName: gf.name,
        distanceMetres: Math.round(distance),
        radiusMetres: gf.radiusMeters,
        withinRange: distance <= gf.radiusMeters,
      };
    });

    const withinAny = results.some((r) => r.withinRange);

    res.json({
      passed: withinAny,
      results,
      message: withinAny
        ? `✅ Test position is within range of ${results.filter((r) => r.withinRange).length} geofence(s).`
        : '❌ Test position is outside all active geofences.',
    });
  } catch (err) {
    console.error('[settings] Distance test error:', err);
    internalError(res, 'testing geofence distance');
  }
});

// ── GET /geocode — proxy address search via OpenStreetMap Nominatim ──
// Provides address-to-coordinates geocoding for the "Add Location" search feature.
// Accessible by any authenticated user (including employees) so they can
// search for addresses when adding a new work location.
router.get('/geocode', requireAuth, async (req, res) => {
  try {
    const q = (req.query.q as string || '').trim();
    if (!q || q.length < 2) {
      return badRequest(res, 'Search query "q" must be at least 2 characters.');
    }

    // Retry logic with exponential backoff for OpenStreetMap Nominatim rate limits (429)
    let response: Response | null = null;
    let retries = 3;
    let delay = 1000;

    for (let i = 0; i < retries; i++) {
      try {
        const url = `https://nominatim.openstreetmap.org/search?format=json&limit=5&q=${encodeURIComponent(q)}`;
        response = await fetch(url, {
          headers: {
            'User-Agent': 'TT-Workforce-App/1.0 (contact@ttworkforce.co)',
            'Accept-Language': 'en',
          },
        });
        if (response.ok) break;
        if (response.status === 429) {
          await new Promise((res) => setTimeout(res, delay * 2 * (i + 1)));
          continue;
        }
      } catch (err) {
        if (i === retries - 1) throw err;
      }
      await new Promise((res) => setTimeout(res, delay * (i + 1)));
    }

    if (!response || !response.ok) {
      return badGateway(res, 'Geocoding service unavailable after retries. Please try again or enter coordinates manually.');
    }

    const data = (await response.json()) as Array<{
      display_name: string;
      lat: string;
      lon: string;
      type?: string;
    }>;

    const results = data.map((item) => ({
      displayName: item.display_name,
      latitude: parseFloat(item.lat),
      longitude: parseFloat(item.lon),
      type: item.type || 'place',
    }));

    res.json({ results });
  } catch (err) {
    console.error('[settings] Geocode error:', err);
    badGateway(res, 'Geocoding service unavailable. Please try again later.');
  }
});

// ── POST /geofences/:id/assign-employees — assign employees to a geofence ──
router.post('/geofences/:id/assign-employees', requireAdmin, async (req, res) => {
  try {
    const authUser = req.authUser!;
    const id = req.params.id as string;
    const { employeeIds } = req.body as { employeeIds?: string[] };

    if (!Array.isArray(employeeIds) || employeeIds.length === 0) {
      return badRequest(res, 'employeeIds array is required.');
    }

    const geofence = await prisma.geofence.findUnique({ where: { id } });
    if (!geofence) return notFound(res, 'Geofence');

    // Master without tenant context cannot assign employees to tenant geofences
    if (authUser.role === 'master' && !authUser.companyProfileId) {
      if (geofence.companyProfileId !== null) {
        return accessDenied(res, 'Master cannot assign employees to tenant geofences directly. Use Impersonate to manage company locations.');
      }
    } else if (geofence.companyProfileId !== authUser.companyProfileId) {
      return accessDenied(res);
    }

    const result = await prisma.employee.updateMany({
      where: {
        id: { in: employeeIds },
        companyProfileId: geofence.companyProfileId ?? undefined,
      },
      data: { geofenceId: id },
    });

    logAudit({
      entity: 'Geofence',
      entityId: id,
      action: 'assign_employees',
      actorId: authUser.id,
      actorEmail: authUser.email,
      actorRole: authUser.role,
      justification: `Assigned ${result.count} employee(s) to "${geofence.name}"`,
      ipAddress: getClientIp(req),
    });

    res.json({ success: true, assignedCount: result.count, geofenceName: geofence.name });
  } catch (err) {
    console.error('[settings] Assign employees error:', err);
    internalError(res, 'assigning employees to geofence');
  }
});

// ── GET /employees-for-geofence — list employees with geofence assignment status ──
// Master (non-impersonating) sees no employees (cannot assign to tenant geofences).
router.get('/employees-for-geofence', requireAdminOrManager, async (req, res) => {
  try {
    const authUser = req.authUser!;
    // Master without tenant context sees no employees for geofence assignment
    const tenantWhere =
      authUser.role === 'master' && !authUser.companyProfileId
        ? { companyProfileId: '__none__' }
        : { companyProfileId: authUser.companyProfileId ?? '__none__' };

    const employees = await prisma.employee.findMany({
      where: tenantWhere,
      select: {
        id: true,
        firstName: true,
        surname: true,
        email: true,
        branch: true,
        department: true,
        geofenceId: true,
      },
      orderBy: { firstName: 'asc' },
    });

    res.json({ employees });
  } catch (err) {
    console.error('[settings] Employees for geofence error:', err);
    internalError(res, 'fetching employees for geofence');
  }
});

// ── GET /location-presets — list company-specific location presets ──
// Each company only sees their own presets. Master without tenant context sees none.
router.get('/location-presets', requireAdminOrManager, async (req, res) => {
  try {
    const authUser = req.authUser!;

    // Master without a tenant context (not impersonating) sees no presets
    if (authUser.role === 'master' && !authUser.companyProfileId) {
      return res.json({ presets: [] });
    }

    if (!authUser.companyProfileId) {
      return res.json({ presets: [] });
    }

    const presets = await prisma.locationPreset.findMany({
      where: { companyProfileId: authUser.companyProfileId },
      orderBy: { name: 'asc' },
    });

    res.json({ presets });
  } catch (err) {
    console.error('[settings] Location presets list error:', err);
    internalError(res, 'fetching location presets');
  }
});

// ── POST /location-presets — create a company-specific location preset (admin only) ──
router.post('/location-presets', requireAdmin, async (req, res) => {
  try {
    const authUser = req.authUser!;
    const { name, address, latitude, longitude, radiusMeters } = req.body as {
      name?: string;
      address?: string;
      latitude?: number;
      longitude?: number;
      radiusMeters?: number;
    };

    if (!authUser.companyProfileId) {
      return badRequest(res, 'No company context available.');
    }

    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      return badRequest(res, 'Preset name is required.');
    }
    if (latitude == null || longitude == null || typeof latitude !== 'number' || typeof longitude !== 'number') {
      return badRequest(res, 'latitude and longitude are required numbers.');
    }
    if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
      return badRequest(res, 'Coordinates out of valid range.');
    }

    const preset = await prisma.locationPreset.create({
      data: {
        name: name.trim(),
        address: address || null,
        latitude,
        longitude,
        radiusMeters: typeof radiusMeters === 'number' && radiusMeters >= 10 && radiusMeters <= 100000 ? radiusMeters : 200,
        companyProfileId: authUser.companyProfileId,
      },
    });

    logAudit({
      entity: 'LocationPreset',
      entityId: preset.id,
      action: 'create',
      actorId: authUser.id,
      actorEmail: authUser.email,
      actorRole: authUser.role,
      ipAddress: getClientIp(req),
    });

    res.status(201).json({ preset });
  } catch (err) {
    console.error('[settings] Location preset create error:', err);
    internalError(res, 'creating location preset');
  }
});

// ── DELETE /location-presets/:id — delete a company-specific location preset (admin only) ──
router.delete('/location-presets/:id', requireAdmin, async (req, res) => {
  try {
    const authUser = req.authUser!;
    const id = req.params.id as string;

    const existing = await prisma.locationPreset.findUnique({ where: { id } });
    if (!existing) return notFound(res, 'Preset');

    // Enforce tenant isolation: only the owning company can delete their preset
    if (existing.companyProfileId !== authUser.companyProfileId) {
      return accessDenied(res);
    }

    await prisma.locationPreset.delete({ where: { id } });

    logAudit({
      entity: 'LocationPreset',
      entityId: id,
      action: 'delete',
      actorId: authUser.id,
      actorEmail: authUser.email,
      actorRole: authUser.role,
      justification: `Deleted location preset: ${existing.name}`,
      ipAddress: getClientIp(req),
    });

    res.json({ success: true, deleted: id });
  } catch (err) {
    console.error('[settings] Location preset delete error:', err);
    internalError(res, 'deleting location preset');
  }
});

// ── DELETE /geofences/:id — delete geofence (admin only) ──
router.delete('/geofences/:id', requireAdmin, async (req, res) => {
  try {
    const authUser = req.authUser!;
    const id = req.params.id as string;

    const existing = await prisma.geofence.findUnique({ where: { id } });
    if (!existing) return notFound(res, 'Geofence');

    // Master without tenant context can only delete global geofences
    if (authUser.role === 'master' && !authUser.companyProfileId) {
      if (existing.companyProfileId !== null) {
        return accessDenied(res, 'Master cannot delete tenant geofences directly. Use Impersonate to manage company locations.');
      }
    } else if (existing.companyProfileId !== authUser.companyProfileId) {
      return accessDenied(res);
    }

    await prisma.geofence.delete({ where: { id } });

    logAudit({
      entity: 'Geofence',
      entityId: id,
      action: 'delete',
      actorId: authUser.id,
      actorEmail: authUser.email,
      actorRole: authUser.role,
      justification: `Deleted geofence: ${existing.name}`,
      ipAddress: getClientIp(req),
    });

    broadcastScoped('Geofence', 'delete', { id }, { companyProfileId: existing.companyProfileId });

    res.json({ success: true, deleted: id });
  } catch (err) {
    console.error('[settings] Geofence delete error:', err);
    internalError(res, 'deleting geofence');
  }
});

export default router;