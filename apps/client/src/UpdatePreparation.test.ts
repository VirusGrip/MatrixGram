import {expect,it} from 'vitest';
import {prepareForUpdate,registerUpdatePreparation} from './UpdatePreparation';
it('waits for draft persistence and unregisters closed chats',async()=>{let saved=false;const remove=registerUpdatePreparation(async()=>{await Promise.resolve();saved=true});await prepareForUpdate();expect(saved).toBe(true);remove();saved=false;await prepareForUpdate();expect(saved).toBe(false)});
it('propagates a persistence failure before installation',async()=>{const remove=registerUpdatePreparation(async()=>{throw Error('storage unavailable')});try{await expect(prepareForUpdate()).rejects.toThrow('storage unavailable')}finally{remove()}});
