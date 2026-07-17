import { AlertTriangle, UserX } from "lucide-react";

export default function MissingStaffCard({ missingStaff = [] }) {
  return (
    <div className="bg-card rounded-2xl border border-border p-6">
      <div className="flex items-center gap-2 mb-4">
        <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${missingStaff.length > 0 ? "bg-destructive/10" : "bg-muted"}`}>
          {missingStaff.length > 0 ? (
            <AlertTriangle className="w-4 h-4 text-destructive" />
          ) : (
            <UserX className="w-4 h-4 text-muted-foreground" />
          )}
        </div>
        <h3 className="text-base font-semibold">Missing Staff</h3>
        <span className={`ml-auto text-xs font-medium px-2 py-0.5 rounded-full ${missingStaff.length > 0 ? "text-destructive bg-destructive/10" : "text-muted-foreground bg-muted"}`}>
          {missingStaff.length} {missingStaff.length === 1 ? "person" : "people"}
        </span>
      </div>

      {missingStaff.length === 0 ? (
        <p className="text-sm text-muted-foreground py-6 text-center">Everyone expected is here! 🎉</p>
      ) : (
        <div className="space-y-2">
          {missingStaff.map((staff) => (
            <div key={staff.email} className="flex items-center gap-3 py-2 border-b border-border last:border-0">
              <div className="w-9 h-9 rounded-full bg-destructive/10 text-destructive text-xs font-bold flex items-center justify-center">
                {(staff.name || "?").split(" ").map((n) => n[0]).join("").slice(0, 2).toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">{staff.name}</p>
                <p className="text-xs text-muted-foreground truncate">{staff.position}</p>
              </div>
              {staff.expectedTime && staff.expectedTime !== "—" && (
                <span className="text-xs font-medium text-destructive">
                  Expected {staff.expectedTime}
                </span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}