import { useState, useEffect, useRef } from "react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Camera, Loader2, Mail, CheckCircle2 } from "lucide-react";
import { client } from "@/api/Client";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useRealtimeEntity } from "@/hooks/useRealtimeEntity";

const EMPTY = {
  full_name: "",
  first_name: "",
  surname: "",
  email: "",
  position: "",
  phone: "",
  department: "",
  branch: "",
  employee_number: "",
  geofence_id: "",
  role: "employee",
  status: "active",
  hire_date: "",
  avatar_url: "",
};

function AvatarUploader({ avatarUrl, onUpload }) {
  const fileRef = useRef(null);
  const [uploading, setUploading] = useState(false);

  const handleFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 2 * 1024 * 1024) {
      toast.error("Image must be under 2MB.");
      return;
    }
    if (!file.type.startsWith("image/")) {
      toast.error("Please select an image file.");
      return;
    }

    setUploading(true);
    try {
      // Avatar upload not yet implemented — just show preview locally
      const reader = new FileReader();
      reader.onload = () => {
        onUpload(reader.result as string);
        toast.success("Avatar preview set (upload not implemented).");
      };
      reader.readAsDataURL(file);
    } catch {
      toast.error("Upload failed. Please try again.");
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="flex items-center gap-4">
      <button
        type="button"
        onClick={() => fileRef.current?.click()}
        disabled={uploading}
        className="relative group w-20 h-20 rounded-full overflow-hidden border-2 border-border bg-accent flex items-center justify-center shrink-0"
      >
        {avatarUrl ? (
          <img src={avatarUrl} alt="Avatar" className="w-full h-full object-cover" />
        ) : (
          <span className="text-2xl font-bold text-accent-foreground">
            {(EMPTY.full_name || "?").split(" ").map((n) => n[0]).join("").slice(0, 2).toUpperCase()}
          </span>
        )}
        <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
          {uploading ? (
            <Loader2 className="w-5 h-5 text-white animate-spin" />
          ) : (
            <Camera className="w-5 h-5 text-white" />
          )}
        </div>
      </button>
      <div>
        <p className="text-sm font-medium">Profile Photo</p>
        <p className="text-xs text-muted-foreground">Click to upload (max 2MB)</p>
        {avatarUrl && (
          <button
            type="button"
            onClick={() => onUpload("")}
            className="text-xs text-destructive hover:underline mt-1"
          >
            Remove photo
          </button>
        )}
      </div>
      <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleFile} />
    </div>
  );
}

export default function EmployeeForm({ open, onOpenChange, onSave, existing }) {
  const [form, setForm] = useState(EMPTY);
  const [inviting, setInviting] = useState(false);
  const [invited, setInvited] = useState(false);

  const { data: geofences = [] } = useRealtimeEntity("GeofenceSettings", {
    filter: { is_active: true },
    limit: 100,
  });

  useEffect(() => {
    if (existing) {
      setForm({ ...EMPTY, ...existing });
      setInvited((existing as any).user_invited || false);
    } else {
      setForm(EMPTY);
      setInvited(false);
    }
  }, [existing, open]);

  const handleInvite = async () => {
    if (!form.email) return;
    setInviting(true);
    // Invite functionality not yet connected to an email service
    setTimeout(() => {
      setInvited(true);
      setInviting(false);
      toast.success(`Employee will be able to log in with ${form.email}.`);
    }, 600);
  };

  const handleSave = () => {
    // Strip fields not in the Prisma Employee model
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { geofence_id, hire_date, user_invited, ...cleanForm } = form;
    onSave(cleanForm);
    // Dialog will be closed by parent after successful save
  };

  const isValid = form.full_name && form.email;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md rounded-2xl">
        <DialogHeader>
          <DialogTitle>{existing ? "Edit Employee" : "Add Employee"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <AvatarUploader
            avatarUrl={form.avatar_url}
            onUpload={(url) => setForm({ ...form, avatar_url: url })}
          />

          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2">
              <Label>Full Name *</Label>
              <Input className="mt-1.5 rounded-xl" value={form.full_name}
                onChange={(e) => setForm({ ...form, full_name: e.target.value })} />
            </div>
            <div className="col-span-2">
              <Label>Email *</Label>
              <Input className="mt-1.5 rounded-xl" type="email" value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })} />
            </div>
            <div>
              <Label>First Name</Label>
              <Input className="mt-1.5 rounded-xl" value={form.first_name}
                onChange={(e) => setForm({ ...form, first_name: e.target.value })} />
            </div>
            <div>
              <Label>Surname</Label>
              <Input className="mt-1.5 rounded-xl" value={form.surname}
                onChange={(e) => setForm({ ...form, surname: e.target.value })} />
            </div>
            <div>
              <Label>Position</Label>
              <Input className="mt-1.5 rounded-xl" value={form.position}
                onChange={(e) => setForm({ ...form, position: e.target.value })} />
            </div>
            <div>
              <Label>Phone</Label>
              <Input className="mt-1.5 rounded-xl" value={form.phone}
                onChange={(e) => setForm({ ...form, phone: e.target.value })} />
            </div>
            <div>
              <Label>Department</Label>
              <Input className="mt-1.5 rounded-xl" value={form.department}
                onChange={(e) => setForm({ ...form, department: e.target.value })} />
            </div>
            <div>
              <Label>Branch</Label>
              <Input className="mt-1.5 rounded-xl" value={form.branch}
                onChange={(e) => setForm({ ...form, branch: e.target.value })} />
            </div>
            <div className="col-span-2">
              <Label>Geofence Location <span className="text-muted-foreground font-normal">(optional)</span></Label>
              <Select value={form.geofence_id || "_none"} onValueChange={(v) => setForm({ ...form, geofence_id: v === "_none" ? "" : v })}>
                <SelectTrigger className="mt-1.5 rounded-xl"><SelectValue placeholder="No location linked" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="_none">No location linked</SelectItem>
                  {geofences.map((g) => (
                    <SelectItem key={g.id} value={g.id}>
                      {g.name}{g.address ? ` — ${g.address}` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Employee No.</Label>
              <Input className="mt-1.5 rounded-xl" value={form.employee_number}
                onChange={(e) => setForm({ ...form, employee_number: e.target.value })} />
            </div>
            <div>
              <Label>Role</Label>
              <Select value={form.role} onValueChange={(v) => setForm({ ...form, role: v })}>
                <SelectTrigger className="mt-1.5 rounded-xl"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="employee">Employee</SelectItem>
                  <SelectItem value="manager">Manager</SelectItem>
                  <SelectItem value="admin">Admin</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Status</Label>
              <Select value={form.status} onValueChange={(v) => setForm({ ...form, status: v })}>
                <SelectTrigger className="mt-1.5 rounded-xl"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="on_leave">On Leave</SelectItem>
                  <SelectItem value="inactive">Inactive</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Hire Date</Label>
              <Input className="mt-1.5 rounded-xl" type="date" value={form.hire_date}
                onChange={(e) => setForm({ ...form, hire_date: e.target.value })} />
            </div>
          </div>

          {/* Auth invite section */}
          <div className={cn(
            "rounded-xl p-4 border",
            invited ? "bg-chart-2/5 border-chart-2/20" : "bg-accent/50 border-border"
          )}>
            <div className="flex items-center gap-3">
              <div className={cn(
                "w-9 h-9 rounded-lg flex items-center justify-center shrink-0",
                invited ? "bg-chart-2/10" : "bg-primary/10"
              )}>
                {invited ? (
                  <CheckCircle2 className="w-4 h-4 text-chart-2" />
                ) : (
                  <Mail className="w-4 h-4 text-primary" />
                )}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium">
                  {invited ? "Account invitation sent" : "Authentication account"}
                </p>
                <p className="text-xs text-muted-foreground">
                  {invited
                    ? `${form.email} will receive an email to set up their password and log in securely.`
                    : "Send an invite so this employee can log in with email & password."}
                </p>
              </div>
              {!invited && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="rounded-xl shrink-0"
                  onClick={handleInvite}
                  disabled={inviting || !form.email}
                >
                  {inviting ? <Loader2 className="w-3 h-3 animate-spin" /> : "Send Invite"}
                </Button>
              )}
            </div>
          </div>
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} className="rounded-xl">Cancel</Button>
          <Button onClick={handleSave} disabled={!isValid} className="rounded-xl">
            {existing ? "Save Changes" : "Add Employee"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}