/**
 * API client - talks to the Node.js backend
 */

const API_BASE = (import.meta.env.VITE_API_URL || '/api').replace(/\/$/, '');

export interface User {
  id: string;
  email: string;
  full_name: string;
  role: 'admin' | 'manager' | 'employee';
  created_date: string;
}

interface Event {
  type: 'create' | 'update' | 'delete';
  data: any;
}

// Simple event emitter for realtime subscriptions
const createEventEmitter = () => {
  const listeners = new Map<string, Set<(event: Event) => void>>();
  return {
    subscribe: (entityName: string, callback: (event: Event) => void) => {
      if (!listeners.has(entityName)) {
        listeners.set(entityName, new Set());
      }
      listeners.get(entityName)!.add(callback);
      return () => listeners.get(entityName)?.delete(callback);
    },
    emit: (entityName: string, event: Event) => {
      listeners.get(entityName)?.forEach((cb) => cb(event));
    },
  };
};

const emitter = createEventEmitter();

// Connect to SSE for real-time updates from server
const connectSSE = () => {
  const eventSource = new EventSource('http://localhost:5001/api/events');
  
  eventSource.onmessage = (event) => {
    try {
      const { entity, type, data } = JSON.parse(event.data);
      emitter.emit(entity, { type, data });
    } catch (err) {
      console.error('Error parsing SSE event:', err);
    }
  };

  eventSource.onerror = () => {
    console.warn('SSE connection lost. Reconnecting in 5s...');
    eventSource.close();
    setTimeout(connectSSE, 5000);
  };
};

if (typeof window !== 'undefined') {
  connectSSE();
}

// Entity operations
const createEntityOperations = (entityName: string) => ({
  list: async (sort?: string, limit?: number) => {
    const res = await fetch(`${API_BASE}/${entityName}`);
    let items = await res.json();
    
    // Apply sorting (simple client-side fallback for now, though server could handle)
    if (sort) {
      const desc = sort.startsWith('-');
      const field = desc ? sort.slice(1) : sort;
      items = [...items].sort((a, b) => {
        if (a[field] < b[field]) return desc ? 1 : -1;
        if (a[field] > b[field]) return desc ? -1 : 1;
        return 0;
      });
    }
    
    if (limit) {
      items = items.slice(0, limit);
    }
    
    return items;
  },

  filter: async (filterObj?: Record<string, any>, sort?: string, limit?: number) => {
    // Simple filter using list and filtering on client side for now
    let items = await createEntityOperations(entityName).list(sort, limit);
    
    if (filterObj) {
      items = items.filter((item) => {
        return Object.entries(filterObj).every(([key, value]) => {
          if (value === null || value === undefined) return true;
          return String(item[key]).toLowerCase().includes(String(value).toLowerCase());
        });
      });
    }
    
    return items;
  },

  get: async (id: string) => {
    const res = await fetch(`${API_BASE}/${entityName}/${id}`);
    if (!res.ok) return null;
    return await res.json();
  },

  create: async (data: any) => {
    const res = await fetch(`${API_BASE}/${entityName}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    const newItem = await res.json();
    return newItem;
  },

  update: async (id: string, data: any) => {
    const res = await fetch(`${API_BASE}/${entityName}/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    const updatedItem = await res.json();
    return updatedItem;
  },

  delete: async (id: string) => {
    const res = await fetch(`${API_BASE}/${entityName}/${id}`, {
      method: 'DELETE',
    });
    const deletedItem = await res.json();
    return deletedItem;
  },

  bulkCreate: async (items: any[]) => {
    const results = [];
    for (const item of items) {
      const res = await createEntityOperations(entityName).create(item);
      results.push(res);
    }
    return results;
  },

  subscribe: (callback: (event: Event) => void) => {
    return emitter.subscribe(entityName, callback);
  },
});

// Auth operations
const auth = {
  me: async (): Promise<User | null> => {
    const res = await fetch(`${API_BASE}/auth/me`);
    if (!res.ok) throw new Error('Not authenticated');
    return await res.json();
  },

  login: async (email: string, password?: string): Promise<User> => {
    // In production, this would be a POST to /api/auth/login
    // For now, we mock the me check
    const user = { id: '1', email, full_name: 'Admin User', role: 'admin' as const, created_date: new Date().toISOString() };
    localStorage.setItem('timetrack_user', JSON.stringify(user));
    return user;
  },

  loginViaEmailPassword: async (email: string, password?: string): Promise<User> => {
    return auth.login(email, password);
  },

  logout: (redirectUrl?: string) => {
    localStorage.removeItem('timetrack_user');
    if (redirectUrl) {
      window.location.href = '/Login';
    }
  },

  signup: async (email: string, password?: string, fullName?: string): Promise<User> => {
    // Mock signup
    return auth.login(email, password);
  },
};

// Proxy to handle dynamic entity access
const entitiesProxy = new Proxy({} as Record<string, any>, {
  get: (target, entityName: string) => {
    if (!target[entityName]) {
      target[entityName] = createEntityOperations(entityName);
    }
    return target[entityName];
  },
});

// Main data client
export const client = {
  auth,
  entities: entitiesProxy,
};

export default client;