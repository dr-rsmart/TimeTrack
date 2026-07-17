import { useState } from "react";
import { client } from "@/api/Client";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Search, Loader2, MapPin, Check } from "lucide-react";
import { toast } from "sonner";

/**
 * Searches for places via Google (using InvokeLLM with web search),
 * returns results with name, address, and coordinates.
 * When a result is selected, calls onSelect with the place data.
 */
export default function GooglePlaceSearch({ onSelect }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [selected, setSelected] = useState(null);

  const handleSearch = async () => {
    if (!query.trim() || searching) return;
    setSearching(true);
    setResults([]);
    try {
      const res = await data.integrations.Core.InvokeLLM({
        prompt: `Find locations matching "${query}". Return up to 5 results with their name, full street address, latitude, and longitude. Only return real, verifiable places.`,
        add_context_from_internet: true,
        model: "gemini_3_flash",
        response_json_schema: {
          type: "object",
          properties: {
            results: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  name: { type: "string" },
                  address: { type: "string" },
                  latitude: { type: "number" },
                  longitude: { type: "number" },
                },
              },
            },
          },
        },
      });
      const places = res?.results || [];
      if (places.length === 0) {
        toast.info("No locations found. Try a more specific search.");
      }
      setResults(places);
    } catch {
      toast.error("Search failed. Please try again or enter coordinates manually.");
    } finally {
      setSearching(false);
    }
  };

  const handleSelect = (place) => {
    setSelected(place);
    onSelect(place);
    toast.success(`Selected: ${place.name}`);
  };

  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Search for a place on Google..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSearch()}
            className="pl-9 rounded-xl"
          />
        </div>
        <Button onClick={handleSearch} disabled={searching || !query.trim()} className="rounded-xl shrink-0">
          {searching ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
          Search
        </Button>
      </div>

      {results.length > 0 && (
        <div className="space-y-1.5 max-h-64 overflow-y-auto">
          {results.map((place, i) => (
            <button
              key={i}
              type="button"
              onClick={() => handleSelect(place)}
              className={`w-full text-left flex items-start gap-3 p-3 rounded-xl border transition-colors ${
                selected?.name === place.name
                  ? "border-primary bg-primary/5"
                  : "border-border hover:bg-accent/50"
              }`}
            >
              <MapPin className="w-4 h-4 text-muted-foreground mt-0.5 shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">{place.name}</p>
                <p className="text-xs text-muted-foreground truncate">{place.address}</p>
                <p className="text-[10px] text-muted-foreground mt-0.5">
                  {place.latitude?.toFixed(4)}, {place.longitude?.toFixed(4)}
                </p>
              </div>
              {selected?.name === place.name && <Check className="w-4 h-4 text-primary shrink-0" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}