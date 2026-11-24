'use strict';
let importAliases=[],duplicatePreviewTicket=0,duplicatePreviewUrls=[];
async function loadImportAliases(){
 if(!isAppOwner())return;
 try{importAliases=await shelfRPC('anime_import_aliases_list');}
 catch(error){if(!/Could not find.*anime_import_aliases_list|function.*anime_import_aliases_list.*does not exist/i.test(error.message))throw error;}
}
function franchiseKey(value){return nameKey((value||'').replace(/\s+(?:(?:season|temporada|part|parte|cour)\s*)?\d{1,2}$/i,'')).replace(/(?:season|temporada|part|parte|cour)\d{1,2}$/,'');}
function manualDuplicateCandidates(media,rows){
 const families=new Set(mediaNames(media).map(franchiseKey));
 return rows.filter(row=>!row._virtual && !row.deleted_at && !/^https:\/\/(?:anilist\.co|myanimelist\.net)\/anime\/\d+\/?$/.test(row.seasonal_source||'') &&
  [row.title,row.alternate_title].filter(Boolean).some(title=>families.has(franchiseKey(title))) && /(?:\s\d{1,2}|(?:part|cour|season|temporada|parte)\s*\d{1,2})$/i.test(row.title||''));
}
function duplicateRows(){return cloudRows.filter(row=>!row.deleted_at&&!row._virtual);}
function renderDuplicates(){
 if(!isAppOwner()||sharingReadonly)return;
 const rows=duplicateRows().sort((a,b)=>a.title.localeCompare(b.title,'pt-BR'));
 for(const id of ['duplicateKeep','duplicateDrop']){const select=el(id),value=select.value;select.replaceChildren(new Option('Selecione um anime',''));for(const row of rows)select.add(new Option(row.title+' · '+row.status+' · '+row.id.slice(-6),row.id));select.value=rows.some(row=>row.id===value)?value:'';}
 const list=el('duplicateSuggestions');list.replaceChildren();let count=0;
 for(const imported of rows.filter(row=>/^https:\/\/(?:anilist\.co|myanimelist\.net)\/anime\//.test(row.seasonal_source||''))){
  const candidates=rows.filter(row=>row.id!==imported.id && !row.seasonal_source && franchiseKey(row.title)===franchiseKey(imported.title));
  for(const original of candidates.slice(0,4)){
   if(count++>=30)break;const li=document.createElement('li');const button=document.createElement('button');button.textContent='Revisar '+original.title+' + '+imported.title;
   button.addEventListener('click',()=>{el('duplicateKeep').value=original.id;el('duplicateDrop').value=imported.id;previewDuplicatePair();});li.append(button);list.append(li);
  }if(count>=30)break;
 }
}
async function previewDuplicatePair(){
 const ticket=++duplicatePreviewTicket;duplicatePreviewUrls.forEach(URL.revokeObjectURL);duplicatePreviewUrls=[];
 const keep=cloudRows.find(r=>r.id===el('duplicateKeep').value),drop=cloudRows.find(r=>r.id===el('duplicateDrop').value);
 el('duplicateConfirm').disabled=!keep||!drop||keep.id===drop.id;el('duplicatePreview').replaceChildren();
 for(const [label,row] of [['Manter como principal',keep],['Unificar neste cadastro',drop]])if(row){
  const card=document.createElement('article');card.className='duplicate-card';const heading=document.createElement('strong');heading.textContent=label;
  const art=document.createElement('div');art.className='duplicate-art';art.textContent=row.cover_path?'Carregando capa…':'Sem capa';
  const name=document.createElement('h4');name.textContent=row.title;const state=document.createElement('p');state.className='small';state.textContent=row.status+' · Ep. '+row.episode+(row.total?'/'+row.total:'')+(row.rating==null?'':' · '+formatRating(row.rating)+'/10');
  card.append(heading,art,name,state);el('duplicatePreview').append(card);
  if(row.cover_path)try{const blob=await(await request('/api/cover/'+row.id)).blob();if(ticket!==duplicatePreviewTicket)return;const image=new Image();image.alt=row.title;const url=URL.createObjectURL(blob);duplicatePreviewUrls.push(url);image.src=url;art.replaceChildren(image);}catch{if(ticket===duplicatePreviewTicket)art.textContent='Capa indisponível';}
 }
}
async function mergeSelectedDuplicates(){
 if(!isAppOwner()||sharingReadonly||importing||pending||loading||editor.open)return;
 const keep=cloudRows.find(r=>r.id===el('duplicateKeep').value),drop=cloudRows.find(r=>r.id===el('duplicateDrop').value);
 if(!keep||!drop||keep.id===drop.id)return;
 importing=true;el('duplicateConfirm').disabled=true;el('duplicateInfo').textContent='Unificando os registros de cada conta…';
 try{
  const result=await shelfRPC('anime_merge_duplicates',{p_keep:keep.id,p_drop:drop.id,p_keep_revision:keep.updated_at,p_drop_revision:drop.updated_at});
  el('duplicateInfo').textContent='Unificado em '+result.title+'. Registros de '+result.accounts_preserved+' conta(s) preservados, com cópia de segurança.';
  el('duplicateKeep').value=el('duplicateDrop').value='';el('duplicatePreview').replaceChildren();lastData='';await loadImportAliases();
 }catch(error){el('duplicateInfo').textContent=error.message;}
 finally{importing=false;await load();renderDuplicates();}
}
async function updateEpisodeTotals(onProgress){
 const rows=cloudRows.filter(row=>!row.deleted_at&&!row._virtual);let updated=0,unchanged=0;const failures=[];
 for(let index=0;index<rows.length;index++){
  const row=rows[index];onProgress((index+1)+'/'+rows.length+' · '+row.title);
  try{
   const source=(row.seasonal_source||'').match(/https:\/\/(anilist\.co|myanimelist\.net)\/anime\/(\d+)/);
   let candidates;
   if(source){const field=source[1]==='anilist.co'?'id':'idMal';candidates=(await catalog(`query($id:Int){Page(page:1,perPage:1){media(type:ANIME,${field}:$id){id idMal title{romaji english native} synonyms episodes}}}`,{id:Number(source[2])})).media;}
   else{const search=row.title.replace(/\s+(?:(?:season|temporada)\s*)?1$/i,'');candidates=(await catalog(`query($search:String){Page(page:1,perPage:10){media(type:ANIME,search:$search){id idMal title{romaji english native} synonyms episodes}}}`,{search})).media;}
   const matches=candidates.filter(item=>matchingRow(item,[row]));if(matches.length!==1)throw new Error('Correspondência não confirmada; revise a temporada/parte.');
   const total=matches[0].episodes;if(!Number.isInteger(total)||total<1)throw new Error('O catálogo ainda não informa o total.');
   if(row.total===total){unchanged++;continue;}
   const result=await shelfRPC('anime_update_episode_total',{p_anime:row.id,p_revision:row.updated_at,p_total:total});updated++;
   if(result.preserved_for_review)failures.push(row.title+' — '+result.preserved_for_review+' progresso(s) acima do total preservado(s) para revisão.');
  }catch(error){failures.push(row.title+' — '+error.message);if(/limite de consultas|indisponível/.test(error.message))break;}
 }
 return {message:updated+' totais atualizados · '+unchanged+' já corretos.',failures};
}
el('duplicatesPanel').addEventListener('toggle',()=>{if(el('duplicatesPanel').open)renderDuplicates();});
for(const id of ['duplicateKeep','duplicateDrop'])el(id).addEventListener('change',previewDuplicatePair);
el('duplicateConfirm').addEventListener('click',mergeSelectedDuplicates);
el('updateEpisodes').addEventListener('click',()=>seasonalJob('episodes'));

function resetDuplicateUI(){duplicatePreviewTicket++;duplicatePreviewUrls.forEach(URL.revokeObjectURL);duplicatePreviewUrls=[];importAliases=[];for(const id of ['duplicateKeep','duplicateDrop'])el(id).replaceChildren(new Option('Selecione um anime',''));el('duplicatePreview').replaceChildren();el('duplicateSuggestions').replaceChildren();el('duplicateInfo').textContent='';el('ownerTools').hidden=true;}
