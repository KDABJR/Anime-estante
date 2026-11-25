'use strict';
const SUPABASE_URL = 'https://wpqogkcvpeipvfdztknn.supabase.co';
const SUPABASE_KEY = 'sb_publishable_eYHJUqWBt3FiuxgZOM5KeQ_3_6vA4Mt';
const SESSION_KEY = 'anime-estante-cloud-session';
const STATUSES = ['Pendente', 'Quero assistir', 'Assistindo', 'Assistido', 'Pausado', 'Abandonado', 'Ignorado'];
let session = null;
try { session = JSON.parse(localStorage.getItem(SESSION_KEY)); } catch {}
let refreshTask;

function keepSession(value) {
  if(!value || (session?.user?.id && value.user?.id && session.user.id!==value.user.id)){if(typeof coverCacheReady!=='undefined' && coverCacheReady)clearCoverCache();if(typeof collectionMutationVersion!=='undefined')collectionMutationVersion++;}
  session = value;
  if (value) localStorage.setItem(SESSION_KEY, JSON.stringify(value));
  else localStorage.removeItem(SESSION_KEY);
}
async function send(path, options = {}, authorized = true, retry = true) {
  if (authorized && !session?.access_token) throw new Error('Entre na sua conta da estante.');
  const headers = { apikey: SUPABASE_KEY, ...options.headers };
  if (authorized) headers.Authorization = 'Bearer ' + session.access_token;
  let response;
  try {
    response = await fetch(SUPABASE_URL + path, {
      ...options, headers, signal: AbortSignal.timeout(45000), cache: 'no-store'
    });
  } catch { throw new Error('Sem conexão com a nuvem. Tente novamente quando a internet voltar.'); }
  if (response.status === 401 && authorized && retry && session?.refresh_token) {
    if (!refreshTask) refreshTask = refreshSession().finally(() => { refreshTask = null; });
    await refreshTask;
    return send(path, options, true, false);
  }
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    const message = error.msg || error.message || error.error_description || error.error;
    if (response.status === 401) throw new Error('Sua sessão expirou. Saia e entre novamente.');
    if (/invalid login credentials/i.test(message || '')) throw new Error('E-mail ou senha incorretos.');
    if (/email not confirmed/i.test(message || '')) throw new Error('Confirme seu e-mail antes de entrar.');
    throw new Error(message || 'O serviço não concluiu o pedido (' + response.status + ').');
  }
  return response;
}
async function refreshSession() {
  const response = await send('/auth/v1/token?grant_type=refresh_token', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refresh_token: session.refresh_token })
  }, false);
  keepSession(await response.json());
}
async function signIn(email, password) {
  const response = await send('/auth/v1/token?grant_type=password', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password })
  }, false);
  keepSession(await response.json());
}
async function signUp(email, password) {
  const redirect = '?redirect_to=' + encodeURIComponent(location.origin + location.pathname);
  const response = await send('/auth/v1/signup' + redirect, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password })
  }, false);
  const value = await response.json();
  if (value.access_token) keepSession(value);
  return value;
}
async function recoverAccount(email) {
  const redirect = '?redirect_to=' + encodeURIComponent(location.origin + location.pathname);
  await send('/auth/v1/recover' + redirect, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email })
  }, false);
}
const callback = new URLSearchParams(location.hash.slice(1));
const recovery = callback.get('type') === 'recovery';
if (callback.get('access_token')) {
  keepSession({ access_token: callback.get('access_token'), refresh_token: callback.get('refresh_token') });
  history.replaceState(null, '', location.pathname);
}
let cloudRows = [];
var collectionMutationVersion=0;
function collectionItem(row){return {Id:row.id,Revision:row.updated_at,Title:row._display_title||row.title,AlternateTitle:row._display_alt!==undefined?row._display_alt||'':row.alternate_title||'',Status:row.status,Notes:row.notes,Episode:row.episode,Total:row.total,Rating:row.rating,Favorite:row.favorite,HasCover:!!row.cover_path,AddedAt:row.added_at};}
function collectionSnapshot(){return {statuses:STATUSES,items:cloudRows.filter(row=>!row.deleted_at).map(collectionItem)};}
async function cloudCollection() {
  const epoch=collectionMutationVersion;
  const rows = [];
  for (let offset = 0; ; offset += 500) {
    const response = await send('/rest/v1/animes?select=*&order=id&limit=500&offset=' + offset);
    const batch = await response.json();
    rows.push(...batch);
    if (batch.length < 500) break;
  }
  const visibleRows = typeof sharedCollectionRows === "function" ? await sharedCollectionRows(rows) : rows;
  if(epoch===collectionMutationVersion)cloudRows=visibleRows;
  return collectionSnapshot();
}
async function currentUser() {
  if (session?.user?.id) return session.user;
  const response = await send('/auth/v1/user');
  const user = await response.json();
  keepSession({ ...session, user });
  return user;
}
function uuid(value) {
  if (!value) return crypto.randomUUID();
  const hex = value.replace(/-/g, '');
  if (!/^[a-f0-9]{32}$/i.test(hex)) throw new Error('Identificador de anime inválido.');
  return [hex.slice(0,8),hex.slice(8,12),hex.slice(12,16),hex.slice(16,20),hex.slice(20)].join('-').toLowerCase();
}
async function uploadCover(id, encoded) {
  const binary = atob(encoded);
  if (binary.length > 10485760) throw new Error('Escolha uma capa de até 10 MB.');
  const bytes = Uint8Array.from(binary, character => character.charCodeAt(0));
  const type = bytes[0] === 255 && bytes[1] === 216 ? ['image/jpeg','jpg'] :
    bytes[0] === 137 && bytes[1] === 80 ? ['image/png','png'] :
    bytes[0] === 71 && bytes[1] === 73 ? ['image/gif','gif'] :
    bytes[0] === 66 && bytes[1] === 77 ? ['image/bmp','bmp'] : null;
  if (!type) throw new Error('Use uma capa JPG, PNG, GIF ou BMP.');
  const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))]
    .map(byte => byte.toString(16).padStart(2, '0')).join('');
  const user = await currentUser();
  const path = user.id + '/' + id + '/' + hash + '.' + type[1];
  await send('/storage/v1/object/anime-covers/' + path, {
    method: 'POST', headers: { 'Content-Type': type[0], 'x-upsert': 'true' }, body: bytes
  });
  return path;
}
async function saveCloud(change) {
  if(!change.Id && typeof isAppOwner==='function' && !isAppOwner())throw new Error('Somente @KDAB pode adicionar animes.');
  if(typeof sharingReadonly!=="undefined" && sharingReadonly) throw new Error("Esta coleção está em modo só leitura.");
  const user = await currentUser();
  const id = uuid(change.Id);
  const original = cloudRows.find(row => row.id === id);
  if (change.Id && (!original || original.updated_at !== change.Revision || original.deleted_at))
    throw new Error('Este anime mudou em outro aparelho. Feche e reabra a edição.');
  let cover = change.RemoveCover ? null : original?.cover_path || null;
  if (change.Cover) cover = await uploadCover(id, change.Cover);
  const row = {
    user_id: user.id, id, title: change.Title.trim(), alternate_title: change.AlternateTitle ?? original?.alternate_title ?? null,
    status: change.Status, episode: change.Status === 'Assistido' && change.Total > 0 ? change.Total : change.Episode, total: change.Total, rating: change.Rating,
    favorite: change.Favorite, notes: change.Notes, cover_path: cover
  };
  if(original && typeof isAppOwner==='function' && !isAppOwner()){row.title=original.title;row.alternate_title=original.alternate_title??null;}
  if (!STATUSES.includes(row.status) || !row.title || !Number.isInteger(row.episode) ||
      !Number.isInteger(row.total) || row.episode < 0 || row.total < 0 ||
      row.episode > 100000 || row.total > 100000 || (row.total && row.episode > row.total) ||
      (row.rating !== null && (!Number.isFinite(row.rating) || row.rating < 0 || row.rating > 10 || Math.abs(row.rating*10-Math.round(row.rating*10))>1e-8)))
    throw new Error('Revise os episódios, o status e a nota.');
  if(original?._virtual){row.shared_title_id=original.shared_title_id;if(original._base_user){row.recommended_by_user=original._base_user;row.recommended_from_anime=original._base_anime;}}
  const existing = original && !original._virtual;
  const path = '/rest/v1/animes' + (existing ? '?id=eq.' + id + '&updated_at=eq.' + encodeURIComponent(change.Revision) : '');
  const response = await send(path, {
    method: existing ? 'PATCH' : 'POST', headers: { 'Content-Type': 'application/json', Prefer: 'return=representation' },
    body: JSON.stringify(row)
  });
  const saved=await response.json();
  if (!saved.length) throw new Error('Este anime mudou em outro aparelho. Feche e reabra a edição.');
  const fresh={...original,...row,...saved[0],_virtual:false};
  const index=cloudRows.findIndex(item=>item.id===id);
  if(index<0)cloudRows.push(fresh);else cloudRows[index]=fresh;
  collectionMutationVersion++;
  return { Id: id, Item:collectionItem(fresh) };
}
async function request(path, options = {}) {
  if (path === '/api/collection') return new Response(JSON.stringify(await cloudCollection()));
  if (path === '/api/save') return new Response(JSON.stringify(await saveCloud(JSON.parse(options.body))));
  if (path.startsWith('/api/cover/')) {
    const row = cloudRows.find(item => item.id === decodeURIComponent(path.slice('/api/cover/'.length)));
    if (!row?.cover_path) throw new Error('Capa indisponível.');
    return send('/storage/v1/object/authenticated/anime-covers/' + row.cover_path.split('/').map(encodeURIComponent).join('/'));
  }
  throw new Error('Ação indisponível.');
}

var coverCacheReady=false;const coverCache=new Map();let coverCacheGeneration=0,coverCacheBytes=0;
function clearCoverCache(){coverCacheGeneration++;for(const entry of coverCache.values())if(entry.url)URL.revokeObjectURL(entry.url);coverCache.clear();coverCacheBytes=0;}
function trimCoverCache(){while(coverCache.size>72 || (coverCacheBytes>24*1024*1024 && coverCache.size>1)){const [key,entry]=coverCache.entries().next().value;coverCache.delete(key);coverCacheBytes-=entry.bytes||0;if(entry.url)URL.revokeObjectURL(entry.url);}}
async function getCoverUrl(id){
 const row=cloudRows.find(item=>item.id===id);if(!row?.cover_path)throw new Error('Capa indisponível.');
 const key=(session?.user?.id||'')+':'+row.cover_path;
 if(coverCache.has(key)){const entry=coverCache.get(key);coverCache.delete(key);coverCache.set(key,entry);return entry.task;}
 const entry={url:null,bytes:0},generation=coverCacheGeneration;
 entry.task=(async()=>{const response=await request('/api/cover/'+encodeURIComponent(id));const blob=await response.blob();
  if(generation!==coverCacheGeneration || coverCache.get(key)!==entry)throw new Error('Capa fora da página atual.');
  entry.url=URL.createObjectURL(blob);entry.bytes=blob.size;coverCacheBytes+=blob.size;trimCoverCache();return entry.url;
 })().catch(error=>{if(coverCache.get(key)===entry)coverCache.delete(key);throw error;});
 coverCache.set(key,entry);trimCoverCache();return entry.task;
}

coverCacheReady=true;
