const fs = require('fs');
const { execSync } = require('child_process');

const keysToPush = [
  'JWT_SECRET', 
  'OTP_SECRET', 
  'CIRCLE_API_KEY', 
  'CIRCLE_ENTITY_SECRET', 
  'KEEPER_PRIVATE_KEY', 
  'SPONSOR_PRIVATE_KEY',
  'SUBSCRIPT_WEBHOOK_SECRET', 
  'CRON_SECRET', 
  'KEEPER_SECRET',
  'DATABASE_URL', 
  'SUPABASE_SERVICE_ROLE_KEY', 
  'NEXT_PUBLIC_SUPABASE_ANON_KEY'
];

const envContent = fs.readFileSync('.env', 'utf8');
const envLines = envContent.split('\n');
const envs = {};
for (const line of envLines) {
  if (line.trim().startsWith('#') || !line.includes('=')) continue;
  const splitIdx = line.indexOf('=');
  const key = line.slice(0, splitIdx).trim();
  let val = line.slice(splitIdx + 1).trim();
  if (val.startsWith('"') && val.endsWith('"')) val = val.slice(1, -1);
  envs[key] = val;
}

for (const key of keysToPush) {
  if (envs[key]) {
    console.log('Pushing ' + key + ' to Vercel...');
    try {
      execSync('vercel env add ' + key + ' production --yes --sensitive --value "' + envs[key] + '" --force', { stdio: 'inherit' });
      execSync('vercel env add ' + key + ' preview --yes --sensitive --value "' + envs[key] + '" --force', { stdio: 'inherit' });
    } catch (e) {
      console.error('Failed to push ' + key);
    }
  }
}
console.log('Finished pushing custom keys!');
