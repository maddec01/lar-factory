import { expect, test } from 'vite-plus/test';
import { readTrackerStructure, trackerKind, trackerReference, writeTrackerStructure } from './tracker-structure.ts';

test('managed structure round trips Markdown and HTML without changing original bytes or exposing a comment terminator',()=>{
  for(const original of ['Original text.\n','<div>Original Azure HTML.</div>','']) {
    const structure={version:1 as const,kind:'concept' as const,map:'## Map\n```mermaid\nflowchart LR\nA --> B\n```\n<!-- hello -->'};
    const body=writeTrackerStructure(original,structure);expect(body.startsWith(original)).toBe(true);expect(readTrackerStructure(body)).toEqual(structure);
    const replaced=writeTrackerStructure(body,{...structure,map:'A changed map'});expect(replaced.startsWith(original)).toBe(true);expect(replaced.match(/lar-factory:structure/g)).toHaveLength(1);
  }
});
test('duplicate, malformed, excessive and newer structure blocks refuse reads and writes',()=>{
  const good=writeTrackerStructure('',{version:1,kind:'concept'});
  for(const bad of [good+good,'<!-- lar-factory:structure\n{bad}\n-->','<!-- lar-factory:structure\n{"version":2,"kind":"concept"}\n-->','<!-- lar-factory:structure\n'+ 'a'.repeat(270_000)+'\n-->']) {
    expect(()=>readTrackerStructure(bad)).toThrow();expect(()=>writeTrackerStructure(bad,{version:1,kind:'concept'})).toThrow();
  }
  expect(()=>writeTrackerStructure('',{version:1,kind:'concept',parent:{url:'https://github.com@evil.test/team/app/issues/2',kind:'concept',title:'bad'}})).toThrow();
});
test('tracker URLs and native issue types work without factory labels',()=>{
  expect(trackerReference('https://github.com/team/app/issues/2')).toEqual({repository:'team/app',number:2});
  expect(trackerReference('https://dev.azure.com/team/Project%20Name/_workitems/edit/42')).toEqual({repository:'team/Project%20Name',number:42});
  for(const invalid of ['file:///tmp/secret','https://user:pass@github.com/team/app/issues/2','https://github.com/team/app/issues/2?token=secret'])expect(trackerReference(invalid)).toBeNull();
  expect(trackerKind([],'Bug')).toBe('bug');expect(trackerKind([],'Feature')).toBe('feature');expect(trackerKind(['enhancement'])).toBe('feature');expect(trackerKind(['improvement'])).toBe('improvement');expect(trackerKind(['concept'])).toBe('concept');
});
