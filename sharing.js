'use strict';
let sharingState={shelf:null,members:[]}, sharingTarget='', sharingReadonly=false;
async function shelfRPC(name,values={}) {
 const response=await send('/rest/v1/rpc/'+name,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(values)});
 return response.json();
}
function baseRowMatches(row,title){
 if(row.shared_title_id && title.shared_title_id)return row.shared_title_id===title.shared_title_id;
 if(title.base_source_anime && ((row.recommended_by_user===title.base_source_user && row.recommended_from_anime===title.base_source_anime) || (row.user_id===title.base_source_user && row.id===title.base_source_anime)))return true;
 if(row.seasonal_source && row.seasonal_source===title.seasonal_source)return true;
 const aliases=[title.title,title.alternate_title].filter(Boolean).map(t=>t.trim().toLocaleLowerCase());
 return [row.title,row.alternate_title].filter(Boolean).some(t=>aliases.includes(t.trim().toLocaleLowerCase()));
}
function virtualSharedRows(rows,catalog,userId) {
 const linked=new Set(rows.map(row=>row.shared_title_id).filter(Boolean));
 const readable=value=>!!value && !/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u.test(value);
 const baseOwners=new Set(catalog.filter(t=>t.base_source_user).map(t=>t.base_source_user));
 const onlyBaseOwner=baseOwners.size===1?[...baseOwners][0]:null;
 const directIds=new Set(rows.map(row=>row.user_id+':'+row.id));
 const result=rows.map(row=>{
  if(row.user_id===onlyBaseOwner)return row;
  const base=catalog.find(t=>t.base_source_anime && t.base_source_user!==row.user_id && baseRowMatches(row,t));
  if(!base)return row;
  return {...row,_display_title:!readable(row.title)&&readable(base.title)?base.title:row.title,
   _display_alt:readable(row.alternate_title)?row.alternate_title:readable(base.alternate_title)?base.alternate_title:null};
 });
 for(const title of catalog) if(!linked.has(title.id) && (!title.base_source_anime || (!directIds.has(title.base_source_user+':'+title.base_source_anime) && !rows.some(row=>baseRowMatches(row,title))))) result.push({id:title.id,user_id:userId,shared_title_id:title.base_source_anime ? title.shared_title_id : title.id,_base_user:title.base_source_user,_base_anime:title.base_source_anime,
  title:title.title,alternate_title:title.alternate_title,total:title.total,cover_path:title.cover_path,
  seasonal_source:title.seasonal_source,added_at:title.added_at,updated_at:'shared:'+title.id,
  status:'Pendente',episode:0,rating:null,favorite:false,notes:'',deleted_at:null,_virtual:true});
 return result;
}
async function sharedCollectionRows(ownRows) {
 let state;
 try {state=await shelfRPC('shelf_state');}
 catch(error){
  if(/Could not find.*shelf_state|function.*shelf_state.*does not exist/i.test(error.message)) {
   el('connection').textContent='Para ativar o compartilhamento, execute o arquivo Compartilhar-Estante.sql no Supabase.';
   return ownRows;
  }
  throw error;
 }
 sharingState=state;
 if(typeof loadFriendsState==='function')await loadFriendsState();
 const user=await currentUser();
 if(!(typeof visibleCollectionPeople==='function'?visibleCollectionPeople():state.members).some(member=>member.user_id===sharingTarget)) sharingTarget='';
 sharingReadonly=!!sharingTarget && sharingTarget!==user.id;
 let rows=ownRows;
 if(sharingReadonly) {
  rows=[];
  for(let offset=0;;offset+=500){const batch=await shelfRPC('shelf_view',{p_user:sharingTarget,p_offset:offset});rows.push(...batch);if(batch.length<500)break;}
 }
 const catalog=[];
 if(state.shelf || sharingReadonly) for(let offset=0;;offset+=500){const batch=await shelfRPC(sharingReadonly?'shelf_view_catalog':'shelf_catalog',sharingReadonly?{p_user:sharingTarget,p_offset:offset}:{p_offset:offset});catalog.push(...batch);if(batch.length<500)break;}
 try{for(let offset=0;;offset+=500){const batch=await shelfRPC('anime_base_catalog',{p_offset:offset});for(const title of batch){const index=catalog.findIndex(t=>t.id===title.id);if(index<0)catalog.push(title);else catalog[index]=title;}if(batch.length<500)break;}}
 catch(error){if(!/Could not find.*anime_base_catalog|function.*anime_base_catalog.*does not exist/i.test(error.message))throw error;}
 updateSharingControls(user);
 return virtualSharedRows(rows,catalog,sharingTarget||user.id);
}
function updateSharingControls(user) {
 const selector=el('viewCollection');selector.replaceChildren(new Option('Minha coleção',''));
 for(const member of (typeof visibleCollectionPeople==='function'?visibleCollectionPeople():sharingState.members)) if(member.user_id!==user.id) selector.add(new Option((typeof accountName==='function'?accountName(member.username,member.label):member.label)+' · só visualizar',member.user_id));
 selector.value=sharingTarget;
 el('viewCollectionLabel').hidden=!sharingState.shelf && !(sharingState.friends||[]).length;
 if(typeof updateAccountControls==='function')updateAccountControls(user);
 applySharingAccess();
}
function applySharingAccess() {
 const readonly=sharingReadonly;
 el('viewBanner').hidden=!readonly;
 if(readonly) el('viewBanner').textContent='Só visualizar · '+(typeof collectionPersonName==='function'?collectionPersonName(sharingTarget):(sharingState.members.find(m=>m.user_id===sharingTarget)?.label||'Outra pessoa'))+' · nenhuma alteração será salva nesta coleção.';
 const allowed=typeof isAppOwner==='function' && isAppOwner();
 el('add').disabled=readonly || importing || !allowed;el('add').hidden=!allowed;
 if(el('ownerTools'))el('ownerTools').hidden=readonly || !allowed;
 if(el('collectionHeading'))el('collectionHeading').textContent=readonly?'Coleção de '+(typeof collectionPersonName==='function'?collectionPersonName(sharingTarget):'outra pessoa'):'Minha coleção';
 el('seasonPanel').hidden=readonly || !allowed;
}
function setSharedEditorAccess(){
 for(const field of form.querySelectorAll('input,select,textarea'))field.disabled=sharingReadonly;
 el('save').hidden=sharingReadonly;
 if(!sharingReadonly && typeof isAppOwner==='function' && !isAppOwner())for(const id of ['title','alternate','total','cover','removeCover'])el(id).disabled=true;
 if(sharingReadonly)el('editorTitle').textContent='Consultar anime · só leitura';
}
function personalSharedRow(row, fields={}) {
 return {user_id:session.user.id,id:row.id,shared_title_id:row.shared_title_id,recommended_by_user:row._base_user,recommended_from_anime:row._base_anime,title:row.title,
  alternate_title:row.alternate_title,total:row.total,cover_path:row.cover_path,seasonal_source:row.seasonal_source,
  added_at:row.added_at,status:'Pendente',episode:0,rating:null,favorite:false,notes:'',...fields};
}
async function saveVirtualMetadata(row,fields) {
 if(sharingReadonly)throw new Error('Esta coleção está em modo só leitura.');
 const response=await send('/rest/v1/animes',{method:'POST',headers:{'Content-Type':'application/json',Prefer:'return=representation'},body:JSON.stringify(personalSharedRow(row,fields))});
 const data=await response.json();if(!data.length)throw new Error('Atualize a coleção e tente novamente.');
 Object.assign(row,data[0],{_virtual:false});
}
el('viewCollection').addEventListener('change',()=>{
 if(pending||importing||loading||editor.open){el('viewCollection').value=sharingTarget;return;}
 sharingTarget=el('viewCollection').value;sharingReadonly=!!sharingTarget;lastData='';page=0;applySharingAccess();load();
});
