import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {manifest} from './release-manifest.mjs';
test('release metadata includes both signed packages and fixed repository URLs',()=>{
  const directory=mkdtempSync(path.join(tmpdir(),'matrixgram-release-'));
  try{
    const files=['MatrixGram_0.5.3_x64-setup.exe','MatrixGram-0.5.3-android-arm64.apk'];
    for(const file of files){writeFileSync(path.join(directory,file),'test-only');writeFileSync(path.join(directory,file+'.sig'),Buffer.from('untrusted comment: fixture\nnot-a-real-signature\ntrusted comment: timestamp:1\tversion:0.5.3\nnot-a-real-global-signature').toString('base64'))}
    const value=manifest({repository:'VirusGrip/MatrixGram',version:'0.5.3',directory});
    assert.equal(Object.keys(value.platforms).length,2);assert.equal(value.platforms['android-aarch64'].url,'https://github.com/VirusGrip/MatrixGram/releases/download/v0.5.3/MatrixGram-0.5.3-android-arm64.apk');
    assert.throws(()=>manifest({repository:'evil/../x',version:'0.5.3',directory}));
    writeFileSync(path.join(directory,files[0]+'.sig'),Buffer.from('trusted comment: version:0.5.2').toString('base64'));
    assert.throws(()=>manifest({repository:'VirusGrip/MatrixGram',version:'0.5.3',directory}),/does not bind/);
  }finally{rmSync(directory,{recursive:true,force:true})}
});
