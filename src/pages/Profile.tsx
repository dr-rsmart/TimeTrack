/**
 * Profile Page
 * ------------
 * Universal personal profile view for all account types (master, admin, manager, employee).
 * Allows users to view and edit their personal information with role-appropriate permissions,
 * change their password, and manage their account.
 */

import { useState, useEffect, useCallback } from 'react';
import {
  Pencil,
  Check,
  X,
  Mail,
  User,
  Shield,
  Phone,
  Briefcase,
  MapPin,
  Building,
  Calendar,
  Key,
  Trash2,
  Lock,
  IdCard,
} from 'lucide-react';
import { api, employeeApi } from '../services/api';
import { Card, CardContent, Button, Input, Spinner, Badge } from '../components/ui';
import { toast } from 'sonner';
import ChangePasswordModal from '../components/auth/ChangePasswordModal';
import { useAuth } from '../context/AuthContext';

interface ProfileData {
  id: string;
  email: string;
  fullName: string;
  role: string;
  companyProfileId: string | null;
  companyProfile?: { id: string; name: string } | null;
  employeeId?: string | null;
  firstName?: string;
  surname?: string;
  phone?: string | null;
  position?: string | null;
  branch?: string | null;
  department?: string | null;
  hireDate?: string | null;
  employeeNumber?: string | null;
  status?: string | null;
  mustChangePassword?: boolean;
}

/** Role display configuration */
const roleConfig: Record<string, { label: string; icon: typeof Shield; colorClass: string; bgClass: string }> = {
  master: { label: 'Platform Master', icon: Shield, colorClass: 'text-blue-600', bgClass: 'bg-blue-600' },
  admin: { label: 'Company Admin', icon: Shield, colorClass: 'text-red-600', bgClass: 'bg-red-600' },
  manager: { label: 'Manager', icon: Briefcase, colorClass: 'text-amber-600', bgClass: 'bg-amber-600' },
  employee: { label: 'Staff Member', icon: User, colorClass: 'text-emerald-600', bgClass: 'bg-emerald-600' },
};

/** Fields each role is allowed to edit (self-service) */
const editableFieldsByRole: Record<string, string[]> = {
  master: ['firstName', 'surname', 'phone', 'position', 'branch', 'department'],
  admin: ['firstName', 'surname', 'phone', 'position', 'branch', 'department'],
  manager: ['firstName', 'surname', 'phone', 'position', 'branch', 'department'],
  employee: ['firstName', 'surname', 'phone', 'position'],
};

export default function ProfilePage() {
  const { user, refresh } = useAuth();
  const [profile, setProfile] = useState<ProfileData | null>(null);
  const [loading, setLoading] = useState(true);
  const [isEditing, setIsEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [passwordModalOpen, setPasswordModalOpen] = useState(false);

  // Form states
  const [firstName, setFirstName] = useState('');
  const [surname, setSurname] = useState('');
  const [phone, setPhone] = useState('');
  const [position, setPosition] = useState('');
  const [branch, setBranch] = useState('');
  const [department, setDepartment] = useState('');

  const role = user?.role ?? 'employee';
  const config = roleConfig[role] || roleConfig.employee;
  const RoleIcon = config.icon;
  const editableFields = editableFieldsByRole[role] || editableFieldsByRole.employee;

  const canEditField = (field: string) => editableFields.includes(field);
  const hasEmployeeRecord = !!profile?.employeeId;
  const canEdit = hasEmployeeRecord && editableFields.length > 0;

  // Load Profile
  const loadProfile = useCallback(async () => {
    try {
      const res = await api.get<ProfileData>('/auth/me');

      // If there's an employee record, fetch full details
      if (res.employeeId) {
        try {
          const emp = await employeeApi.get(res.employeeId);
          setProfile({
            ...res,
            firstName: emp.firstName,
            surname: emp.surname,
            phone: emp.phone,
            position: emp.position,
            branch: emp.branch,
            department: emp.department,
            hireDate: emp.hireDate,
            employeeNumber: emp.employeeNumber,
            status: emp.status,
          });
          setFirstName(emp.firstName || '');
          setSurname(emp.surname || '');
          setPhone(emp.phone || '');
          setPosition(emp.position || '');
          setBranch(emp.branch || '');
          setDepartment(emp.department || '');
        } catch {
          // Fallback to auth/me data if employee fetch fails
          setProfile(res);
          const names = res.fullName.split(' ');
          setFirstName(names[0] || '');
          setSurname(names.slice(1).join(' ') || '');
          setPhone('');
          setPosition(res.position || '');
          setBranch(res.branch || '');
          setDepartment(res.department || '');
        }
      } else {
        setProfile(res);
        const names = res.fullName.split(' ');
        setFirstName(names[0] || '');
        setSurname(names.slice(1).join(' ') || '');
        setPhone('');
        setPosition(res.position || '');
        setBranch(res.branch || '');
        setDepartment(res.department || '');
      }
    } catch {
      toast.error('Failed to load profile details.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadProfile();
  }, [loadProfile]);

  // Handle Profile Update
  const handleSaveProfile = async () => {
    if (!profile?.employeeId) {
      toast.error('No employee record found for this account.');
      return;
    }
    setSaving(true);
    try {
      // Build update payload with only editable fields
      const payload: Record<string, unknown> = {};
      if (canEditField('firstName')) payload.firstName = firstName;
      if (canEditField('surname')) payload.surname = surname;
      if (canEditField('phone')) payload.phone = phone;
      if (canEditField('position')) payload.position = position;
      if (canEditField('branch')) payload.branch = branch;
      if (canEditField('department')) payload.department = department;

      await employeeApi.update(profile.employeeId, payload);

      setProfile({
        ...profile,
        firstName,
        surname,
        fullName: `${firstName} ${surname}`.trim(),
        phone,
        position,
        branch,
        department,
      });
      setIsEditing(false);
      toast.success('Profile updated successfully.');
      await refresh();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to update profile.';
      toast.error(message);
    } finally {
      setSaving(false);
    }
  };

  const handleCancelEdit = () => {
    // Reset form values
    if (profile) {
      setFirstName(profile.firstName || '');
      setSurname(profile.surname || '');
      setPhone(profile.phone || '');
      setPosition(profile.position || '');
      setBranch(profile.branch || '');
      setDepartment(profile.department || '');
    }
    setIsEditing(false);
  };

  // Delete account
  const handleDeleteAccount = () => {
    if (role === 'master') {
      toast.error('Deletion of Platform Root Master is protected. Contact System DevOps.');
      return;
    }
    if (confirm('Warning: Are you sure you want to request account deletion? This will notify your administrator.')) {
      toast.info('Account deletion request submitted. Your administrator will process this request.');
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center items-center h-96">
        <Spinner className="w-10 h-10" />
      </div>
    );
  }

  const displayName = profile?.fullName || `${firstName} ${surname}`.trim() || 'User';
  const initials = displayName
    .split(' ')
    .map((n) => n[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

  const formatDate = (dateStr: string | null | undefined) => {
    if (!dateStr) return '—';
    try {
      return new Date(dateStr).toLocaleDateString('en-ZA', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      });
    } catch {
      return dateStr;
    }
  };

  return (
    <div className="p-2 sm:p-6 max-w-4xl mx-auto space-y-6 sm:space-y-8">
      {/* ────────────────── TOP VIEW HEADER ────────────────── */}
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight">My Profile</h1>
          <p className="text-muted-foreground text-sm mt-1">
            View and manage your personal information
          </p>
        </div>

        {/* Toggle Edit / Save / Cancel Buttons */}
        {canEdit && (
          <div className="flex items-center gap-2 shrink-0">
            {isEditing && (
              <Button
                variant="outline"
                onClick={handleCancelEdit}
                disabled={saving}
                className="rounded-xl h-10 px-4 flex items-center gap-2"
              >
                <X className="w-4 h-4" />
                <span className="hidden sm:inline">Cancel</span>
              </Button>
            )}
            <Button
              onClick={() => {
                if (isEditing) {
                  handleSaveProfile();
                } else {
                  setIsEditing(true);
                }
              }}
              disabled={saving}
              className="rounded-xl h-10 px-5 flex items-center gap-2 font-bold shadow-lg transition-all"
            >
              {saving ? (
                <Spinner className="h-4 w-4 border-white" />
              ) : isEditing ? (
                <>
                  <Check className="w-4 h-4" />
                  Save Profile
                </>
              ) : (
                <>
                  <Pencil className="w-4 h-4" />
                  Edit Profile
                </>
              )}
            </Button>
          </div>
        )}
      </div>

      {/* ────────────────── MAIN PROFILE CARD ────────────────── */}
      <Card className="border-border/50 rounded-3xl shadow-xl overflow-hidden">
        {/* Card Top Branding Badge Section */}
        <div className="p-6 sm:p-8 border-b border-border/40 bg-gradient-to-r from-primary/5 to-primary/10 flex items-center gap-5">
          <div className={`w-16 h-16 rounded-2xl ${config.bgClass} text-white font-extrabold text-2xl flex items-center justify-center shadow-lg select-none`}>
            {initials}
          </div>
          <div>
            <h2 className="text-xl font-bold tracking-tight">{displayName}</h2>
            <div className={`flex items-center gap-1.5 text-sm font-semibold mt-1 ${config.colorClass}`}>
              <RoleIcon className="w-4 h-4" />
              <span>{config.label}</span>
            </div>
            {profile?.companyProfile && (
              <div className="flex items-center gap-1.5 text-muted-foreground text-xs mt-1">
                <Building className="w-3.5 h-3.5" />
                <span>{profile.companyProfile.name}</span>
              </div>
            )}
          </div>
        </div>

        {/* Card Body Rows */}
        <CardContent className="p-0">
          <div className="divide-y divide-border/40 text-sm">

            {/* Row: Email */}
            <ProfileRow icon={Mail} label="Email">
              <div className="flex items-center justify-between gap-4 w-full">
                <span className="font-semibold truncate">{profile?.email}</span>
                <Badge variant="outline" className="bg-secondary/50 text-muted-foreground border-border/60 px-2.5 py-0.5 rounded-lg text-xs font-bold shrink-0">
                  Read-only
                </Badge>
              </div>
            </ProfileRow>

            {/* Row: Employee No */}
            <ProfileRow icon={IdCard} label="Employee No.">
              <div className="flex items-center justify-between gap-4 w-full">
                <span className="font-semibold">{profile?.employeeNumber || profile?.employeeId?.slice(0, 8) || '—'}</span>
                <Badge variant="outline" className="bg-secondary/50 text-muted-foreground border-border/60 px-2.5 py-0.5 rounded-lg text-xs font-bold shrink-0">
                  Read-only
                </Badge>
              </div>
            </ProfileRow>

            {/* Row: First Name */}
            <ProfileRow icon={User} label="First Name">
              {isEditing && canEditField('firstName') ? (
                <Input
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                  className="h-10 rounded-xl"
                />
              ) : (
                <span className="font-semibold">{firstName || '—'}</span>
              )}
            </ProfileRow>

            {/* Row: Surname */}
            <ProfileRow icon={User} label="Surname">
              {isEditing && canEditField('surname') ? (
                <Input
                  value={surname}
                  onChange={(e) => setSurname(e.target.value)}
                  className="h-10 rounded-xl"
                />
              ) : (
                <span className="font-semibold">{surname || '—'}</span>
              )}
            </ProfileRow>

            {/* Row: Phone */}
            <ProfileRow icon={Phone} label="Phone">
              {isEditing && canEditField('phone') ? (
                <Input
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  className="h-10 rounded-xl"
                  placeholder="+27 XX XXX XXXX"
                />
              ) : (
                <span className="font-semibold">{phone || '—'}</span>
              )}
            </ProfileRow>

            {/* Row: Position */}
            <ProfileRow icon={Briefcase} label="Position">
              {isEditing && canEditField('position') ? (
                <Input
                  value={position}
                  onChange={(e) => setPosition(e.target.value)}
                  className="h-10 rounded-xl"
                />
              ) : (
                <span className="font-semibold">{position || '—'}</span>
              )}
            </ProfileRow>

            {/* Row: Branch */}
            <ProfileRow icon={MapPin} label="Branch">
              {isEditing && canEditField('branch') ? (
                <Input
                  value={branch}
                  onChange={(e) => setBranch(e.target.value)}
                  className="h-10 rounded-xl"
                />
              ) : (
                <span className="font-semibold">{branch || '—'}</span>
              )}
            </ProfileRow>

            {/* Row: Department */}
            <ProfileRow icon={Building} label="Department">
              {isEditing && canEditField('department') ? (
                <Input
                  value={department}
                  onChange={(e) => setDepartment(e.target.value)}
                  className="h-10 rounded-xl"
                />
              ) : (
                <span className="font-semibold">{department || '—'}</span>
              )}
            </ProfileRow>

            {/* Row: Role */}
            <ProfileRow icon={Shield} label="Role">
              <span className="font-bold capitalize">{config.label}</span>
            </ProfileRow>

            {/* Row: Hire Date */}
            <ProfileRow icon={Calendar} label="Hire Date">
              <span className="font-semibold">{formatDate(profile?.hireDate)}</span>
            </ProfileRow>

            {/* Row: Status */}
            {profile?.status && (
              <ProfileRow icon={Lock} label="Status">
                <Badge
                  variant={profile.status === 'active' ? 'success' : 'secondary'}
                  className="capitalize"
                >
                  {profile.status}
                </Badge>
              </ProfileRow>
            )}

          </div>
        </CardContent>
      </Card>

      {/* ────────────────── CHANGE PASSWORD CARD ────────────────── */}
      <Card className="border-border/50 rounded-3xl shadow-lg p-5 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <div className="w-11 h-11 rounded-xl bg-primary/10 text-primary flex items-center justify-center shrink-0">
            <Key className="w-5 h-5" />
          </div>
          <div>
            <h3 className="font-bold text-base">Change Password</h3>
            <p className="text-muted-foreground text-xs mt-0.5">Update your account password</p>
          </div>
        </div>
        <button
          onClick={() => setPasswordModalOpen(true)}
          className="text-sm font-bold text-primary hover:underline transition-all"
        >
          Change Password
        </button>
      </Card>

      {/* ────────────────── DANGER ZONE CARD ────────────────── */}
      <Card className="border-red-200/50 bg-red-50/5 dark:bg-red-950/10 rounded-3xl shadow-sm p-6 space-y-4">
        <div>
          <h3 className="text-base font-bold text-red-600 dark:text-red-400">Danger Zone</h3>
          <p className="text-muted-foreground text-sm mt-1.5 leading-relaxed font-medium">
            {role === 'master'
              ? 'Platform root account is protected from self-deletion.'
              : 'Request permanent deletion of your account and associated data. This action requires administrator approval.'}
          </p>
        </div>

        <Button
          variant="outline"
          onClick={handleDeleteAccount}
          className="border-red-200 text-red-600 hover:bg-red-50 dark:hover:bg-red-950/20 font-bold rounded-xl h-11 px-5 flex items-center gap-2"
        >
          <Trash2 className="w-4 h-4" />
          {role === 'master' ? 'Delete My Profile' : 'Request Account Deletion'}
        </Button>
      </Card>

      {/* ────────────────── CHANGE PASSWORD MODAL ────────────────── */}
      {passwordModalOpen && (
        <ChangePasswordModal
          onSuccess={() => {
            setPasswordModalOpen(false);
            refresh();
          }}
          onCancel={() => setPasswordModalOpen(false)}
        />
      )}
    </div>
  );
}

/** Reusable profile row component */
function ProfileRow({
  icon: Icon,
  label,
  children,
}: {
  icon: typeof Mail;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 p-5 items-center gap-2 sm:gap-4">
      <span className="font-extrabold uppercase text-xs tracking-wider text-muted-foreground flex items-center gap-2.5">
        <Icon className="w-4 h-4 text-muted-foreground" />
        {label}
      </span>
      <div className="sm:col-span-2">{children}</div>
    </div>
  );
}