import {readFileSync,writeFileSync} from 'node:fs';
import {fileURLToPath,pathToFileURL} from 'node:url';
import path from 'node:path';
export function setVersion(root,version) {
  if(!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version))throw Error('Use stable SemVer, for example 0.5.3');
  const load=file=>readFileSync(path.join(root,file),'utf8').replaceAll('\r\n','\n');
  const old=JSON.parse(load('package.json')).version;
  const compare=(a,b)=>{for(let i=0;i<3;i++){const difference=Number(a.split('.')[i])-Number(b.split('.')[i]);if(difference)return difference}return 0};
  if(compare(version,old)<=0)throw Error('A release version must increase');
  const changes=new Map();
  for(const file of ['package.json','apps/client/package.json','apps/client/src-tauri/tauri.conf.json']){const value=JSON.parse(load(file));if(value.version!==old)throw Error('Version mismatch in '+file);value.version=version;changes.set(file,JSON.stringify(value,null,2)+'\n')}
  const lock=JSON.parse(load('package-lock.json'));lock.version=version;lock.packages[''].version=version;lock.packages['apps/client'].version=version;changes.set('package-lock.json',JSON.stringify(lock,null,2)+'\n');
  const workspace=load('Cargo.toml');if(!workspace.includes(`version = "${old}"`))throw Error('Cargo version mismatch');changes.set('Cargo.toml',workspace.replace(`version = "${old}"`,`version = "${version}"`));
  let cargo=load('Cargo.lock');for(const name of ['matrixgram','matrixgram-core']){const before=`name = "${name}"\nversion = "${old}"`;if(!cargo.includes(before))throw Error('Cargo lock version mismatch');cargo=cargo.replace(before,`name = "${name}"\nversion = "${version}"`)}changes.set('Cargo.lock',cargo);
  const app=load('apps/client/src/App.tsx');if(!app.includes(`· ${old} ·`))throw Error('UI version mismatch');changes.set('apps/client/src/App.tsx',app.replace(`· ${old} ·`,`· ${version} ·`));
  for(const [file,value] of changes)writeFileSync(path.join(root,file),value);
  return version;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');console.log('Prepared version '+setVersion(root,process.argv[2]||''));}
