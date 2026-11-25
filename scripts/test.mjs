import {spawnSync} from 'node:child_process';
import {mkdirSync,openSync,closeSync,unlinkSync} from 'node:fs';
import {join} from 'node:path';
import {setupDatabase,stopDatabase,root} from './database.mjs';
mkdirSync(join(root,'.local'),{recursive:true});
const lock=join(root,'.local','test.lock');
const descriptor=openSync(lock,'wx'); // A concurrent runner must not reset another test run.
try{
 await setupDatabase('test',{reset:true});
 const env={...process.env,CHAIR_EXTRACT_TEST:'1'};
 delete env.DATABASE_URL;delete env.TEST_DATABASE_URL;
 const result=spawnSync(process.execPath,['--import','tsx','--test','--test-concurrency=1','tests/integration.test.ts'],{cwd:root,env,stdio:'inherit'});
 if(result.error)throw result.error;process.exitCode=result.status??1;
}finally{try{stopDatabase('test');}finally{closeSync(descriptor);unlinkSync(lock);}}
