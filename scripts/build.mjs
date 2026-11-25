import {build} from 'esbuild';
import {mkdir} from 'node:fs/promises';
await mkdir('dist',{recursive:true});
await build({entryPoints:['src/server.js'],outfile:'dist/server.js',bundle:true,packages:'external',format:'esm',platform:'node',target:'node22'});
console.log('Built scheduling-only local server. No voice or cloud assets.');
