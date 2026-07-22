import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
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

// Generic entity routes
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
    // Handle date conversion for specific fields if necessary
    if (data.clock_in) data.clock_in = new Date(data.clock_in);
    if (data.clock_out) data.clock_out = new Date(data.clock_out);
    
    const newItem = await (prisma as any)[entity].create({
      data: data
    });
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
      data: data
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
    const deleted = await (prisma as any)[entity].delete({
      where: { id }
    });
    broadcast(entity, 'delete', deleted);
    res.json(deleted);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Auth me mock
app.get('/api/auth/me', async (req, res) => {
  try {
    const admin = await prisma.user.findFirst({
      where: { role: 'admin' }
    });
    if (!admin) {
      return res.json({ id: '1', email: 'admin@example.com', full_name: 'Admin User', role: 'admin' });
    }
    res.json(admin);
  } catch {
    res.json({ id: '1', email: 'admin@example.com', full_name: 'Admin User', role: 'admin' });
  }
});

// The "catchall" handler: for any request that doesn't
// match one above, send back React's index.html file.
app.get('*', (req, res) => {
  res.sendFile(path.join(frontendPath, 'index.html'));
});

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
