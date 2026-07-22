import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import bcrypt from 'bcryptjs';
import { fileURLToPath } from 'url';
import prisma from './prisma.js';

dotenv.config();

const app = express();
const port = process.env.PORT || 5001;

app.use(cors());
app.use(express.json());

// Serve static files from the React app
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const frontendPath = path.join(__dirname, '../../dist');

app.use(express.static(frontendPath));

// SSE Clients
let clients: any[] = [];

app.get('/api/events', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const clientId = Date.now();
  const newClient = { id: clientId, res };
  clients.push(newClient);

  req.on('close', () => {
    clients = clients.filter(c => c.id !== clientId);
  });
});

const broadcast = (entity: string, type: string, data: any) => {
  const payload = JSON.stringify({ entity, type, data });
  clients.forEach(client => {
    client.res.write(`data: ${payload}\n\n`);
  });
};

// ── Auth Routes ──

// Register new user
app.post('/api/auth/register', async (req, res) => {
  try {
    const { email, password, full_name, role } = req.body;
    if (!email || !password || !full_name) {
      return res.status(400).json({ error: 'Email, password, and full_name are required.' });
    }

    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      return res.status(409).json({ error: 'A user with this email already exists.' });
    }

    const password_hash = await bcrypt.hash(password, 10);
    const user = await prisma.user.create({
      data: { email, full_name, role: role || 'employee', password_hash },
    });

    // Also create an Employee record if one doesn't exist
    const existingEmployee = await prisma.employee.findUnique({ where: { email } });
    if (!existingEmployee) {
      await prisma.employee.create({
        data: { email, full_name, role: role || 'employee', status: 'active' },
      });
    }

    const { password_hash: _, ...safeUser } = user;
    res.status(201).json(safeUser);
  } catch (error: any) {
    console.error('Register error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Login
app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required.' });
    }

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user || !user.password_hash) {
      return res.status(401).json({ error: 'Invalid email or password.' });
    }

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      return res.status(401).json({ error: 'Invalid email or password.' });
    }

    const { password_hash: _, ...safeUser } = user;
    // Simple token: base64-encoded user ID (for demo — use JWT in production)
    const token = Buffer.from(JSON.stringify({ userId: user.id })).toString('base64');
    res.json({ user: safeUser, token });
  } catch (error: any) {
    console.error('Login error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Auth me (token-based)
app.get('/api/auth/me', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.slice(7);
      try {
        const decoded = JSON.parse(Buffer.from(token, 'base64').toString());
        const user = await prisma.user.findUnique({ where: { id: decoded.userId } });
        if (user) {
          const { password_hash: _, ...safeUser } = user;
          return res.json(safeUser);
        }
      } catch {
        // Invalid token — fall through to admin mock
      }
    }

    // Fallback: return admin for backward compatibility
    const admin = await prisma.user.findFirst({ where: { role: 'admin' } });
    if (admin) {
      const { password_hash: _, ...safeAdmin } = admin;
      return res.json(safeAdmin);
    }
    res.json({ id: '1', email: 'admin@example.com', full_name: 'Admin User', role: 'admin' });
  } catch {
    res.json({ id: '1', email: 'admin@example.com', full_name: 'Admin User', role: 'admin' });
  }
});

// ── Generic entity routes ──

app.get('/api/:entity', async (req, res) => {
  const { entity } = req.params;
  try {
    if (!(prisma as any)[entity]) return res.status(404).json({ error: 'Entity not found' });
    const items = await (prisma as any)[entity].findMany();
    res.json(items);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/:entity', async (req, res) => {
  const { entity } = req.params;
  console.log(`POST /api/${entity}`, req.body);
  try {
    if (!(prisma as any)[entity]) return res.status(404).json({ error: 'Entity not found' });
    const data = { ...req.body };
    // Strip fields not in the respective Prisma model
    if (entity === 'Employee') {
      delete (data as any).user_invited;
      delete (data as any).geofence_id;
      delete (data as any).hire_date;
    }
    // Handle date conversion for specific fields
    if (data.clock_in) data.clock_in = new Date(data.clock_in);
    if (data.clock_out) data.clock_out = new Date(data.clock_out);

    const newItem = await (prisma as any)[entity].create({ data });

    // Auto-create User account when an Employee is created
    if (entity === 'Employee' && data.email) {
      const existingUser = await prisma.user.findUnique({ where: { email: data.email } });
      if (!existingUser) {
        const defaultPassword = 'changeme123';
        const password_hash = await bcrypt.hash(defaultPassword, 10);
        await prisma.user.create({
          data: {
            email: data.email,
            full_name: data.full_name || data.email,
            role: data.role || 'employee',
            password_hash,
          },
        });
        console.log(`Auto-created User for Employee: ${data.email}`);
      }
    }

    broadcast(entity, 'create', newItem);
    res.status(201).json(newItem);
  } catch (error: any) {
    console.error(`Error creating ${entity}:`, error);
    res.status(500).json({ error: error.message });
  }
});

app.put('/api/:entity/:id', async (req, res) => {
  const { entity, id } = req.params;
  try {
    if (!(prisma as any)[entity]) return res.status(404).json({ error: 'Entity not found' });
    const data = { ...req.body };
    if (data.id) delete data.id;
    if (data.clock_in) data.clock_in = new Date(data.clock_in);
    if (data.clock_out) data.clock_out = new Date(data.clock_out);

    const updatedItem = await (prisma as any)[entity].update({
      where: { id },
      data,
    });
    broadcast(entity, 'update', updatedItem);
    res.json(updatedItem);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/:entity/:id', async (req, res) => {
  const { entity, id } = req.params;
  try {
    if (!(prisma as any)[entity]) return res.status(404).json({ error: 'Entity not found' });
    const deleted = await (prisma as any)[entity].delete({ where: { id } });
    broadcast(entity, 'delete', deleted);
    res.json(deleted);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// The "catchall" handler: for any request that doesn't
// match one above, send back React's index.html file.
app.get('{*path}', (req, res) => {
  res.sendFile(path.join(frontendPath, 'index.html'));
});

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});