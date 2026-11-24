'use strict';
const bulkQuery=`query($page:Int){Page(page:$page,perPage:50){pageInfo{hasNextPage} media(type:ANIME,isAdult:false,genre_not_in:["Hentai"],sort:POPULARITY_DESC){id idMal isAdult genres title{romaji english native} synonyms episodes coverImage{large}}}}`;
let bulkStopRequested=false;
function bulkAllowed(media){return media.isAdult!==true && !(media.genres||[]).some(genre=>genre.toLowerCase()==='hentai');}
async function importBulk(target,onProgress){
 if(!Number.isInteger(target)||target<1||target>500)throw new Error('Escolha de 1 a 500 animes por lote.');
 let added=0,existing=0,blocked=0,streak=0;const visited=new Set(),failures=[];
 for(let page=1;page<=100 && added<target && !bulkStopRequested;page++){
  onProgress('Consultando catálogo · '+added+'/'+target+' adicionados · página '+page);
  const batch=await catalog(bulkQuery,{page});
  for(const item of batch.media){
   if(bulkStopRequested||added>=target)break;
   if(visited.has(item.id))continue;visited.add(item.id);
   if(!bulkAllowed(item)){blocked++;continue;}
   if(matchingRow(item,cloudRows)){existing++;continue;}
   if(typeof manualDuplicateCandidates==='function'){const possible=manualDuplicateCandidates(item,cloudRows);if(possible.length){failures.push((primaryTitle(item)||'Anime')+' — possível duplicata de '+possible.map(row=>row.title).join(', ')+'. Revise em Unificar duplicados.');continue;}}
   const result=await importMediaList([item],()=>onProgress(added+'/'+target+' · '+(primaryTitle(item)||'Título sem romanização')),'Catálogo',true);
   added+=result.added;existing+=result.existing;failures.push(...result.failures);
   streak=result.added?0:streak+1;if(streak>=3)throw new Error('Três títulos seguidos não puderam ser importados. '+added+' já foram salvos. Tente novamente mais tarde.');
  }
  if(!batch.pageInfo.hasNextPage)break;
 }
 return {added,failures,message:added+' adicionados como Pendente · '+existing+' existentes ignorados · '+blocked+' classificados como adultos/hentai ignorados.'+(bulkStopRequested?' Importação pausada; os já adicionados foram mantidos.':'')};
}
async function startBulkImport(){
 if(!isAppOwner()||sharingReadonly||importing||pending||loading||editor.open)return;
 importing=true;bulkStopRequested=false;
 const ids=['bulkImport','bulkAmount','seasonImport','completeTitles','importButton','add','seasonAuto'];ids.forEach(id=>el(id).disabled=true);el('bulkStop').hidden=false;el('bulkWarnings').replaceChildren();
 try{
  await cloudCollection();if(typeof loadImportAliases==='function')await loadImportAliases();const result=await importBulk(Number(el('bulkAmount').value),text=>el('bulkInfo').textContent=text);
  el('bulkInfo').textContent=result.message+(result.failures.length?' Há '+result.failures.length+' aviso(s) abaixo.':'');
  for(const failure of result.failures){const li=document.createElement('li');li.textContent=failure;el('bulkWarnings').append(li);}
 }catch(error){el('bulkInfo').textContent=error.message+' Os títulos já salvos não serão duplicados ao repetir.';}
 finally{importing=false;ids.forEach(id=>el(id).disabled=false);el('bulkStop').hidden=true;load();}
}
el('bulkImport').addEventListener('click',startBulkImport);
el('bulkStop').addEventListener('click',()=>{bulkStopRequested=true;el('bulkInfo').textContent='Concluindo o título atual e pausando…';});
