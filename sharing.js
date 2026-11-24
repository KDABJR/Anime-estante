'use strict';
let sharingState={shelf:null,members:[]}, sharingTarget='', sharingReadonly=false;
async function shelfRPC(name,values={}) {
 const response=await send('/rest/v1/rpc/'+name,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(values)});
 return response.json();
}
function virtualSharedRows(rows,catalog,userId) {
 const linked=new Set(rows.map(row=>row.shared_title_id).filter(Boolean));
 const result=[...rows];
 for(const title of catalog) if(!linked.has(title.id)) result.push({id:title.id,user_id:userId,shared_title_id:title.id,
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
   el('sharingInfo').textContent='Para ativar o compartilhamento, execute o arquivo Compartilhar-Estante.sql no Supabase.';
   return ownRows;
  }
  throw error;
 }
 sharingState=state;
 const user=await currentUser();
 if(!state.members.some(member=>member.user_id===sharingTarget)) sharingTarget='';
 sharingReadonly=!!sharingTarget && sharingTarget!==user.id;
 let rows=ownRows;
 if(sharingReadonly) {
  rows=[];
  for(let offset=0;;offset+=500){const batch=await shelfRPC('shelf_view',{p_user:sharingTarget,p_offset:offset});rows.push(...batch);if(batch.length<500)break;}
 }
 const catalog=[];
 if(state.shelf) for(let offset=0;;offset+=500){const batch=await shelfRPC('shelf_catalog',{p_offset:offset});catalog.push(...batch);if(batch.length<500)break;}
 updateSharingControls(user);
 return virtualSharedRows(rows,catalog,sharingTarget||user.id);
}
function updateSharingControls(user) {
 const selector=el('viewCollection');selector.replaceChildren(new Option('Minha coleção',''));
 for(const member of sharingState.members) if(member.user_id!==user.id) selector.add(new Option((typeof accountName==='function'?accountName(member.username,member.label):member.label)+' · só visualizar',member.user_id));
 selector.value=sharingTarget;
 el('sharedShelfName').textContent=sharingState.shelf ? sharingState.shelf.name+' · '+sharingState.members.length+' pessoa(s)' : 'Sua coleção ainda não está compartilhada.';
 el('createShelf').hidden=el('joinShelf').hidden=!!sharingState.shelf;
 el('inviteShelf').hidden=!sharingState.shelf || sharingState.shelf.owner_id!==user.id;
 el('viewCollectionLabel').hidden=!sharingState.shelf;
 const membersList=el('sharedMembers');membersList.replaceChildren();
 for(const member of sharingState.members){
  const li=document.createElement('li');li.textContent=(typeof accountName==='function'?accountName(member.username,member.label):member.label)+(member.user_id===user.id?' (você)':'');
  if(member.user_id!==sharingState.shelf.owner_id && (sharingState.shelf.owner_id===user.id || member.user_id===user.id)){
   const button=document.createElement('button');button.textContent=member.user_id===user.id?'Sair da estante':'Remover acesso';
   button.style.marginLeft='8px';button.addEventListener('click',()=>{
    if(pending||importing||loading||editor.open)return;
    removingMember=member.user_id;el('removeMemberInfo').textContent='Encerrar o acesso de '+member.label+'?';
    el('removeMemberError').textContent='';el('removeMemberDialog').showModal();
   });li.append(button);
  }membersList.append(li);
 }
 if(typeof updateAccountControls==='function')updateAccountControls(user);
 applySharingAccess();
}
function applySharingAccess() {
 const readonly=sharingReadonly;
 el('viewBanner').hidden=!readonly;
 if(readonly) el('viewBanner').textContent='Só visualizar · '+(sharingState.members.find(m=>m.user_id===sharingTarget)?.label||'Outra pessoa')+' · nenhuma alteração será salva nesta coleção.';
 const allowed=typeof isAppOwner==='function' && isAppOwner();
 el('add').disabled=readonly || importing || !allowed;el('add').hidden=!allowed;
 el('migrationPanel').hidden=readonly || !allowed;
 el('seasonPanel').hidden=readonly || !allowed;
}
function setSharedEditorAccess(){
 for(const field of form.querySelectorAll('input,select,textarea'))field.disabled=sharingReadonly;
 el('save').hidden=sharingReadonly;
 if(!sharingReadonly && typeof isAppOwner==='function' && !isAppOwner())for(const id of ['title','alternate','total','cover','removeCover'])el(id).disabled=true;
 if(sharingReadonly)el('editorTitle').textContent='Consultar anime · só leitura';
}
function personalSharedRow(row, fields={}) {
 return {user_id:session.user.id,id:row.id,shared_title_id:row.shared_title_id,title:row.title,
  alternate_title:row.alternate_title,total:row.total,cover_path:row.cover_path,seasonal_source:row.seasonal_source,
  added_at:row.added_at,status:'Pendente',episode:0,rating:null,favorite:false,notes:'',...fields};
}
async function saveVirtualMetadata(row,fields) {
 if(sharingReadonly)throw new Error('Esta coleção está em modo só leitura.');
 const response=await send('/rest/v1/animes',{method:'POST',headers:{'Content-Type':'application/json',Prefer:'return=representation'},body:JSON.stringify(personalSharedRow(row,fields))});
 const data=await response.json();if(!data.length)throw new Error('Atualize a coleção e tente novamente.');
 Object.assign(row,data[0],{_virtual:false});
}
async function sharingAction(action) {
 if(pending||importing||loading||editor.open) {el('sharingInfo').textContent='Aguarde a operação atual terminar.';return;}
 const label=el('memberLabel').value.trim();
 if(action!=='invite'&&!label){el('sharingInfo').textContent='Preencha seu nome de exibição.';return;}
 importing=true;
 for(const id of ['createShelf','joinShelf','inviteShelf','viewCollection','add'])el(id).disabled=true;
 el('sharingInfo').textContent='Conectando…';
 try {
  if(action==='create')await shelfRPC('shelf_create',{p_name:el('shelfName').value.trim()||'Nossa estante',p_label:label});
  else if(action==='join')await shelfRPC('shelf_join',{p_token:el('inviteCode').value.trim(),p_label:label});
  else {
   const code=await shelfRPC('shelf_invite');el('generatedInvite').value=code;el('invitationResult').hidden=false;
  }
  el('sharingInfo').textContent=action==='invite'?'Convite válido por 48 horas, para uma pessoa. Gerar outro cancela o anterior.':'Estante conectada. Seu progresso permanece individual.';
  sharingTarget='';lastData='';
 }catch(error){el('sharingInfo').textContent=error.message;}
 finally{
  importing=false;for(const id of ['createShelf','joinShelf','inviteShelf','viewCollection','add'])el(id).disabled=false;
  load();
 }
}
el('createShelf').addEventListener('click',()=>sharingAction('create'));
el('joinShelf').addEventListener('click',()=>sharingAction('join'));
el('inviteShelf').addEventListener('click',()=>sharingAction('invite'));
el('viewCollection').addEventListener('change',()=>{
 if(pending||importing||loading||editor.open){el('viewCollection').value=sharingTarget;return;}
 sharingTarget=el('viewCollection').value;sharingReadonly=!!sharingTarget;lastData='';page=0;applySharingAccess();load();
});
el('copyInvite').addEventListener('click',async()=>{
 try {await navigator.clipboard.writeText(el('generatedInvite').value);el('sharingInfo').textContent='Convite copiado.';}
 catch {el('generatedInvite').select();el('sharingInfo').textContent='Selecione e copie o código do convite.';}
});

let removingMember=null;
el('cancelRemoveMember').addEventListener('click',()=>el('removeMemberDialog').close());
el('confirmRemoveMember').addEventListener('click',async()=>{
 if(!removingMember||pending||importing||loading)return;
 importing=true;el('confirmRemoveMember').disabled=el('cancelRemoveMember').disabled=true;
 try{await shelfRPC('shelf_remove',{p_user:removingMember});sharingTarget='';sharingReadonly=false;lastData='';
 el('generatedInvite').value='';el('invitationResult').hidden=true;el('removeMemberDialog').close();}
 catch(error){el('removeMemberError').textContent=error.message;}
 finally{importing=false;el('confirmRemoveMember').disabled=el('cancelRemoveMember').disabled=false;load();}
});
el('removeMemberDialog').addEventListener('cancel',event=>{if(importing)event.preventDefault();});
