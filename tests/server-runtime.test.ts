import {test} from 'node:test';
import {mkdir,mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import ts from 'typescript';

test('emitted ElevenLabs handlers load in native Node ESM and reject anonymous requests',async()=>{
 const root=resolve('verification-output');await mkdir(root,{recursive:true});
 const folder=await mkdtemp(join(root,'server-runtime-'));
 try {
  for(const file of ['server/http.ts','server/auth.ts','server/usage.ts','server/quota.ts','server/projectAudio.ts','server/mp3.ts','server/storage.ts','server/assets.ts','server/r2.ts','server/pronunciation.ts','server/errorLog.ts','server/lessonStats.ts','api/admin/monitor.ts','api/admin/set-role.ts','api/admin/storage.ts','api/gemini/key.ts','api/elevenlabs/status.ts','api/elevenlabs/voices.ts','api/admin/analytics.ts','api/gemini/generate.ts','api/gemini/join-parts.ts','api/gemini/align-project.ts','api/elevenlabs/align-project.ts','api/vision/ocr.ts']){
   const output=join(folder,file.replace(/\.ts$/,'.js'));
   await mkdir(resolve(output,'..'),{recursive:true});
   const source=await readFile(file,'utf8');
   await writeFile(output,ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText);
  }
  await writeFile(join(folder,'check.mjs'),`
    import assert from 'node:assert/strict';
    process.env.SUPABASE_URL='https://example.supabase.co';
    process.env.SUPABASE_ANON_KEY='test-public-key';
    for(const name of ['status','voices']){
      const {default:handler}=await import('./api/elevenlabs/'+name+'.js');
      let status;
      const res={status(code){status=code;return this;},json(){return this;},setHeader(){}};
      await handler({method:'GET',headers:{}},res);
      assert.equal(status,401,name+' must load and require sign-in');
    }
    {
      for(const admin of ['analytics','storage']){const {default:handler}=await import('./api/admin/'+admin+'.js');
      let status;
      const res={status(code){status=code;return this;},json(){return this;},setHeader(){}};
      await handler({method:'GET',headers:{}},res);
      assert.equal(status,401,'admin '+admin+' must load and require sign-in');}
    }
    {
      const {default:handler}=await import('./api/admin/monitor.js');
      let status;
      const res={status(code){status=code;return this;},json(){return this;},setHeader(){}};
      await handler({method:'GET',headers:{},query:{}},res);
      assert.equal(status,404,'the morning report is off without MONITOR_TOKEN');
      process.env.MONITOR_TOKEN='x'.repeat(32);
      await handler({method:'GET',headers:{authorization:'Bearer wrong'},query:{}},res);
      assert.equal(status,401,'the morning report needs the secret');
      delete process.env.MONITOR_TOKEN;
    }
    for(const path of ['gemini/generate','gemini/join-parts','gemini/align-project','gemini/key','elevenlabs/align-project','vision/ocr']){
      const {default:handler}=await import('./api/'+path+'.js');
      let status;
      const res={status(code){status=code;return this;},json(){return this;},setHeader(){}};
      await handler({method:'POST',headers:{},body:{}},res);
      assert.equal(status,401,path+' must load and require sign-in');
    }
  `);
  await promisify(execFile)(process.execPath,[join(folder,'check.mjs')],{timeout:15000});
 }finally{await rm(folder,{recursive:true,force:true});}
});
