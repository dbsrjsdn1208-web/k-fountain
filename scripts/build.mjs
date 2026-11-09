import { build } from 'esbuild';
import { mkdir, copyFile, readFile, writeFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import {deflateSync} from 'node:zlib';
import {workerSource} from './service-worker.mjs';
await mkdir('dist',{recursive:true});
const built=await build({entryPoints:{app:'src/main.js'},bundle:true,splitting:true,format:'esm',target:'es2022',outdir:'dist',entryNames:'[name]-[hash]',chunkNames:'chunks/[name]-[hash]',minify:true,metafile:true,sourcemap:false,loader:{'.woff2':'file','.woff':'file'},assetNames:'fonts/[name]-[hash]',legalComments:'eof'});
const [entryPath,entryInfo]=Object.entries(built.metafile.outputs).find(([,info])=>info.entryPoint==='src/main.js');
const appVersion=entryPath.replace(/^dist\//,''),cssPath=entryInfo.cssBundle.replace(/^dist\//,'');
await writeFile('dist/index.html',(await readFile('index.html','utf8')).replace('./app.js','./'+appVersion).replace('./app.css','./'+cssPath).replace('</head>',`<meta name="k-fountain-version" content="${appVersion}">\n</head>`));
const lock=JSON.parse(await readFile('package-lock.json','utf8'));
let notices='THIRD-PARTY NOTICES\n\nDerived from wixette/fountain2html f7a741d06a3de6602efe04f4673daa315e3bc9da\nhttps://github.com/wixette/fountain2html\nApache License 2.0\n'+await readFile('vendor/fountain2html/LICENSE','utf8')+'\n';
for(const [location,entry] of Object.entries(lock.packages||{})){
  if(!location||entry.dev)continue;
  for(const name of ['LICENSE','LICENSE.md','LICENSE.txt','license','license.md','OFL.txt']){
    try{const license=await readFile(`${location}/${name}`,'utf8');notices+=`\n--- ${location.replace('node_modules/','')} ---\n${license}\n`;break;}catch{}
  }
}
await writeFile('dist/THIRD-PARTY-NOTICES.txt',notices);
// Deterministic PNG app icons: a blue K on the upstream black header color.
function crc32(bytes){let c=0xffffffff;for(const b of bytes){c^=b;for(let i=0;i<8;i++)c=(c>>>1)^((c&1)?0xedb88320:0);}return (c^0xffffffff)>>>0;}
function chunk(kind,data){const k=Buffer.from(kind),size=Buffer.alloc(4),crc=Buffer.alloc(4);size.writeUInt32BE(data.length);crc.writeUInt32BE(crc32(Buffer.concat([k,data])));return Buffer.concat([size,k,data,crc]);}
for(const n of [192,512]){const pixels=Buffer.alloc(n*(n*4+1));for(let y=0;y<n;y++)for(let x=0;x<n;x++){const u=x/n,v=y/n;const ink=(u>.25&&u<.35&&v>.22&&v<.78)||(u>.34&&u<.75&&Math.abs(Math.abs(v-.5)-(u-.34)*.7)<.055);const p=y*(n*4+1)+1+x*4;pixels[p]=ink?153:0;pixels[p+1]=ink?204:0;pixels[p+2]=ink?255:0;pixels[p+3]=255;}const ihdr=Buffer.alloc(13);ihdr.writeUInt32BE(n,0);ihdr.writeUInt32BE(n,4);ihdr[8]=8;ihdr[9]=6;await writeFile(`dist/icon-${n}.png`,Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',ihdr),chunk('IDAT',deflateSync(pixels)),chunk('IEND',Buffer.alloc(0))]));}
await writeFile('dist/manifest.webmanifest',JSON.stringify({id:'./',name:'K-파운틴',short_name:'K-파운틴',lang:'ko',start_url:'./',scope:'./',display:'standalone',background_color:'#ffffff',theme_color:'#000000',icons:[192,512].map(n=>({src:`./icon-${n}.png`,sizes:`${n}x${n}`,type:'image/png',purpose:'any maskable'}))}));
const assets=['./','./index.html','./manifest.webmanifest','./icon-192.png','./icon-512.png',...Object.keys(built.metafile.outputs).map(p=>'./'+p.replace(/^dist\//,''))];
const hash=createHash('sha256');for(const asset of assets.filter(x=>x!=='./'))hash.update(await readFile('dist/'+asset.slice(2)));
const version='k-fountain-'+hash.digest('hex').slice(0,16);
await writeFile('dist/sw.js',workerSource(version,assets,appVersion));
console.log('Built dist/');
if(process.argv.includes('--standalone')){
  const result=await build({entryPoints:['src/main.js'],bundle:true,format:'iife',target:'es2022',outfile:'app.js',minify:true,write:false,loader:{'.woff2':'dataurl','.woff':'dataurl'},legalComments:'eof'});
  const js=result.outputFiles.find(f=>f.path.endsWith('.js')).text.replace(/<\/script/gi,'<\\/script');
  const css=result.outputFiles.find(f=>f.path.endsWith('.css')).text;
  const html=(await readFile('index.html','utf8')).replace('<link rel="stylesheet" href="./app.css">',`<style>${css}</style>`).replace('<script type="module" src="./app.js"></script>',()=>`<script>${js}</script>`);
  await writeFile('K-파운틴.html',html.replace(/<link rel="(?:manifest|icon)"[^>]+>/g,''));console.log('Built standalone K-파운틴.html');
}
