import { useState } from "react";
import { client } from "@/api/Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { MapPin, Plus } from "lucide-react";
import GeofenceList from "@/components/settings/GeofenceList";
import GeofenceForm from "@/components/settings/GeofenceForm";
import { toast } from "sonner";
import { motion } from "framer-motion";

export default function GeofenceManager() {
  const queryClient = useQueryClient();
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState(null);

  const { data: geofences = [] } = useQuery({
    queryKey: ["geofenceSettings"],
    queryFn: () => client.entities.GeofenceSettings.list(),
  });

  const createMutation = useMutation({
    mutationFn: (formData) => client.entities.GeofenceSettings.create(formData),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["geofenceSettings"] });
      toast.success("Location added!");
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data: formData }) => client.entities.GeofenceSettings.update(id, formData),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["geofenceSettings"] });
      toast.success("Location updated!");
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => client.entities.GeofenceSettings.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["geofenceSettings"] });
      toast.success("Location deleted.");
    },
  });

  const handleSave = (data) => {
    if (editing) {
      updateMutation.mutate({ id: editing.id, data });
    } else {
      createMutation.mutate(data);
    }
    setEditing(null);
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      className="bg-card rounded-2xl border border-border p-6 space-y-4"
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-accent flex items-center justify-center">
            <MapPin className="w-5 h-5 text-accent-foreground" />
          </div>
          <div>
            <h2 className="font-semibold">Office Locations</h2>
            <p className="text-xs text-muted-foreground">Add multiple geofences for different sites</p>
          </div>
        </div>
        <Button
          onClick={() => { setEditing(null); setFormOpen(true); }}
          size="sm"
          className="rounded-xl"
        >
          <Plus className="w-4 h-4 mr-1" />
          Add
        </Button>
      </div>

      <GeofenceList
        geofences={geofences}
        onEdit={(g) => { setEditing(g); setFormOpen(true); }}
        onDelete={(g) => deleteMutation.mutate(g.id)}
        onToggle={(g, isActive) => updateMutation.mutate({ id: g.id, data: { is_active: isActive } })}
      />

      <GeofenceForm
        open={formOpen}
        onOpenChange={(o) => { setFormOpen(o); if (!o) setEditing(null); }}
        onSave={handleSave}
        existing={editing}
      />
    </motion.div>
  );
}