import { MapPin, Pencil, Trash2 } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { cn } from "@/lib/utils";

export default function GeofenceList({ geofences, onEdit, onDelete, onToggle }) {
  if (!geofences || geofences.length === 0) {
    return (
      <div className="bg-muted/30 rounded-xl border border-dashed border-border p-6 text-center text-muted-foreground text-sm">
        No locations configured yet. Click "Add" to create your first geofence.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {geofences.map((g) => (
        <div
          key={g.id}
          className={cn(
            "bg-card rounded-xl border p-4 flex items-center justify-between gap-4",
            g.is_active ? "border-border" : "border-border opacity-60"
          )}
        >
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 rounded-xl bg-accent flex items-center justify-center shrink-0">
              <MapPin className="w-5 h-5 text-accent-foreground" />
            </div>
            <div className="min-w-0">
              <p className="font-medium truncate">{g.name}</p>
              {g.address && (
                <p className="text-xs text-muted-foreground truncate">{g.address}</p>
              )}
              <p className="text-xs text-muted-foreground">
                {g.latitude?.toFixed(5)}, {g.longitude?.toFixed(5)} · {g.radius_meters}m
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Switch
              checked={g.is_active !== false}
              onCheckedChange={(v) => onToggle(g, v)}
            />
            <button
              onClick={() => onEdit(g)}
              className="text-muted-foreground hover:text-foreground transition-colors p-1.5"
            >
              <Pencil className="w-4 h-4" />
            </button>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <button className="text-muted-foreground hover:text-destructive transition-colors p-1.5">
                  <Trash2 className="w-4 h-4" />
                </button>
              </AlertDialogTrigger>
              <AlertDialogContent className="rounded-2xl">
                <AlertDialogHeader>
                  <AlertDialogTitle>Delete "{g.name}"?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This geofence will be permanently removed. Employees will no longer be able to
                    clock in from this location.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel className="rounded-xl">Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={() => onDelete(g)}
                    className="rounded-xl bg-destructive hover:bg-destructive/90 text-destructive-foreground"
                  >
                    Delete
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        </div>
      ))}
    </div>
  );
}