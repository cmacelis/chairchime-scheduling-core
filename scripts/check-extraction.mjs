import {readFileSync,existsSync,readdirSync} from 'node:fs';
import {join} from 'node:path';
const allowed=JSON.parse(readFileSync('docs/ARCHIVE-FILES.json','utf8'));
const forbidden=/(^|\/)(?:\.git|\.local|node_modules|dist|\.env(?:\..*)?|\.DS_Store)(?:\/|$)|\.(?:pem|key|p12|sqlite|db)$/i;
for(const file of allowed){
 if(forbidden.test(file)||file.startsWith('/')||file.split('/').includes('..'))throw new Error(`Unsafe archive entry: ${file}`);
 if(!existsSync(file))throw new Error(`Missing: ${file}`);
 const text=readFileSync(file,'utf8');
 if(file==='scripts/check-extraction.mjs')continue; // Scanner signatures are not customer data.
 if(/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|\b(?:sk_live_|sk-proj-|AKIA)[A-Za-z0-9_-]{12,}/.test(text))throw new Error(`Potential secret: ${file}`);
 if(/(?:cmacelis@gmail\.com|Terry|barber_local|ellis@127)/i.test(text))throw new Error(`Private source residue: ${file}`);
}
for(const required of ['LICENSE','.gitignore','package-lock.json','README.md'])if(!allowed.includes(required))throw new Error(`Required file not allowlisted: ${required}`);
console.log(`Checked ${allowed.length} allowlisted source files. No database, dependency tree, build output, environment file or Git history will be packaged. Pattern scans are not a guarantee that all sensitive data is absent.`);
