import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DATA, makeMatch } from './harness.js';
import { PHASE, ERR } from '../../shared/constants.js';
import { loadoutOptions } from '../../shared/protocol.js';
test('partial customization preserves other choices and refuses invalid/battle/ready/bot edits', () => {
 const {m}=makeMatch({humans:2,bots:1}),ps=m.players.get('p_0');
 try {
 const cs=Object.values(DATA.chess).filter(c=>c.visible&&!c.isGolden&&!c.isHidden&&!c.isDiy&&loadoutOptions(c,DATA.chess[c.goldenId]).skills.length>1).slice(0,2);
 const entry=c=>{const o=loadoutOptions(c,DATA.chess[c.goldenId]);return {skill:o.skills.find(i=>i!==o.defaultSkill)};};
 m.phase=PHASE.PREP;
 assert.equal(m.setPrepLoadout('p_0',{[cs[0].chessId]:entry(cs[0])}).ok,true);
 const first=structuredClone(ps.loadout);
 assert.equal(m.setPrepLoadout('p_0',{[cs[1].chessId]:entry(cs[1])}).ok,true);
 assert.deepEqual(ps.loadout[cs[0].chessId],first[cs[0].chessId]);
 assert.equal(Object.keys(m.players.get('p_1').loadout||{}).length,0);
 const saved=structuredClone(ps.loadout);
 assert.equal(m.setPrepLoadout('p_0',{[cs[0].chessId]:{skill:999}}).error,ERR.BAD_TARGET);assert.deepEqual(ps.loadout,saved);
 ps.ready=true;assert.equal(m.setPrepLoadout('p_0',{}).error,ERR.WRONG_PHASE);ps.ready=false;
 m.phase=PHASE.COMBAT;assert.equal(m.setPrepLoadout('p_0',{}).error,ERR.WRONG_PHASE);
 m.phase=PHASE.SP_DRAFT;assert.equal(m.setPrepLoadout('p_0',{}).ok,true);
 assert.equal(m.setPrepLoadout('ai_0',{}).error,ERR.NOT_IN_ROOM);
 assert.equal(m.setPrepLoadout('unknown',{}).error,ERR.NOT_IN_ROOM);
 } finally {m.dispose();}
});
