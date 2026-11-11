import {readFileSync,readdirSync} from 'node:fs';
import {parseDocument} from 'yaml';
for(const name of readdirSync('.github/workflows').filter(name=>name.endsWith('.yml'))) {
  const doc=parseDocument(readFileSync('.github/workflows/'+name,'utf8'));
  if(doc.errors.length)throw doc.errors[0];
  const value=doc.toJS();if(!value.on||!value.jobs)throw Error('Incomplete workflow: '+name);
  for(const job of Object.values(value.jobs))if(!job['runs-on']||!job.steps?.length)throw Error('Incomplete job: '+name);
  console.log('Parsed workflow: '+name);
}
