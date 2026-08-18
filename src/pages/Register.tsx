/**
 * Register Page (Tenant Onboarding & Master Operator Management)
 * -------------------------------------------------------------
 * Tabbed platform operator interface for:
 * 1. Onboarding & configuring business tenant workspaces
 * 2. Creating and managing Master operator accounts
 */

import { useCallback, useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import {
  Building2,
  Users,
  Search,
  Plus,
  Pencil,
  Trash2,
  ToggleLeft,
  ToggleRight,
  ExternalLink,
  ShieldCheck,
  UserPlus,
  Camera,
  KeyRound,
  Copy,
} from 'lucide-react';
import { toast } from 'sonner';
import { masterApi, type CompanyDetail, type MasterOperator } from '../services/api';
import { useAuth } from '../context/AuthContext';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
  Badge,
  Button,
  Input,
  Label,
  Modal,
  Select,
  Spinner,
  EmptyState,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../components/ui';

// Empty structures for modals
const emptyCompanyForm = {
  name: '',
  primaryContactName: '',
  phone: '',
  billingTier: 'standard',
  vatNumber: '',
  registrationNumber: '',
  address: '',
  adminEmail: '',
  adminFirstName: '',
  adminSurname: '',
};

const emptyOperatorForm = {
  fullName: '',
  email: '',
  firstName: '',
  surname: '',
  role: 'master',
};

export default function Register() {
  const { refresh: refreshAuth } = useAuth();
  
  // Tabs: 'onboarding' | 'master-accounts'
  const [activeTab, setActiveTab] = useState<'onboarding' | 'master-accounts'>('onboarding');

  // Onboarding Tab State
  const [companies, setCompanies] = useState<CompanyDetail[]>([]);
  const [companySearch, setCompanySearch] = useState('');
  const [loadingCompanies, setLoadingCompanies] = useState(true);

  // Master Accounts Tab State
  const [operators, setOperators] = useState<MasterOperator[]>([]);
  const [operatorSearch, setOperatorSearch] = useState('');
  const [loadingOperators, setLoadingOperators] = useState(false);

  // Modals State
  const [companyModalOpen, setCompanyModalOpen] = useState(false);
  const [editingCompany, setEditingCompany] = useState<CompanyDetail | null>(null);
  const [companyForm, setCompanyForm] = useState(emptyCompanyForm);
  const [savingCompany, setSavingCompany] = useState(false);

  const [operatorModalOpen, setOperatorModalOpen] = useState(false);
  const [operatorForm, setOperatorForm] = useState(emptyOperatorForm);
  const [savingOperator, setSavingOperator] = useState(false);

  // Temporary password reveal modal (shown after create / reset)
  const [tempPasswordInfo, setTempPasswordInfo] = useState<{ email: string; password: string } | null>(null);

  // Fetch Companies
  const fetchCompanies = useCallback(async () => {
    setLoadingCompanies(true);
    try {
      const res = await masterApi.listCompanies();
      setCompanies(res.items);
    } catch (err) {
      toast.error('Failed to load registered companies');
      console.error(err);
    } finally {
      setLoadingCompanies(false);
    }
  }, []);

  // Fetch Master Operators
  const fetchOperators = useCallback(async () => {
    setLoadingOperators(true);
    try {
      const res = await masterApi.listOperators();
      setOperators(res.items);
    } catch (err) {
      toast.error('Failed to load master operators');
      console.error(err);
    } finally {
      setLoadingOperators(false);
    }
  }, []);

  useEffect(() => {
    if (activeTab === 'onboarding') {
      fetchCompanies();
    } else {
      fetchOperators();
    }
  }, [activeTab, fetchCompanies, fetchOperators]);

  // Handle Company Create/Update Submit
  const handleCompanySubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!companyForm.name || !companyForm.adminEmail || !companyForm.adminFirstName || !companyForm.adminSurname) {
      toast.error('Please fill in all required fields.');
      return;
    }

    setSavingCompany(true);
    try {
      if (editingCompany) {
        const res = await masterApi.updateCompany(editingCompany.id, companyForm);
        toast.success('Company profile updated successfully.');
        // A brand-new admin account was created during reassignment —
        // surface the one-time temporary password to the master.
        if (res.temporaryPassword && res.adminEmail) {
          setTempPasswordInfo({ email: res.adminEmail, password: res.temporaryPassword });
        }
      } else {
        await masterApi.onboardCompany(companyForm);
        toast.success('Tenant company successfully onboarded.');
      }
      setCompanyModalOpen(false);
      setEditingCompany(null);
      setCompanyForm(emptyCompanyForm);
      fetchCompanies();
    } catch (err: any) {
      toast.error(err.message || 'Failed to onboard company');
      console.error(err);
    } finally {
      setSavingCompany(false);
    }
  };

  // Open Edit Modal
  const openEditCompany = (company: CompanyDetail) => {
    setEditingCompany(company);
    // Split full name if possible
    let fName = '';
    let sName = '';
    if (company.adminFullName && company.adminFullName !== 'N/A') {
      const parts = company.adminFullName.split(' ');
      fName = parts[0] || '';
      sName = parts.slice(1).join(' ') || '';
    }
    setCompanyForm({
      name: company.name,
      primaryContactName: company.primaryContactName || '',
      phone: company.phone || '',
      billingTier: company.billingTier || 'standard',
      vatNumber: company.vatNumber || '',
      registrationNumber: company.registrationNumber || '',
      address: company.address || '',
      adminEmail: company.adminEmail === 'N/A' ? '' : company.adminEmail,
      adminFirstName: fName,
      adminSurname: sName,
    });
    setCompanyModalOpen(true);
  };

  // Handle Suspension Toggle
  const handleToggleSuspension = async (company: CompanyDetail) => {
    try {
      const res = await masterApi.toggleCompany(company.id);
      toast.success(res.message);
      fetchCompanies();
    } catch (err: any) {
      toast.error(err.message || 'Failed to toggle status');
      console.error(err);
    }
  };

  // Handle Delete
  const handleDeleteCompany = async (company: CompanyDetail) => {
    if (!confirm(`Are you absolutely sure you want to permanently delete "${company.name}" and all of its workforce records? This cannot be undone.`)) {
      return;
    }
    try {
      await masterApi.deleteCompany(company.id);
      toast.success('Tenant company permanently deleted.');
      fetchCompanies();
    } catch (err: any) {
      toast.error(err.message || 'Failed to delete company');
      console.error(err);
    }
  };

  // Handle Operator Create Submit
  const handleOperatorSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!operatorForm.fullName || !operatorForm.email) {
      toast.error('Please fill in required fields.');
      return;
    }

    setSavingOperator(true);
    try {
      const res = await masterApi.createOperator(operatorForm);
      toast.success('New Platform Master operator registered.');
      setOperatorModalOpen(false);
      setOperatorForm(emptyOperatorForm);
      // Surface the one-time temporary password so the operator can log in
      setTempPasswordInfo({ email: res.operator.email, password: res.temporaryPassword });
      fetchOperators();
    } catch (err: any) {
      toast.error(err.message || 'Failed to create operator');
      console.error(err);
    } finally {
      setSavingOperator(false);
    }
  };

  // Handle Operator Password Reset
  const handleResetOperatorPassword = async (op: MasterOperator) => {
    if (!confirm(`Reset the password for ${op.email}? A new temporary password will be generated.`)) {
      return;
    }
    try {
      const res = await masterApi.resetOperatorPassword(op.id);
      setTempPasswordInfo({ email: op.email, password: res.temporaryPassword });
    } catch (err: any) {
      toast.error(err.message || 'Failed to reset operator password');
      console.error(err);
    }
  };

  const copyTempPassword = async () => {
    if (!tempPasswordInfo) return;
    try {
      await navigator.clipboard.writeText(tempPasswordInfo.password);
      toast.success('Temporary password copied to clipboard.');
    } catch {
      toast.error('Could not copy — please select and copy manually.');
    }
  };

  // Impersonate
  const handleImpersonate = async (company: CompanyDetail) => {
    try {
      await masterApi.impersonate(company.id);
      toast.success(`Entering Impersonation: ${company.name}`);
      await refreshAuth();
      // Redirect to dashboard
      window.location.href = '/';
    } catch (err: any) {
      toast.error(err.message || 'Failed to impersonate tenant');
    }
  };

  // Filters
  const filteredCompanies = companies.filter((c) =>
    c.name.toLowerCase().includes(companySearch.toLowerCase()) ||
    c.adminEmail.toLowerCase().includes(companySearch.toLowerCase()) ||
    c.id.toLowerCase().includes(companySearch.toLowerCase())
  );

  const filteredOperators = operators.filter((o) =>
    o.fullName.toLowerCase().includes(operatorSearch.toLowerCase()) ||
    o.email.toLowerCase().includes(operatorSearch.toLowerCase())
  );

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      {/* Title Header */}
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Register</h1>
        <p className="text-muted-foreground text-sm">
          Onboard new tenant companies, manage employee directories, and coordinate shifts
        </p>
      </div>

      {/* Tabs Switcher */}
      <div className="flex border-b border-border/40 pb-px gap-2">
        <button
          onClick={() => setActiveTab('onboarding')}
          className={`flex items-center gap-2 px-4 py-2.5 border-b-2 text-sm font-semibold transition-all duration-200 ${
            activeTab === 'onboarding'
              ? 'border-brand text-brand font-bold bg-brand/5 rounded-t-xl'
              : 'border-transparent text-muted-foreground hover:text-foreground'
          }`}
        >
          <Building2 className="w-4 h-4" />
          Onboarding
        </button>
        <button
          onClick={() => setActiveTab('master-accounts')}
          className={`flex items-center gap-2 px-4 py-2.5 border-b-2 text-sm font-semibold transition-all duration-200 ${
            activeTab === 'master-accounts'
              ? 'border-brand text-brand font-bold bg-brand/5 rounded-t-xl'
              : 'border-transparent text-muted-foreground hover:text-foreground'
          }`}
        >
          <Users className="w-4 h-4" />
          Master Accounts
        </button>
      </div>

      {/* ────────────────── ONBOARDING TAB ────────────────── */}
      {activeTab === 'onboarding' && (
        <div className="space-y-4">
          <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
            {/* Search Input */}
            <div className="relative w-full sm:max-w-md">
              <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted-foreground w-4.5 h-4.5 pointer-events-none" />
              <Input
                type="text"
                placeholder="Search company name, contact, or tenant ID..."
                value={companySearch}
                onChange={(e) => setCompanySearch(e.target.value)}
                className="pl-10 h-10.5 rounded-xl border-border/60 bg-card"
              />
            </div>

            {/* Onboard Company Button */}
            <Button
              onClick={() => {
                setEditingCompany(null);
                setCompanyForm(emptyCompanyForm);
                setCompanyModalOpen(true);
              }}
              className="bg-brand hover:bg-brand-dark text-white shadow-lg shadow-brand/20 h-10.5 px-5 rounded-xl flex items-center gap-2 shrink-0"
            >
              <Plus className="w-4 h-4" />
              Onboard Company
            </Button>
          </div>

          {loadingCompanies ? (
            <div className="flex items-center justify-center min-h-[40vh]">
              <Spinner className="h-10 w-10" />
            </div>
          ) : filteredCompanies.length === 0 ? (
            <EmptyState message={companySearch ? "No matching companies found." : "No companies registered. Click 'Onboard Company' to register."} />
          ) : (
            <div className="grid gap-5 md:grid-cols-2">
              {filteredCompanies.map((company) => {
                const initial = company.name.trim().charAt(0).toUpperCase() || 'C';
                return (
                  <motion.div
                    key={company.id}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="relative p-5 rounded-2xl bg-card border border-border/40 hover:border-brand/35 transition-all duration-300 shadow-sm flex flex-col justify-between gap-4"
                  >
                    {/* Left vertical status indicator */}
                    <div
                      className={`absolute top-0 bottom-0 left-0 w-1 rounded-l-2xl ${
                        company.isActive ? 'bg-emerald-500' : 'bg-red-500'
                      }`}
                    />

                    <div className="flex items-start justify-between">
                      {/* Avatar & Info */}
                      <div className="flex items-center gap-4">
                        <div className="w-12 h-12 rounded-xl bg-brand/10 text-brand flex items-center justify-center font-bold text-lg select-none">
                          {initial}
                        </div>
                        <div>
                          <div className="flex items-center gap-2 flex-wrap">
                            <h3 className="font-bold text-base tracking-tight text-foreground">
                              {company.name}
                            </h3>
                            <Badge variant="outline" className="uppercase text-[10px] bg-brand/5 text-brand border-brand/15 px-2 py-0">
                              {company.billingTier}
                            </Badge>
                            {!company.isActive && (
                              <Badge variant="destructive" className="uppercase text-[10px] font-bold px-2 py-0 bg-red-100 text-red-800 border-red-200">
                                SUSPENDED
                              </Badge>
                            )}
                          </div>
                          <p className="text-xs text-muted-foreground font-medium mt-1">
                            —
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {company.adminEmail}
                          </p>
                        </div>
                      </div>

                      {/* Action Triggers */}
                      <div className="flex items-center gap-1">
                        {/* Impersonate */}
                        <button
                          onClick={() => handleImpersonate(company)}
                          className="p-2 rounded-lg text-muted-foreground hover:text-brand hover:bg-brand/5 transition-colors"
                          title="Impersonate"
                        >
                          <ExternalLink className="w-4 h-4" />
                        </button>

                        {/* Toggle Suspend */}
                        <button
                          onClick={() => handleToggleSuspension(company)}
                          className={`p-2 rounded-lg transition-colors ${
                            company.isActive
                              ? 'text-emerald-500 hover:bg-emerald-50'
                              : 'text-red-500 hover:bg-red-50'
                          }`}
                          title={company.isActive ? 'Suspend' : 'Unsuspend'}
                        >
                          {company.isActive ? (
                            <ToggleRight className="w-5 h-5 text-emerald-600" />
                          ) : (
                            <ToggleLeft className="w-5 h-5 text-red-500" />
                          )}
                        </button>

                        {/* Edit */}
                        <button
                          onClick={() => openEditCompany(company)}
                          className="p-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
                          title="Edit Profile"
                        >
                          <Pencil className="w-4 h-4" />
                        </button>

                        {/* Delete */}
                        <button
                          onClick={() => handleDeleteCompany(company)}
                          className="p-2 rounded-lg text-muted-foreground hover:text-red-600 hover:bg-red-50 transition-colors"
                          title="Delete Company"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  </motion.div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ────────────────── MASTER ACCOUNTS TAB ────────────────── */}
      {activeTab === 'master-accounts' && (
        <div className="space-y-4">
          <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
            {/* Search Input */}
            <div className="relative w-full sm:max-w-md">
              <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted-foreground w-4.5 h-4.5 pointer-events-none" />
              <Input
                type="text"
                placeholder="Search by name, email, or position..."
                value={operatorSearch}
                onChange={(e) => setOperatorSearch(e.target.value)}
                className="pl-10 h-10.5 rounded-xl border-border/60 bg-card"
              />
            </div>

            {/* Add Master Account Button */}
            <Button
              onClick={() => {
                setOperatorForm(emptyOperatorForm);
                setOperatorModalOpen(true);
              }}
              className="bg-brand hover:bg-brand-dark text-white shadow-lg shadow-brand/20 h-10.5 px-5 rounded-xl flex items-center gap-2 shrink-0"
            >
              <Plus className="w-4 h-4" />
              Add Master Account
            </Button>
          </div>

          {loadingOperators ? (
            <div className="flex items-center justify-center min-h-[40vh]">
              <Spinner className="h-10 w-10" />
            </div>
          ) : filteredOperators.length === 0 ? (
            <EmptyState message="No Master Accounts registered yet." />
          ) : (
            <Card className="border-border/40 overflow-hidden rounded-2xl shadow-sm">
              <Table>
                <TableHeader>
                  <TableRow>
                  <TableHead>Full Name</TableHead>
                    <TableHead>Email</TableHead>
                    <TableHead>Role</TableHead>
                    <TableHead>Registered</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredOperators.map((op) => (
                    <TableRow key={op.id} className="hover:bg-secondary/15 transition-colors">
                      <TableCell className="font-semibold">{op.fullName}</TableCell>
                      <TableCell>{op.email}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className="bg-brand/10 text-brand border-brand/20">
                          {op.role}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-muted-foreground text-sm">
                        {new Date(op.createdAt).toLocaleDateString()}
                      </TableCell>
                      <TableCell className="text-right">
                        <button
                          onClick={() => handleResetOperatorPassword(op)}
                          className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold text-muted-foreground hover:text-brand hover:bg-brand/5 border border-transparent hover:border-brand/20 transition-colors"
                          title="Reset password"
                        >
                          <KeyRound className="w-3.5 h-3.5" />
                          Reset Password
                        </button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Card>
          )}
        </div>
      )}

      {/* ────────────────── ADD / EDIT COMPANY MODAL ────────────────── */}
      <Modal
        open={companyModalOpen}
        onClose={() => setCompanyModalOpen(false)}
        title={editingCompany ? `Edit Company Profile: ${editingCompany.name}` : "Onboard Tenant Company"}
        wide
      >
        <form onSubmit={handleCompanySubmit} className="space-y-6 pt-4 max-h-[75vh] overflow-y-auto px-1">
          {/* Section 1: Company Profile Details */}
          <div className="space-y-4">
            <h3 className="text-sm font-bold tracking-wide uppercase text-brand flex items-center gap-2 border-b border-border/40 pb-1.5">
              <Building2 className="w-4 h-4" />
              Company Profile Details
            </h3>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="company-name" className="text-xs uppercase font-bold tracking-wide text-muted-foreground">Company Name *</Label>
                <Input
                  id="company-name"
                  required
                  placeholder="e.g. Acme Corp"
                  value={companyForm.name}
                  onChange={(e) => setCompanyForm({ ...companyForm, name: e.target.value })}
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="company-contact" className="text-xs uppercase font-bold tracking-wide text-muted-foreground">Primary Contact Name</Label>
                <Input
                  id="company-contact"
                  placeholder="e.g. Ricardo Smart"
                  value={companyForm.primaryContactName}
                  onChange={(e) => setCompanyForm({ ...companyForm, primaryContactName: e.target.value })}
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="company-phone" className="text-xs uppercase font-bold tracking-wide text-muted-foreground">Company Phone</Label>
                <Input
                  id="company-phone"
                  placeholder="e.g. +27 11 123 4567"
                  value={companyForm.phone}
                  onChange={(e) => setCompanyForm({ ...companyForm, phone: e.target.value })}
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="company-tier" className="text-xs uppercase font-bold tracking-wide text-muted-foreground">Billing Tier Option</Label>
                <Select
                  id="company-tier"
                  value={companyForm.billingTier}
                  onChange={(e) => setCompanyForm({ ...companyForm, billingTier: e.target.value })}
                >
                  <option value="standard">Standard Plan (Up to 100 staff)</option>
                  <option value="enterprise">Enterprise Plan</option>
                  <option value="custom">Custom Partner Plan</option>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="company-vat" className="text-xs uppercase font-bold tracking-wide text-muted-foreground">VAT Tax Number</Label>
                <Input
                  id="company-vat"
                  placeholder="e.g. VAT-450912389"
                  value={companyForm.vatNumber}
                  onChange={(e) => setCompanyForm({ ...companyForm, vatNumber: e.target.value })}
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="company-reg" className="text-xs uppercase font-bold tracking-wide text-muted-foreground">Reg Registration Number</Label>
                <Input
                  id="company-reg"
                  placeholder="e.g. 2024/091234/07"
                  value={companyForm.registrationNumber}
                  onChange={(e) => setCompanyForm({ ...companyForm, registrationNumber: e.target.value })}
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="company-address" className="text-xs uppercase font-bold tracking-wide text-muted-foreground">Corporate Headquarters Address</Label>
              <Input
                id="company-address"
                placeholder="e.g. 100 Rivonia Road, Sandton, Johannesburg"
                value={companyForm.address}
                onChange={(e) => setCompanyForm({ ...companyForm, address: e.target.value })}
              />
            </div>
          </div>

          {/* Section 2: Default Tenant Administrator Account */}
          <div className="space-y-4 bg-secondary/15 p-4 rounded-xl border border-border/25">
            <h3 className="text-sm font-bold tracking-wide uppercase text-brand flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-brand" />
              Default Tenant Administrator Account
            </h3>

            <div className="space-y-1.5">
              <Label htmlFor="admin-fullname" className="text-xs uppercase font-bold tracking-wide text-muted-foreground">Admin Full Name</Label>
              <Input
                id="admin-fullname"
                disabled
                className="bg-secondary/40 font-semibold cursor-not-allowed text-muted-foreground"
                value={`${companyForm.adminFirstName} ${companyForm.adminSurname}`.trim() || 'Admin User'}
              />
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="admin-fname" className="text-xs uppercase font-bold tracking-wide text-muted-foreground">Admin First Name *</Label>
                <Input
                  id="admin-fname"
                  required
                  placeholder="Admin"
                  value={companyForm.adminFirstName}
                  onChange={(e) => setCompanyForm({ ...companyForm, adminFirstName: e.target.value })}
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="admin-surname" className="text-xs uppercase font-bold tracking-wide text-muted-foreground">Admin Surname *</Label>
                <Input
                  id="admin-surname"
                  required
                  placeholder="User"
                  value={companyForm.adminSurname}
                  onChange={(e) => setCompanyForm({ ...companyForm, adminSurname: e.target.value })}
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="admin-email" className="text-xs uppercase font-bold tracking-wide text-muted-foreground">Admin Email Address *</Label>
              <Input
                id="admin-email"
                required
                type="email"
                placeholder="admin@timetrack.com"
                value={companyForm.adminEmail}
                onChange={(e) => setCompanyForm({ ...companyForm, adminEmail: e.target.value })}
              />
            </div>
          </div>

          {/* Actions */}
          <div className="flex justify-end gap-3 pt-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => setCompanyModalOpen(false)}
              className="rounded-xl px-5 h-11"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={savingCompany}
              className="bg-brand hover:bg-brand-dark text-white shadow-lg shadow-brand/20 rounded-xl px-6 h-11"
            >
              {savingCompany ? <Spinner className="h-5 w-5 border-white" /> : editingCompany ? 'Save Changes' : 'Onboard Company'}
            </Button>
          </div>
        </form>
      </Modal>

      {/* ────────────────── ADD MASTER OPERATOR MODAL ────────────────── */}
      <Modal
        open={operatorModalOpen}
        onClose={() => setOperatorModalOpen(false)}
        title="Add Master Account"
      >
        <form onSubmit={handleOperatorSubmit} className="space-y-5 pt-4">
          {/* Mock Profile Photo Picker */}
          <div className="flex items-center gap-4 bg-secondary/15 p-4 rounded-xl border border-border/25">
            <div className="w-14 h-14 rounded-full bg-brand/10 text-brand flex items-center justify-center font-bold text-lg border-2 border-brand/20 shrink-0">
              ?
            </div>
            <div>
              <p className="text-xs font-bold text-foreground">Profile Photo</p>
              <p className="text-[10px] text-muted-foreground mt-0.5">Click to upload (max 2MB)</p>
            </div>
            <button type="button" className="ml-auto p-2 rounded-lg hover:bg-brand/5 text-brand" title="Upload Photo">
              <Camera className="w-5 h-5" />
            </button>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="op-fullname" className="text-xs uppercase font-bold tracking-wide text-muted-foreground">Full Name *</Label>
            <Input
              id="op-fullname"
              required
              placeholder="e.g. Platform Master Admin"
              value={operatorForm.fullName}
              onChange={(e) => {
                const names = e.target.value.split(' ');
                setOperatorForm({
                  ...operatorForm,
                  fullName: e.target.value,
                  firstName: names[0] || '',
                  surname: names.slice(1).join(' ') || '',
                });
              }}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="op-email" className="text-xs uppercase font-bold tracking-wide text-muted-foreground">Email *</Label>
            <Input
              id="op-email"
              required
              type="email"
              placeholder="e.g. master@smartpatel.co.za"
              value={operatorForm.email}
              onChange={(e) => setOperatorForm({ ...operatorForm, email: e.target.value })}
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="op-fname" className="text-xs uppercase font-bold tracking-wide text-muted-foreground">First Name</Label>
              <Input
                id="op-fname"
                placeholder="e.g. John"
                value={operatorForm.firstName}
                onChange={(e) => setOperatorForm({ ...operatorForm, firstName: e.target.value, fullName: `${e.target.value} ${operatorForm.surname}`.trim() })}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="op-surname" className="text-xs uppercase font-bold tracking-wide text-muted-foreground">Surname</Label>
              <Input
                id="op-surname"
                placeholder="e.g. Doe"
                value={operatorForm.surname}
                onChange={(e) => setOperatorForm({ ...operatorForm, surname: e.target.value, fullName: `${operatorForm.firstName} ${e.target.value}`.trim() })}
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="op-role" className="text-xs uppercase font-bold tracking-wide text-muted-foreground">Role</Label>
            <Select
              id="op-role"
              value={operatorForm.role}
              onChange={(e) => setOperatorForm({ ...operatorForm, role: e.target.value })}
            >
              <option value="master">Master</option>
            </Select>
          </div>

          <div className="flex justify-end gap-3 pt-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => setOperatorModalOpen(false)}
              className="rounded-xl px-5 h-11"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={savingOperator}
              className="bg-brand hover:bg-brand-dark text-white shadow-lg shadow-brand/20 rounded-xl px-6 h-11 flex items-center gap-2"
            >
              {savingOperator ? <Spinner className="h-5 w-5 border-white" /> : (
                <>
                  <UserPlus className="w-4 h-4" />
                  Add Master Account
                </>
              )}
            </Button>
          </div>
        </form>
      </Modal>

      {/* ────────────────── TEMPORARY PASSWORD MODAL ────────────────── */}
      <Modal
        open={!!tempPasswordInfo}
        onClose={() => setTempPasswordInfo(null)}
        title="Temporary Password"
      >
        {tempPasswordInfo && (
          <div className="space-y-4 pt-2">
            <p className="text-sm text-muted-foreground">
              Share this one-time password with <span className="font-semibold text-foreground">{tempPasswordInfo.email}</span>.
              They will be required to change it on first login.
            </p>
            <div className="flex items-center gap-2 p-3 rounded-xl bg-secondary/40 border border-border/40">
              <code className="flex-1 text-sm font-mono font-bold break-all select-all">
                {tempPasswordInfo.password}
              </code>
              <button
                onClick={copyTempPassword}
                className="p-2 rounded-lg text-muted-foreground hover:text-brand hover:bg-brand/5 transition-colors shrink-0"
                title="Copy to clipboard"
              >
                <Copy className="w-4 h-4" />
              </button>
            </div>
            <div className="flex justify-end">
              <Button onClick={() => setTempPasswordInfo(null)} className="rounded-xl px-6 h-10">
                Done
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
