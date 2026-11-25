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
 return rows.filter(row=>!row._virtual && !row.deleted_at && sameDuplicateNumber(row,{title:primaryTitle(media)||media.title?.native,alternate_title:media.title?.english}) && !/^https:\/\/(?:anilist\.co|myanimelist\.net)\/anime\/\d+\/?$/.test(row.seasonal_source||'') &&
  [row.title,row.alternate_title].filter(Boolean).some(title=>families.has(franchiseKey(title))) && /(?:\s\d{1,2}|(?:part|cour|season|temporada|parte)\s*\d{1,2})$/i.test(row.title||''));
}
function duplicateRows(){return cloudRows.filter(row=>!row.deleted_at&&!row._virtual);}
let duplicateScanResults=[],ignoredDuplicatePairs=[],duplicateScanReady=false,ignoredDuplicateVersion=0;
function duplicatePairKey(left,right){return [left,right].sort().join(':');}
async function loadIgnoredDuplicates(){const version=ignoredDuplicateVersion;const pairs=await shelfRPC('anime_ignored_duplicates');if(!Array.isArray(pairs))throw new Error('Não foi possível carregar as sugestões ignoradas.');if(version===ignoredDuplicateVersion)ignoredDuplicatePairs=pairs;}
function duplicateNumber(row){
 for(const title of [row.title,row.alternate_title].filter(Boolean)){
  const season=title.match(/(?:season|temporada)\s*(\d{1,2})\b/i)||title.match(/\b(\d{1,2})(?:st|nd|rd|th)\s+season\b/i);
  const part=title.match(/(?:part|parte|cour)\s*(\d{1,2})\b/i);
  const manual=!season&&!part?title.match(/\s+(\d{1,2})\s*$/):null;
  if(season||part||manual)return {number:Number((season||part||manual)[1]),season:season?Number(season[1]):null,part:part?Number(part[1]):null};
 }
 return {number:1,season:null,part:null};
}
function sameDuplicateNumber(a,b){const x=duplicateNumber(a),y=duplicateNumber(b);return x.number===y.number && !(x.season!==null&&y.season!==null&&x.season!==y.season) && !(x.part!==null&&y.part!==null&&x.part!==y.part);}
function duplicatePairReason(a,b){
 if(!sameDuplicateNumber(a,b))return null;
 const source=x=>(x.seasonal_source||'').replace(/\/$/,'');
 if(source(a)&&source(a)===source(b))return 'Mesmo identificador do catálogo';
 const coversame=a.cover_path&&b.cover_path&&/^[a-f0-9]{64}\./i.test(a.cover_path.split('/').pop())&&a.cover_path.split('/').pop()===b.cover_path.split('/').pop();
 const primarysame=nameKey(a.title)===nameKey(b.title);
 const trusted=x=>/^https:\/\/(anilist\.co|myanimelist\.net)\/anime\/\d+\/?$/.test(source(x));
 if(trusted(a)&&trusted(b)&&source(a)!==source(b)&&!primarysame&&!coversame)return null;
 const names=new Set([a.title,a.alternate_title].filter(Boolean).flatMap(x=>[nameKey(x),firstSeasonKey(x)]));
 if([b.title,b.alternate_title].filter(Boolean).some(x=>names.has(nameKey(x))||names.has(firstSeasonKey(x))))return 'Mesmo nome ou título alternativo; revise as identificações';
 if(coversame)return 'Mesma imagem de capa; confira a temporada';
 if((!trusted(a)||!trusted(b)) && [a.title,a.alternate_title].filter(Boolean).some(x=>[b.title,b.alternate_title].filter(Boolean).some(y=>franchiseKey(x)===franchiseKey(y))))return 'Mesma série com numeração manual; confira a parte/temporada';
 return null;
}
function renderDuplicates(){
 if(!isAppOwner()||sharingReadonly)return;
 const rows=duplicateRows().sort((a,b)=>a.title.localeCompare(b.title,'pt-BR'));
 for(const id of ['duplicateKeep','duplicateDrop']){const select=el(id),value=select.value;select.replaceChildren(new Option('Selecione um anime',''));for(const row of rows)select.add(new Option(row.title+' · '+row.status+' · '+row.id.slice(-6),row.id));select.value=rows.some(row=>row.id===value)?value:'';}
 renderDuplicateSuggestions();renderIgnoredDuplicates();
}
function renderDuplicateSuggestions(){
 const list=el('duplicateSuggestions');list.replaceChildren();
 const ignored=new Set(ignoredDuplicatePairs.map(p=>duplicatePairKey(p.left_id,p.right_id)));
 const rows=new Map(duplicateRows().map(row=>[row.id,row]));
 const visible=duplicateScanResults.filter(p=>!ignored.has(duplicatePairKey(p.left,p.right))&&rows.has(p.left)&&rows.has(p.right));
 for(const pair of visible.slice(0,100)){
  const left=rows.get(pair.left),right=rows.get(pair.right),li=document.createElement('li');
  const caption=document.createElement('p');caption.textContent=pair.reason;caption.className='small';
  const review=document.createElement('button');review.textContent='Revisar '+left.title+' + '+right.title;
  review.addEventListener('click',()=>{el('duplicateKeep').value=left.id;el('duplicateDrop').value=right.id;previewDuplicatePair();});
  const notice=document.createElement('p');notice.className='small';notice.setAttribute('role','status');
  const ignore=document.createElement('button');ignore.textContent='Ignorar sugestão';ignore.addEventListener('click',()=>ignoreDuplicatePair(pair.left,pair.right,true,{button:ignore,notice}));
  li.append(caption,review,ignore,notice);list.append(li);
 }
 if(duplicateScanReady)el('duplicateScanInfo').textContent=visible.length+' possível(is) duplicata(s) para revisar.'+(visible.length>100?' Mostrando as primeiras 100. Ignore ou unifique para ver as próximas.':'');
}
function renderIgnoredDuplicates(){
 const list=el('ignoredDuplicateList');list.replaceChildren();const rows=new Map(duplicateRows().map(row=>[row.id,row]));let count=0;
 for(const pair of ignoredDuplicatePairs){if(!rows.has(pair.left_id)||!rows.has(pair.right_id))continue;count++;
  const li=document.createElement('li'),name=document.createElement('span');name.textContent=rows.get(pair.left_id).title+' + '+rows.get(pair.right_id).title+' ';
  const notice=document.createElement('p');notice.className='small';notice.setAttribute('role','status');const restore=document.createElement('button');restore.textContent='Voltar a analisar';restore.addEventListener('click',()=>ignoreDuplicatePair(pair.left_id,pair.right_id,false,{button:restore,notice}));li.append(name,restore,notice);list.append(li);
 }
 if(!count){const li=document.createElement('li');li.textContent='Nenhuma sugestão ignorada.';list.append(li);}
}
async function ignoreDuplicatePair(left,right,ignore,feedback=null){
 const say=message=>{el('duplicateInfo').textContent=message;if(feedback?.notice)feedback.notice.textContent=message;};
 if(!isAppOwner()||sharingReadonly){say('Abra a sua coleção na conta @KDAB para revisar esta sugestão.');return;}
 if(importing||pending||editor.open){say('Aguarde a operação atual terminar para revisar esta sugestão.');return;}
 importing=true;const oldLabel=feedback?.button?.textContent;
 if(feedback?.button){feedback.button.disabled=true;feedback.button.textContent='Salvando…';}say('Salvando sua decisão…');
 try{
  const pairs=await shelfRPC('anime_ignore_duplicate',{p_left:left,p_right:right,p_ignore:ignore});
  if(!Array.isArray(pairs) || pairs.some(p=>duplicatePairKey(p.left_id,p.right_id)===duplicatePairKey(left,right))!==ignore)throw new Error('O servidor não confirmou a alteração. Tente novamente.');
  ignoredDuplicateVersion++;ignoredDuplicatePairs=pairs;if(ignore && el('duplicateKeep').value && el('duplicateDrop').value && duplicatePairKey(el('duplicateKeep').value,el('duplicateDrop').value)===duplicatePairKey(left,right)){el('duplicateKeep').value=el('duplicateDrop').value='';el('duplicatePreview').replaceChildren();el('duplicateConfirm').disabled=true;}renderDuplicateSuggestions();renderIgnoredDuplicates();
  say(ignore?'Sugestão ignorada. Os dois animes e seus status foram mantidos.':'Sugestão liberada para análise novamente.');
 }catch(error){say('Não foi possível salvar: '+error.message);}
 finally{importing=false;if(feedback?.button){feedback.button.disabled=false;feedback.button.textContent=oldLabel;}if(typeof applySharingAccess==='function')applySharingAccess();}
}
async function scanDuplicates(){
 if(!isAppOwner()||sharingReadonly||importing||pending||loading||editor.open)return;
 importing=true;el('scanDuplicates').disabled=true;el('duplicateScanInfo').textContent='Atualizando a coleção para iniciar a varredura…';
 try{
  await cloudCollection();await Promise.all([loadImportAliases(),loadIgnoredDuplicates()]);
  const rows=duplicateRows(),groups=new Map();
  for(const row of rows){const keys=new Set();
   for(const name of [row.title,row.alternate_title].filter(Boolean)){keys.add('name:'+nameKey(name));keys.add('name:'+firstSeasonKey(name));keys.add('family:'+franchiseKey(name));}
   if(row.seasonal_source)keys.add('source:'+row.seasonal_source.replace(/\/$/,''));
   if(row.cover_path&&/^[a-f0-9]{64}\./i.test(row.cover_path.split('/').pop()))keys.add('cover:'+row.cover_path.split('/').pop());
   for(const key of keys){if(!groups.has(key))groups.set(key,[]);groups.get(key).push(row);}
  }
  const seen=new Set(),results=[];let compared=0;
  for(const group of groups.values())for(let i=0;i<group.length;i++)for(let j=i+1;j<group.length;j++){
   const key=duplicatePairKey(group[i].id,group[j].id);if(seen.has(key))continue;seen.add(key);
   const reason=duplicatePairReason(group[i],group[j]);if(reason){const [left,right]=[group[i],group[j]].sort((a,b)=>a.added_at&&b.added_at?Date.parse(a.added_at)-Date.parse(b.added_at):a.id.localeCompare(b.id));results.push({left:left.id,right:right.id,reason});}
   if(++compared%250===0){el('duplicateScanInfo').textContent='Analisando '+rows.length+' registros · '+compared+' comparações…';await new Promise(resolve=>setTimeout(resolve,0));}
  }
  duplicateScanResults=results;duplicateScanReady=true;renderDuplicates();el('duplicateInfo').textContent='Varredura concluída em '+rows.length+' animes. Nenhum registro foi unido automaticamente.';
 }catch(error){el('duplicateScanInfo').textContent=error.message;}
 finally{importing=false;el('scanDuplicates').disabled=false;}
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
 if(!isAppOwner()||sharingReadonly){el('duplicateInfo').textContent='Abra a sua coleção na conta @KDAB para unificar.';return;}
 if(importing||pending||editor.open){el('duplicateInfo').textContent='Aguarde a operação atual terminar antes de unificar.';return;}
 const keep=cloudRows.find(r=>r.id===el('duplicateKeep').value),drop=cloudRows.find(r=>r.id===el('duplicateDrop').value);
 if(!keep||!drop||keep.id===drop.id)return;
 importing=true;let merged=false;el('duplicateConfirm').disabled=true;el('duplicateInfo').textContent='Unificando os registros de cada conta…';
 try{
  const result=await shelfRPC('anime_merge_duplicates',{p_keep:keep.id,p_drop:drop.id,p_keep_revision:keep.updated_at,p_drop_revision:drop.updated_at});
  merged=true;collectionMutationVersion++;cloudRows=cloudRows.map(row=>row.id===drop.id?{...row,deleted_at:new Date().toISOString(),shared_title_id:null}:row);
  duplicateScanResults=duplicateScanResults.filter(pair=>pair.left!==drop.id&&pair.right!==drop.id);
  items=collectionSnapshot().items;lastData='';render();renderDuplicateSuggestions();renderIgnoredDuplicates();
  el('duplicateKeep').value=el('duplicateDrop').value='';el('duplicatePreview').replaceChildren();
  el('duplicateInfo').textContent='Unificado em '+result.title+'. Registros de '+result.accounts_preserved+' conta(s) preservados, com cópia de segurança.';
  try{
   const [response]=await Promise.all([send('/rest/v1/animes?select=*&id=eq.'+encodeURIComponent(keep.id)+'&deleted_at=is.null&limit=1'),loadImportAliases()]);
   const fresh=await response.json();if(fresh.length){const index=cloudRows.findIndex(row=>row.id===keep.id);if(index>=0)cloudRows[index]={...cloudRows[index],...fresh[0]};items=collectionSnapshot().items;lastData='';render();}
  }catch{el('duplicateInfo').textContent+=' A união foi concluída; reabra a página para atualizar os detalhes.';}
 }catch(error){el('duplicateInfo').textContent=error.message;}
 finally{importing=false;renderDuplicates();el('duplicateConfirm').disabled=merged||!el('duplicateKeep').value||!el('duplicateDrop').value;if(typeof applySharingAccess==='function')applySharingAccess();}
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
el('scanDuplicates').addEventListener('click',scanDuplicates);
el('ignoredDuplicatePanel').addEventListener('toggle',async()=>{if(!el('ignoredDuplicatePanel').open || !isAppOwner() || importing)return;try{await loadIgnoredDuplicates();renderIgnoredDuplicates();}catch(error){el('duplicateInfo').textContent=error.message;}});
el('updateEpisodes').addEventListener('click',()=>seasonalJob('episodes'));

function resetDuplicateUI(){duplicatePreviewTicket++;duplicatePreviewUrls.forEach(URL.revokeObjectURL);duplicatePreviewUrls=[];importAliases=[];duplicateScanResults=[];ignoredDuplicatePairs=[];ignoredDuplicateVersion++;duplicateScanReady=false;for(const id of ['duplicateKeep','duplicateDrop'])el(id).replaceChildren(new Option('Selecione um anime',''));el('duplicatePreview').replaceChildren();el('duplicateSuggestions').replaceChildren();el('duplicateInfo').textContent='';el('ownerTools').hidden=true;}
