import { useEffect, useState, useCallback } from "react";
import client from "@/api/Client";

/**
 * Realtime subscription hook — the System is equivalent to Firestore onSnapshot.
 * Subscribes to entity changes and updates state automatically when records
 * are created, updated, or deleted. Avoids polling, so no read quota impact.
 *
 * @param {string} entityName - Entity to subscribe to (e.g. "TimeEntry")
 * @param {object} options - { sort, limit, filter } for initial fetch
 * @returns { data, isLoading, refetch }
 */
export function useRealtimeEntity(entityName, options = {}) {
  const { sort, limit = 500, filter } = options;
  const [records, setRecords] = useState([]);
  const [isLoading, setIsLoading] = useState(true);

  const fetchData = useCallback(async () => {
    setIsLoading(true);
    try {
      let result;
      if (filter) {
        result = await client.entities[entityName].filter(filter, sort, limit);
      } else {
        result = await client.entities[entityName].list(sort, limit);
      }
      setRecords(result);
    } catch (error) {
      console.error(`Error fetching ${entityName}:`, error);
      setRecords([]);
    } finally {
      setIsLoading(false);
    }
  }, [entityName, JSON.stringify(filter), sort, limit]);

  useEffect(() => {
    fetchData();

    const unsubscribe = client.entities[entityName].subscribe((event) => {
      setRecords((prev) => {
        const list = [...prev];
        if (event.type === "create") {
          if (!list.find((r) => r.id === event.data.id)) {
            list.unshift(event.data);
          }
        } else if (event.type === "update") {
          const idx = list.findIndex((r) => r.id === event.data.id);
          if (idx >= 0) list[idx] = { ...list[idx], ...event.data };
          else list.unshift(event.data);
        } else if (event.type === "delete") {
          return list.filter((r) => r.id !== event.data.id);
        }
        return list;
      });
    });

    return () => {
      if (typeof unsubscribe === "function") unsubscribe();
    };
  }, [fetchData, entityName]);

  return { data: records, isLoading, refetch: fetchData };
}