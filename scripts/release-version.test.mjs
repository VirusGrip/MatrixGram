import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,cpSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {setVersion} from './set-version.mjs';
test('version bump keeps manifests, own lock entries and UI consistent',()=>{
  const root=mkdtempSync(path.join(tmpdir(),'matrixgram-version-'));
  try{
    const files=['package.json','apps/client/package.json','apps/client/src-tauri/tauri.conf.json','package-lock.json','Cargo.toml','Cargo.lock','apps/client/src/App.tsx'];
    for(const file of files)cpSync(file,path.join(root,file),{recursive:true});
    const version=JSON.parse(readFileSync('package.json','utf8')).version;const next=version.split('.');next[2]=String(Number(next[2])+1);const target=next.join('.');
    setVersion(root,target);
    for(const file of files.filter(file=>file.endsWith('.json')))assert.equal(JSON.parse(readFileSync(path.join(root,file),'utf8')).version,target);
    assert.match(readFileSync(path.join(root,'apps/client/src/App.tsx'),'utf8'),new RegExp('· '+target.replaceAll('.','\\.')+' ·'));
    assert.throws(()=>setVersion(root,version),/must increase/);
    assert.throws(()=>setVersion(root,'broken'),/SemVer/);
  }finally{rmSync(root,{recursive:true,force:true})}
});
