import dotenv from 'dotenv';
import path from 'path';
import { spawn } from 'child_process';

// Load environment variables from .env.local first, then .env
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });
dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const nextStart = spawn('npx', ['next', 'start'], {
  stdio: 'inherit',
  shell: true,
  env: process.env
});

nextStart.on('close', (code) => {
  process.exit(code || 0);
});
