import dotenv from 'dotenv';
import { Pool } from 'pg';

dotenv.config();

const pool = new Pool({
  user: process.env.DB_USER || 'sunoh',
  host: process.env.DB_HOST || 'localhost',
  database: process.env.DB_NAME || 'sunoh_db',
  password: process.env.DB_PASSWORD || 'sunoh_pass',
  port: parseInt(process.env.DB_PORT || '5432'),
});

export const query = (text: string, params?: any[]) => pool.query(text, params);

export default pool;
