import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import GeofenceManager from "@/components/settings/GeofenceManager";
import WhatsAppSetup from "@/components/settings/WhatsAppSetup";
import CompanySettingsCard from "@/components/settings/CompanySettingsCard";
import OvertimeRulesCard from "@/components/settings/OvertimeRulesCard";
import { client } from "@/api/Client";
import { useUserRole } from "@/hooks/useUserRole";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Trash2, MapPin, Clock, Calendar, MessageCircle, UserX, ShieldAlert } from "lucide-react";

const tabIcons = {
  locations: MapPin,
  policy: Calendar,
  overtime: Clock,
  integrations: MessageCircle,
  account: UserX,
};

export default function Settings() {
  const { canConfigure } = useUserRole();

  if (!canConfigure) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Settings</h1>
          <p className="text-muted-foreground text-sm mt-1">
            Configure locations, work policies, overtime rules, and integrations
          </p>
        </div>
        <div className="bg-card rounded-2xl border border-border p-8 text-center max-w-md mx-auto">
          <div className="w-12 h-12 rounded-xl bg-destructive/10 flex items-center justify-center mx-auto mb-3">
            <ShieldAlert className="w-6 h-6 text-destructive" />
          </div>
          <p className="text-sm font-medium">Admin access required</p>
          <p className="text-xs text-muted-foreground mt-1">
            Only administrators can modify system settings, geofences, and overtime rules. Contact an admin if you need a change.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Settings</h1>
        <p className="text-muted-foreground text-sm mt-1">
          Configure locations, work policies, overtime rules, and integrations
        </p>
      </div>

      <Tabs defaultValue="locations">
        <TabsList className="bg-secondary flex-wrap h-auto">
          <TabsTrigger value="locations">Locations</TabsTrigger>
          <TabsTrigger value="policy">Work Policy</TabsTrigger>
          <TabsTrigger value="overtime">Overtime</TabsTrigger>
          <TabsTrigger value="integrations">Integrations</TabsTrigger>
          <TabsTrigger value="account">Account</TabsTrigger>
        </TabsList>

        <TabsContent value="locations" className="mt-6">
          <GeofenceManager />
        </TabsContent>

        <TabsContent value="policy" className="mt-6">
          <CompanySettingsCard />
        </TabsContent>

        <TabsContent value="overtime" className="mt-6">
          <OvertimeRulesCard />
        </TabsContent>

        <TabsContent value="integrations" className="mt-6">
          <WhatsAppSetup />
        </TabsContent>

        <TabsContent value="account" className="mt-6">
          <div className="bg-card rounded-2xl border border-destructive/20 p-6 space-y-4 max-w-lg">
            <div>
              <h2 className="font-semibold text-destructive">Account Management</h2>
              <p className="text-xs text-muted-foreground mt-1">
                Permanently delete your account and all associated data.
              </p>
            </div>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="destructive" className="rounded-xl">
                  <Trash2 className="w-4 h-4 mr-2" />
                  Delete My Account
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent className="rounded-2xl">
                <AlertDialogHeader>
                  <AlertDialogTitle>Are you absolutely sure?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This will permanently delete your account and all your time entries. This action
                    cannot be undone.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel className="rounded-xl">Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={() => data.auth.logout()}
                    className="rounded-xl bg-destructive hover:bg-destructive/90 text-destructive-foreground"
                  >
                    Yes, delete my account
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}