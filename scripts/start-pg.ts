// Starts an embedded PostgreSQL for local development and testing
import EmbeddedPostgres from 'embedded-postgres';

async function main() {
  const pg = new EmbeddedPostgres({
    database_dir: './data/pg',
    user: 'rateguard',
    password: 'rateguard',
    port: 5432,
    persistent: true,
  });
  
  console.log('Starting embedded PostgreSQL...');
  await pg.initialise();
  await pg.start();
  await pg.createDatabase('rateguard');
  console.log('PostgreSQL ready on port 5432');
  console.log('Connection: postgres://rateguard:rateguard@localhost:5432/rateguard');
  
  // Keep running
  process.on('SIGINT', async () => {
    console.log('Stopping PostgreSQL...');
    await pg.stop();
    process.exit(0);
  });
  process.on('SIGTERM', async () => {
    await pg.stop();
    process.exit(0);
  });
  
  // Keep alive
  setInterval(() => {}, 60000);
}

main().catch(console.error);
