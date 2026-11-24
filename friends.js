'use strict';
let friendsData={friends:[],incoming:[],outgoing:[]},friendsTabActive='collection';
function visibleCollectionPeople(){
 const people=new Map();
 for(const person of [...(sharingState.members||[]),...(sharingState.friends||[])])people.set(person.user_id,{...people.get(person.user_id),...person});
 return [...people.values()];
}
function collectionPersonName(userId){const person=visibleCollectionPeople().find(p=>p.user_id===userId);return accountName(person?.username,person?.label||'Pessoa');}
async function loadFriendsState(){
 try{friendsData=await shelfRPC('anime_friends_state');sharingState.friends=friendsData.friends;renderFriends();}
 catch(error){
  friendsData={friends:[],incoming:[],outgoing:[]};sharingState.friends=[];renderFriends();
  if(/Could not find.*anime_friends_state|function.*anime_friends_state.*does not exist/i.test(error.message))el('friendsInfo').textContent='Execute Amigos-e-Filtros-2.4.sql no Supabase para ativar a aba Amigos.';
  else throw error;
 }
}
function selectAppTab(tab){
 friendsTabActive=tab;
 el('collectionTab').hidden=tab!=='collection';el('friendsTab').hidden=tab!=='friends';
 el('collectionTabButton').setAttribute('aria-selected',String(tab==='collection'));
 el('friendsTabButton').setAttribute('aria-selected',String(tab==='friends'));
}
function friendsButton(label,action){const button=document.createElement('button');button.type='button';button.textContent=label;button.addEventListener('click',action);return button;}
function renderFriends(){
 el('friendsCount').textContent=friendsData.friends.length+' amigo(s)';
 el('friendTabBadge').textContent=friendsData.incoming.length?' · '+friendsData.incoming.length+' pedido(s)':'';
 const list=el('friendsList');list.replaceChildren();
 for(const friend of friendsData.friends){
  const card=document.createElement('article');card.className='friend-card';
  const name=document.createElement('strong');name.textContent=accountName(friend.username);
  const actions=document.createElement('div');actions.className='actions';
  actions.append(friendsButton('Ver coleção',()=>openFriendCollection(friend.user_id)),friendsButton('Remover amigo',()=>{
   if(pending||importing||loading||editor.open){el('friendsInfo').textContent='Aguarde a operação atual terminar.';return;}
   removingFriend=friend.user_id;el('removeFriendName').textContent='Remover '+accountName(friend.username)+' da sua lista?';
   el('removeFriendError').textContent='';el('removeFriendDialog').showModal();
  }));card.append(name,actions);list.append(card);
 }
 el('emptyFriends').hidden=!!friendsData.friends.length;
 for(const [kind,source] of [['received',friendsData.incoming],['sent',friendsData.outgoing]]){
  const target=el(kind==='received'?'receivedFriends':'sentFriends');target.replaceChildren();
  el(kind==='received'?'receivedFriendsSection':'sentFriendsSection').hidden=!source.length;
  for(const person of source){const li=document.createElement('li');li.append(document.createTextNode(accountName(person.username)+' '));
   if(kind==='received')li.append(friendsButton('Aceitar',()=>friendAction('answer',{p_user:person.user_id,p_accept:true})),friendsButton('Recusar',()=>friendAction('answer',{p_user:person.user_id,p_accept:false})));
   else li.append(friendsButton('Cancelar pedido',()=>friendAction('cancel',{p_user:person.user_id})));
   target.append(li);
  }
 }
}
async function friendAction(action,args={}){
 if(pending||importing||loading||editor.open){el('friendsInfo').textContent='Aguarde a operação atual terminar.';return false;}
 importing=true;el('sendFriendRequest').disabled=true;el('friendsInfo').textContent='Salvando…';
 try{
  const methods={request:'anime_friend_request',answer:'anime_friend_answer',cancel:'anime_friend_cancel',remove:'anime_friend_remove'};
  friendsData=await shelfRPC(methods[action],args);sharingState.friends=friendsData.friends;renderFriends();
  el('friendsInfo').textContent=action==='request'?'Pedido enviado. A pessoa precisa aceitar.':action==='answer'?(args.p_accept?'Amizade aceita. Vocês podem consultar as coleções.':'Pedido recusado.'):action==='remove'?'Amigo removido.':'Pedido cancelado.';
  if(action==='request'){el('addFriendDialog').close();el('friendUsername').value='';}
  if(action==='remove'){el('removeFriendDialog').close();if(sharingTarget===args.p_user){sharingTarget='';sharingReadonly=false;lastData='';}}
  return true;
 }catch(error){el('friendsInfo').textContent=error.message;el(action==='remove'?'removeFriendError':'addFriendError').textContent=error.message;return false;}
 finally{importing=false;el('sendFriendRequest').disabled=false;load();}
}
function openFriendCollection(userId){
 if(pending||importing||loading||editor.open){el('friendsInfo').textContent='Aguarde a atualização terminar e tente novamente.';return;}
 if(!friendsData.friends.some(friend=>friend.user_id===userId))return;
 sharingTarget=userId;sharingReadonly=true;lastData='';page=0;el('filter').value='';el('search').value='';el('onlyFavorites').checked=false;
 el('viewCollection').value=userId;selectAppTab('collection');applySharingAccess();load();
}
let removingFriend=null;
el('collectionTabButton').addEventListener('click',()=>selectAppTab('collection'));
el('friendsTabButton').addEventListener('click',()=>selectAppTab('friends'));
el('addFriendButton').addEventListener('click',()=>{
 if(pending||importing||loading||editor.open){el('friendsInfo').textContent='Aguarde a operação atual terminar.';return;}
 if(!sharingState.profile){el('friendsInfo').textContent='Cadastre seu nome único em Meu nome e convites antes de adicionar amigos.';return;}
 el('addFriendError').textContent='';el('addFriendDialog').showModal();el('friendUsername').focus();
});
el('addFriendForm').addEventListener('submit',event=>{event.preventDefault();friendAction('request',{p_username:el('friendUsername').value.trim()});});
el('cancelAddFriend').addEventListener('click',()=>{if(!importing)el('addFriendDialog').close();});
el('cancelRemoveFriend').addEventListener('click',()=>{if(!importing)el('removeFriendDialog').close();});
el('confirmRemoveFriend').addEventListener('click',()=>{if(removingFriend)friendAction('remove',{p_user:removingFriend});});
for(const id of ['addFriendDialog','removeFriendDialog'])el(id).addEventListener('cancel',event=>{if(importing)event.preventDefault();});
function resetFriendsUI(){friendsData={friends:[],incoming:[],outgoing:[]};renderFriends();selectAppTab('collection');el('friendUsername').value='';el('friendsInfo').textContent='';el('filter').value='';el('onlyFavorites').checked=false;el('search').value='';page=0;}
