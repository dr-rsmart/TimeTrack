/**
 * Demo Simulation Page
 * --------------------
 * Exclusive Simulator Panel only accessible to the Platform Master.
 * Allows quick impersonation/simulation logins across standard workforce personas.
 */

import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  Sparkles,
  ShieldCheck,
  UserCog,
  Users,
  User,
  ArrowRight,
  HelpCircle,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { Card, CardContent, CardHeader, CardTitle, CardDescription, Button, Spinner } from '../components/ui';
import { toast } from 'sonner';
import { masterApi } from '../services/api';

const DEMO_PERSONAS = [
  {
    email: 'master@smartpatel.co.za',
    label: 'Platform Master',
    description: 'Root access to platform stats, tenant onboarding, master profile & suspension.',
    icon: ShieldCheck,
    color: 'text-blue-600 bg-blue-50 border-blue-100',
    buttonColor: 'bg-blue-600 hover:bg-blue-700',
  },
  {
    email: 'admin@timetrack.com',
    label: 'Tenant Administrator',
    description: 'Manage workforce directories, company settings, geofencing & payroll.',
    icon: UserCog,
    color: 'text-red-600 bg-red-50 border-red-100',
    buttonColor: 'bg-red-600 hover:bg-red-700',
  },
  {
    email: 'thabo@timetrack.com',
    label: 'Branch Manager',
    description: 'Scoped supervisor: manage roster schedules, time entries & direct reports.',
    icon: Users,
    color: 'text-amber-600 bg-amber-50 border-amber-100',
    buttonColor: 'bg-amber-600 hover:bg-amber-700',
  },
  {
    email: 'sipho@timetrack.com',
    label: 'Employee / Staff',
    description: 'Mobile web portal: check in/out, view timesheets & roster calendar.',
    icon: User,
    color: 'text-emerald-600 bg-emerald-50 border-emerald-100',
    buttonColor: 'bg-emerald-600 hover:bg-emerald-700',
  },
];

export default function Demo() {
  const { refresh } = useAuth();
  const navigate = useNavigate();
  const [loadingEmail, setLoadingEmail] = useState<string | null>(null);

  const handleLaunchPersona = async (email: string) => {
    setLoadingEmail(email);
    try {
      // Launch demo session via master demo-login (keeps master session restorable)
      const res = await masterApi.demoLogin(email);
      toast.success(res.message || 'Demo session launched!');
      await refresh();
      // All demos start on the Dashboard (not the login page)
      navigate('/');
    } catch (err: any) {
      toast.error(err.message || 'Simulation login failed. Please reset simulation DB.');
    } finally {
      setLoadingEmail(null);
    }
  };

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      
      {/* Header */}
      <div>
        <div className="flex items-center gap-2 mb-1">
          <Sparkles className="w-5 h-5 text-blue-600" />
          <h1 className="text-2xl font-bold">Platform Simulator</h1>
        </div>
        <p className="text-sm text-slate-500">
          Simulate multi-tenant roles, execute sandbox quick-logins, and preview client experiences.
        </p>
      </div>

      {/* Info Warning Card */}
      <Card className="border border-blue-100 bg-blue-50/10 p-5 rounded-3xl flex gap-4">
        <div className="w-10 h-10 rounded-full bg-blue-50 text-blue-600 flex items-center justify-center shrink-0">
          <HelpCircle className="w-5 h-5" />
        </div>
        <div className="text-sm">
          <h4 className="font-bold text-blue-900">Exclusive Operator Simulator Access</h4>
          <p className="text-slate-500 mt-1 leading-relaxed font-semibold">
            In compliance with platform security audits, quick demo accounts are strictly hidden from the public login screen. They can only be executed internally from this Master Operator dashboard.
          </p>
        </div>
      </Card>

      {/* Simulation Grid */}
      <div className="grid gap-6 md:grid-cols-2">
        {DEMO_PERSONAS.map((persona) => {
          const Icon = persona.icon;
          const isCurrentLoading = loadingEmail === persona.email;

          return (
            <Card key={persona.email} className="border border-slate-100 bg-white rounded-3xl shadow-xl shadow-slate-100/30 overflow-hidden flex flex-col justify-between">
              <CardHeader className="flex flex-row items-start gap-4 p-6 pb-4">
                <div className={`w-12 h-12 rounded-2xl border flex items-center justify-center shrink-0 ${persona.color}`}>
                  <Icon className="w-5 h-5" />
                </div>
                <div className="space-y-1 min-w-0">
                  <CardTitle className="text-base font-bold text-slate-900 leading-none">
                    {persona.label}
                  </CardTitle>
                  <CardDescription className="text-xs font-semibold text-slate-400">
                    {persona.email}
                  </CardDescription>
                </div>
              </CardHeader>
              
              <CardContent className="p-6 pt-0 space-y-5 flex-grow flex flex-col justify-between">
                <p className="text-slate-500 text-sm font-semibold leading-relaxed">
                  {persona.description}
                </p>

                <Button
                  onClick={() => handleLaunchPersona(persona.email)}
                  disabled={loadingEmail !== null}
                  className={`w-full h-11 text-white font-bold rounded-xl flex items-center justify-center gap-2 transition-all shadow-md ${persona.buttonColor}`}
                >
                  {isCurrentLoading ? (
                    <>
                      <Spinner className="h-4 w-4 border-white" />
                      <span>Launching Sandbox…</span>
                    </>
                  ) : (
                    <>
                      <span>Launch Persona</span>
                      <ArrowRight className="w-4 h-4" />
                    </>
                  )}
                </Button>
              </CardContent>
            </Card>
          );
        })}
      </div>

    </div>
  );
}
