'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'..');
const packages={
 'fuse.js':['dist/fuse.min.cjs','LICENSE'],
 'wavesurfer.js':['dist/wavesurfer.min.js','LICENSE'],
 'chart.js':['dist/chart.umd.min.js','LICENSE.md'],
 '@kurkle/color':['LICENSE.md'],
 'tabulator-tables':['dist/js/tabulator.min.js','dist/css/tabulator.min.css','LICENSE']
};
function build(){
 const manifest=[];
 for(const [name,files] of Object.entries(packages)){
  const source=path.join(root,'node_modules',name),version=JSON.parse(fs.readFileSync(path.join(source,'package.json'))).version;
  const folder=path.join(root,'public/vendor',name,version);fs.mkdirSync(folder,{recursive:true});
  for(const file of files){let bytes=fs.readFileSync(path.join(source,file));const output=file.endsWith('.cjs')?path.basename(file).replace('.cjs','.js'):path.basename(file);if(file.endsWith('.cjs'))bytes=Buffer.from('(function(){const module={exports:{}};\n'+bytes.toString()+'\nglobalThis.Fuse=module.exports;})();\n');const target=path.join(folder,output);fs.writeFileSync(target,bytes);manifest.push({package:name,version,path:path.relative(path.join(root,'public'),target).split(path.sep).join('/'),bytes:bytes.length,sha256:crypto.createHash('sha256').update(bytes).digest('hex')});}
 }
 fs.writeFileSync(path.join(root,'public/vendor/manifest.json'),JSON.stringify(manifest,null,2)+'\n');
}
if(require.main===module)build();
module.exports={build};
