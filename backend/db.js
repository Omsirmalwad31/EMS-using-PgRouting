import pg from 'pg';
import dotenv from 'dotenv';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, '.env') });
dotenv.config({ path: join(__dirname, '..', '.env') });

const { Pool } = pg;

export const pool = new Pool({
  user: process.env.DB_USER ?? 'postgres',
  host: process.env.DB_HOST ?? 'localhost',
  port: Number(process.env.DB_PORT ?? 5432),
  database: process.env.DB_DATABASE ?? 'ems_pgrouting',
  password: process.env.DB_PASSWORD,
});
