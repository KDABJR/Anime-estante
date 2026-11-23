'use strict';
const seasonQuery = `query($page:Int,$season:MediaSeason,$year:Int){Page(page:$page,perPage:50){pageInfo{hasNextPage} media(type:ANIME,season:$season,seasonYear:$year,countryOfOrigin:"JP",isAdult:false,sort:ID){id idMal countryOfOrigin title{romaji english native} synonyms episodes coverImage{large}}}}`;
const nameQuery = `query($search:String){Page(page:1,perPage:10){media(type:ANIME,search:$search){id idMal title{romaji english native} synonyms}}}`;
let catalogRequestAt = 0;
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
function seasonNow(date = new Date()) {
  const japan = new Date(date.getTime() + 9*3600000);
  const quarter = Math.floor(japan.getUTCMonth()/3);
  return {season:['WINTER','SPRING','SUMMER','FALL'][quarter],year:japan.getUTCFullYear(),
    label:['Inverno','Primavera','Verão','Outono'][quarter]+' de '+japan.getUTCFullYear()+' no Japão'};
}
function nameKey(value) { return (value || '').normalize('NFKC').toLocaleLowerCase().replace(/[\p{P}\p{Z}\s]/gu,''); }
function mediaNames(media) { return [...new Set([media.title?.romaji,media.title?.english,media.title?.native,...(media.synonyms||[])].filter(Boolean))]; }
function mediaSources(media) { return ['https://anilist.co/anime/'+media.id,...(media.idMal?['https://myanimelist.net/anime/'+media.idMal]:[])]; }
function matchingRow(media, rows) {
  const names = new Set(mediaNames(media).map(nameKey));
  const sources = mediaSources(media);
  return rows.find(row => sources.includes((row.seasonal_source||'').replace(/\/$/,'')) ||
    [row.title,row.alternate_title].filter(Boolean).some(title=>names.has(nameKey(title))));
}
function secondaryTitle(media, primary) {
  return [media.title?.english,media.title?.romaji,media.title?.native].find(title=>title && nameKey(title)!==nameKey(primary)) || null;
}
async function catalog(query, variables) {
  await pause(Math.max(0,2200-(Date.now()-catalogRequestAt)));
  catalogRequestAt=Date.now();
  let response;
  try { response=await fetch('https://graphql.anilist.co',{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({query,variables}),signal:AbortSignal.timeout(30000)}); }
  catch {throw new Error('Não foi possível consultar o catálogo AniList. Tente novamente mais tarde.');}
  if(response.status===429) throw new Error('O catálogo atingiu o limite de consultas. Tente novamente mais tarde.');
  if(!response.ok) throw new Error('Catálogo indisponível ('+response.status+').');
  const result=await response.json();
  if(result.errors?.length || !result.data?.Page) throw new Error('O catálogo não retornou uma lista válida.');
  return result.data.Page;
}
async function seasonalMedia(season) {
  const result=new Map();
  for(let page=1;page<=100;page++) {
    const batch=await catalog(seasonQuery,{page,season:season.season,year:season.year});
    for(const media of batch.media) if(media.countryOfOrigin==='JP') result.set(media.id,media);
    if(!batch.pageInfo.hasNextPage) return [...result.values()];
  }
  throw new Error('O catálogo retornou páginas demais. Nenhum título foi importado.');
}
async function seasonalId(userId, mediaId) {
  const bytes=new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(userId+':anilist:'+mediaId)));
  bytes[6]=(bytes[6]&15)|80; bytes[8]=(bytes[8]&63)|128;
  return uuid([...bytes.slice(0,16)].map(b=>b.toString(16).padStart(2,'0')).join(''));
}
async function catalogCover(id, url) {
  if(!url) throw new Error('Capa não disponível no catálogo.');
  const parsed=new URL(url);
  if(parsed.protocol!=='https:' || !['s4.anilist.co','s3.anilist.co'].includes(parsed.hostname)) throw new Error('Endereço de capa não reconhecido.');
  const response=await fetch(url,{signal:AbortSignal.timeout(30000)});
  if(!response.ok) throw new Error('Não foi possível baixar a capa.');
  const bytes=new Uint8Array(await response.arrayBuffer());
  if(bytes.length>10485760) throw new Error('Capa maior que 10 MB.');
  let binary='';
  for(let index=0;index<bytes.length;index+=8192) binary+=String.fromCharCode(...bytes.subarray(index,index+8192));
  return uploadCover(id,btoa(binary));
}
async function patchMetadata(row, fields) {
  const response=await send('/rest/v1/animes?id=eq.'+row.id+'&updated_at=eq.'+encodeURIComponent(row.updated_at)+'&deleted_at=is.null',{
    method:'PATCH',headers:{'Content-Type':'application/json',Prefer:'return=representation'},body:JSON.stringify(fields)});
  const updated=await response.json();
  if(!updated.length) throw new Error('Alterado em outro aparelho; tente novamente.');
  Object.assign(row,updated[0]);
}
async function reconcileCompleted(rows) {
  let count=0;
  for(const row of rows) if(!row.deleted_at && row.status==='Assistido' && row.total>0 && row.episode!==row.total) {
    await patchMetadata(row,{episode:row.total}); count++;
  }
  return count;
}
async function importSeason(onProgress) {
  const season=seasonNow();
  onProgress('Consultando '+season.label+'…');
  const media=await seasonalMedia(season);
  const user=await currentUser();
  let added=0,existing=0,updated=0; const failures=[];
  for(let index=0;index<media.length;index++) {
    const item=media[index], title=item.title.romaji || item.title.english || item.title.native;
    onProgress((index+1)+'/'+media.length+' · '+title);
    try {
      const row=matchingRow(item,cloudRows);
      if(row) {
        existing++;
        if(row.deleted_at) continue;
        const fields={};
        if(!row.alternate_title?.trim()) {const alt=secondaryTitle(item,row.title); if(alt) fields.alternate_title=alt;}
        if(!row.cover_path) {
          try {fields.cover_path=await catalogCover(row.id,item.coverImage?.large);}
          catch(error){failures.push(title+' — '+error.message);}
        }
        if(Object.keys(fields).length) {await patchMetadata(row,fields); updated++;}
        continue;
      }
      const id=await seasonalId(user.id,item.id);
      let cover=null;
      try {cover=await catalogCover(id,item.coverImage?.large);}
      catch(error){failures.push(title+' — '+error.message);}
      const rowToAdd={id,user_id:user.id,title,alternate_title:secondaryTitle(item,title),status:'Pendente',episode:0,
        total:Number.isInteger(item.episodes)&&item.episodes>0?item.episodes:0,rating:0,favorite:false,notes:'',
        cover_path:cover,seasonal_source:mediaSources(item)[0],added_at:new Date().toISOString()};
      const response=await send('/rest/v1/animes?on_conflict=user_id,id', {method:'POST',
        headers:{'Content-Type':'application/json',Prefer:'resolution=ignore-duplicates,return=representation'},body:JSON.stringify(rowToAdd)});
      const inserted=await response.json();
      cloudRows.push(inserted[0] || rowToAdd);
      if(inserted.length) added++; else existing++;
    } catch(error){failures.push(title+' — '+error.message);}
  }
  return {message:season.label+': '+added+' adicionados como Pendente · '+existing+' já cadastrados · '+updated+' complementados.',failures};
}
async function completeTitles(onProgress) {
  const rows=cloudRows.filter(row=>!row.deleted_at && !row.alternate_title?.trim());
  let count=0; const failures=[];
  for(let index=0;index<rows.length;index++) {
    const row=rows[index]; onProgress((index+1)+'/'+rows.length+' · '+row.title);
    try {
      const source=(row.seasonal_source||'').match(/https:\/\/(anilist\.co|myanimelist\.net)\/anime\/(\d+)/);
      let candidates;
      if(source) {
        const key=source[1]==='anilist.co'?'id':'idMal';
        const query=`query($id:Int){Page(page:1,perPage:1){media(type:ANIME,${key}:$id){id idMal title{romaji english native} synonyms}}}`;
        candidates=(await catalog(query,{id:Number(source[2])})).media;
      } else candidates=(await catalog(nameQuery,{search:row.title})).media;
      const matches=candidates.filter(item=>matchingRow(item,[row]));
      if(matches.length!==1) {failures.push(row.title+' — correspondência não confirmada.');continue;}
      const alternate=secondaryTitle(matches[0],row.title);
      if(!alternate) {failures.push(row.title+' — sem título secundário disponível.');continue;}
      await patchMetadata(row,{alternate_title:alternate}); count++;
    } catch(error){failures.push(row.title+' — '+error.message); if(/limite de consultas|indisponível/.test(error.message)) break;}
  }
  return {message:count+' títulos secundários preenchidos.',failures};
}
function seasonPreference(userId) {return 'anime-season-jp:'+userId;}
function readSeasonPreference(userId) {try{return JSON.parse(localStorage.getItem(seasonPreference(userId))) || {};}catch{return {};}}
function writeSeasonPreference(userId,value){localStorage.setItem(seasonPreference(userId),JSON.stringify(value));}
async function seasonalJob(kind) {
  if(importing || pending || loading || editor.open || !session) return false;
  importing=true;
  const buttons=['seasonImport','completeTitles','importButton','add','seasonAuto'];
  buttons.forEach(id=>el(id).disabled=true);
  el('seasonErrors').replaceChildren();
  const progress=text=>el('seasonInfo').textContent=text;
  try {
    await cloudCollection();
    const fixed=await reconcileCompleted(cloudRows);
    const result=kind==='season'?await importSeason(progress):kind==='titles'?await completeTitles(progress):{message:fixed+' assistidos atualizados.',failures:[]};
    progress(result.message+(result.failures.length?' '+result.failures.length+' avisos; confira abaixo.':''));
    for(const failure of result.failures){const li=document.createElement('li');li.textContent=failure;el('seasonErrors').append(li);}
    if(kind==='season' && !result.failures.length) {
      const user=await currentUser(), pref=readSeasonPreference(user.id), season=seasonNow();
      writeSeasonPreference(user.id,{...pref,checked:Date.now(),season:season.season+season.year});
    }
    return true;
  } catch(error){progress(error.message);return false;}
  finally {importing=false;buttons.forEach(id=>el(id).disabled=false);load();}
}
let seasonAttempt=0,completedAccount=null;
async function automaticSeason() {
  if(document.hidden || !session || importing || loading || pending || editor.open) return;
  const user=await currentUser();
  const pref=readSeasonPreference(user.id);
  el('seasonAuto').checked=!!pref.enabled;
  el('seasonLabel').textContent=seasonNow().label;
  if(completedAccount!==user.id) {if(await seasonalJob('completed')) completedAccount=user.id; return;}
  const season=seasonNow();
  if(pref.enabled && (pref.season!==season.season+season.year || Date.now()-(pref.checked||0)>86400000) && Date.now()-seasonAttempt>3600000) {
    seasonAttempt=Date.now(); await seasonalJob('season');
  }
}
el('seasonImport').addEventListener('click',()=>seasonalJob('season'));
el('completeTitles').addEventListener('click',()=>seasonalJob('titles'));
el('seasonAuto').addEventListener('change',async()=>{
  const enabled=el('seasonAuto').checked;
  try {const user=await currentUser();writeSeasonPreference(user.id,{...readSeasonPreference(user.id),enabled});if(enabled) await seasonalJob('season');}
  catch(error){el('seasonInfo').textContent=error.message;}
});
setTimeout(()=>automaticSeason().catch(()=>{}),2000);
setInterval(()=>automaticSeason().catch(()=>{}),15000);
