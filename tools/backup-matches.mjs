#!/usr/bin/env node
// Usage: node tools/backup-matches.mjs /absolute/runtime/matches.sqlite /absolute/private/backup.sqlite
import path from 'node:path';
import { stat } from 'node:fs/promises';
import { openRecoveryStore } from '../server/recovery/store.js';
const [source,target]=process.argv.slice(2);
if(!source||!target||!path.isAbsolute(source)||!path.isAbsolute(target)||source===target)throw new Error('Two distinct absolute paths required');
if(!(await stat(source)).isFile())throw new Error('Source must be an existing database');
const store=await openRecoveryStore(source);
try{await store.backup(target);console.log('Consistent SQLite backup created. Keep it private: it contains reconnect credentials.');}finally{await store.close();}
