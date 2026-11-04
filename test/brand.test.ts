import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
// Coupling "Seven-eye triangle geometry" (.harness.json): the web mark, the sidebar mark and the native menu drawing share one triangle and seven eye centres.
const triangle='M1 4 L31 4 L16 44 Z';
const eyes:[number,number][]=[[8,10],[13.33,10],[18.67,10],[24,10],[12.5,19],[19.5,19],[16,28]];
const svgEyes=(d:string)=>[...d.matchAll(/M([\d.]+) ([\d.]+) a1\.9 1\.25/g)].map(m=>[Math.round((Number(m[1])+1.9)*100)/100,Number(m[2])]);
test('the web mark, sidebar mark and native menu drawing share the seven-eye triangle',()=>{
 const mark=readFileSync('web/public/mark.svg','utf8'),brand=readFileSync('web/public/brand.svg','utf8');
 const swift=readFileSync('native/NervMenuBar/Sources/NervMenuBar/NervMenuBar.swift','utf8');
 const markPath=/<path[^>]* d="([^"]+)"/.exec(mark)![1]!;
 assert.ok(markPath.startsWith(triangle));assert.deepEqual(svgEyes(markPath),eyes);
 assert.ok(brand.includes(`transform="translate(30 0)" d="${markPath}"`),'sidebar mark reuses the exact triangle path');
 // AppKit draws from the bottom-left: y' = 48 - y.
 assert.match(swift,/move\(to: NSPoint\(x: 1, y: 44\)\); path\.line\(to: NSPoint\(x: 31, y: 44\)\); path\.line\(to: NSPoint\(x: 16, y: 4\)\)/);
 const native=[...swift.matchAll(/\(([\d.]+), ([\d.]+)\)/g)].map(m=>[Number(m[1]),Number(m[2])]);
 assert.deepEqual(native,eyes);assert.match(swift,/y: 48 - y - 1\.25, width: 3\.8, height: 2\.5/);
 const token=/--mark:(#[0-9a-f]{6})/.exec(readFileSync('web/src/styles.css','utf8'))![1];
 for(const f of [mark,brand])assert.ok(f.includes(`fill="${token}"`),'mark colour equals the --mark token');
});
