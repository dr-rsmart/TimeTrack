import { Client } from 'pg';

async function testConnection() {
  const client = new Client({
    user: 'postgres',
    host: '127.0.0.1',
    database: 'postgres',
    port: 5433,
  });

  try {
    console.log('Attempting to connect to PostgreSQL (TRUST mode)...');
    await client.connect();
    console.log('Successfully connected!');
    console.log('Setting password for user postgres...');
    await client.query("ALTER USER postgres PASSWORD 'RicJer24'");
    console.log('Password set successfully!');
    
    // Check if database 'timetrack' exists, create if not
    const dbRes = await client.query("SELECT 1 FROM pg_database WHERE datname = 'timetrack'");
    if (dbRes.rowCount === 0) {
      console.log("Creating database 'timetrack'...");
      await client.query("CREATE DATABASE timetrack");
      console.log("Database 'timetrack' created.");
    }
    
    await client.end();
  } catch (err) {
    console.error('Connection error details:', err.message);
  }
}

testConnection();

