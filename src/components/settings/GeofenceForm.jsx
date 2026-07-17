import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Locate, Search } from "lucide-react";
import { toast } from "sonner";
import GooglePlaceSearch from "@/components/settings/GooglePlaceSearch";

const EMPTY = {
  name: "",
  address: "",
  latitude: "",
  longitude: "",
  radius_meters: 200,
  is_active: true,
};

export default function GeofenceForm({ open, onOpenChange, onSave, existing }) {
  const [form, setForm] = useState(EMPTY);
  const [lookingUp, setLookingUp] = useState(false);

  useEffect(() => {
    if (existing) {
      setForm({
        name: existing.name || "",
        address: existing.address || "",
        latitude: existing.latitude ?? "",
        longitude: existing.longitude ?? "",
        radius_meters: existing.radius_meters || 200,
        is_active: existing.is_active !== false,
      });
    } else {
      setForm(EMPTY);
    }
  }, [existing, open]);

  const handleGeolocate = () => {
    if (!navigator.geolocation) {
      toast.error("Geolocation not supported in this browser.");
      return;
    }
    setLookingUp(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setForm((f) => ({
          ...f,
          latitude: pos.coords.latitude.toFixed(6),
          longitude: pos.coords.longitude.toFixed(6),
        }));
        setLookingUp(false);
        toast.success("Current location detected!");
      },
      () => {
        toast.error("Could not get location. Please enter coordinates manually.");
        setLookingUp(false);
      }
    );
  };

  const handleSave = () => {
    onSave({
      ...form,
      latitude: parseFloat(form.latitude),
      longitude: parseFloat(form.longitude),
      radius_meters: parseInt(form.radius_meters),
    });
    onOpenChange(false);
  };

  const isValid = form.name && form.latitude && form.longitude;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md rounded-2xl">
        <DialogHeader>
          <DialogTitle>{existing ? "Edit Location" : "Add Location"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          {/* Google Place Search */}
          <div className="rounded-xl border border-border bg-accent/30 p-4 space-y-2">
            <div className="flex items-center gap-2 mb-1">
              <Search className="w-4 h-4 text-primary" />
              <Label>Search via Google</Label>
            </div>
            <GooglePlaceSearch
              onSelect={(place) => setForm({
                ...form,
                name: form.name || place.name,
                address: place.address,
                latitude: place.latitude.toFixed(6),
                longitude: place.longitude.toFixed(6),
              })}
            />
          </div>

          <div>
            <Label>Location Name</Label>
            <Input
              className="mt-1.5"
              placeholder="e.g. Main Office"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
          </div>
          <div>
            <Label>Address (optional)</Label>
            <Input
              className="mt-1.5"
              placeholder="e.g. 123 Main St, New York, NY"
              value={form.address}
              onChange={(e) => setForm({ ...form, address: e.target.value })}
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>Latitude</Label>
              <Input
                className="mt-1.5"
                type="number"
                step="0.000001"
                value={form.latitude}
                onChange={(e) => setForm({ ...form, latitude: e.target.value })}
              />
            </div>
            <div>
              <Label>Longitude</Label>
              <Input
                className="mt-1.5"
                type="number"
                step="0.000001"
                value={form.longitude}
                onChange={(e) => setForm({ ...form, longitude: e.target.value })}
              />
            </div>
          </div>
          <Button
            variant="outline"
            onClick={handleGeolocate}
            disabled={lookingUp}
            className="w-full rounded-xl"
          >
            <Locate className="w-4 h-4 mr-2" />
            {lookingUp ? "Detecting..." : "Use My Current Location"}
          </Button>
          <div>
            <Label>Allowed Radius (meters)</Label>
            <Input
              className="mt-1.5"
              type="number"
              min="50"
              max="5000"
              value={form.radius_meters}
              onChange={(e) => setForm({ ...form, radius_meters: e.target.value })}
            />
          </div>
          <div className="flex items-center justify-between py-1">
            <Label>Active</Label>
            <Switch
              checked={form.is_active}
              onCheckedChange={(v) => setForm({ ...form, is_active: v })}
            />
          </div>
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} className="rounded-xl">
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={!isValid} className="rounded-xl">
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}