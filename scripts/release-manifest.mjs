import {readFileSync,writeFileSync,statSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import path from 'node:path';
export function manifest({repository,version,directory,notes='',date=new Date().toISOString()}) {
  if(!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)||!/^\d+\.\d+\.\d+$/.test(version))throw Error('Expected OWNER/REPO and a stable SemVer');
  const files={'windows-x86_64':`MatrixGram_${version}_x64-setup.exe`,'android-aarch64':`MatrixGram-${version}-android-arm64.apk`};
  const platforms={};
  for(const [target,file] of Object.entries(files)) {
    const asset=path.join(directory,file);if(!statSync(asset).isFile())throw Error('Missing '+file);
    const signature=readFileSync(asset+'.sig','utf8').trim();
    const comment=Buffer.from(signature,'base64').toString('utf8').split('\n').find(line=>line.startsWith('trusted comment:'))?.slice('trusted comment:'.length).trim();
    if(!comment?.split('\t').includes('version:'+version))throw Error('Signature does not bind '+file+' to '+version);
    platforms[target]={url:`https://github.com/${repository}/releases/download/v${version}/${file}`,signature};
  }
  return {version,notes,pub_date:date,platforms};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href) {
  const [repository,version,directory,notesFile]=process.argv.slice(2);
  const value=manifest({repository,version,directory,notes:notesFile?readFileSync(notesFile,'utf8'):''});
  writeFileSync(path.join(directory,'latest.json'),JSON.stringify(value,null,2)+'\n');
  console.log('Wrote signed-artifact manifest for '+version);
}
