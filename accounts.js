'use strict';
function isAppOwner(){return sharingState.can_add===true;}
function accountName(username,label='Pessoa'){return username ? '@'+(username==='kdab'?'KDAB':username) : label;}
let usernameLoadedFor=null;
function updateAccountControls(user){
 const profile=sharingState.profile;
 if(el('accountHandle'))el('accountHandle').textContent=profile?accountName(profile.username):'Minha conta';
 el('currentUsername').textContent=profile?'Seu nome único: '+accountName(profile.username):'Escolha seu nome único para receber convites.';
 if(usernameLoadedFor!==user.id || profile){el('username').value=profile?.username||'';usernameLoadedFor=user.id;}
 el('username').disabled=!!profile;el('saveUsername').hidden=!!profile;
 if(!el('memberLabel').value && profile)el('memberLabel').value=accountName(profile.username);
 el('namedInviteControls').hidden=!isAppOwner() || !sharingState.shelf;
 const incoming=el('incomingInvites');incoming.replaceChildren();
 for(const invite of sharingState.incoming||[]){
  const li=document.createElement('li');li.textContent=accountName(invite.username)+' convidou você para '+invite.shelf_name+'. ';
  for(const [label,accept] of [['Aceitar',true],['Recusar',false]]){
   const button=document.createElement('button');button.textContent=label;button.style.margin='4px';
   button.addEventListener('click',()=>accountAction('answer',{p_invite:invite.id,p_accept:accept}));li.append(button);
  }incoming.append(li);
 }
 el('incomingLabel').hidden=!(sharingState.incoming||[]).length;
 const outgoing=el('outgoingInvites');outgoing.replaceChildren();
 for(const invite of sharingState.outgoing||[]){const li=document.createElement('li');li.textContent='Aguardando '+accountName(invite.username)+' ';const button=document.createElement('button');button.textContent='Cancelar convite';button.addEventListener('click',()=>accountAction('cancel',{p_invite:invite.id}));li.append(button);outgoing.append(li);}
}
async function accountAction(action,args={}){
 if(pending||importing||loading||editor.open){el('accountInfo').textContent='Aguarde a operação atual terminar.';return;}
 const rpc={username:'shelf_set_username',invite:'shelf_invite_username',answer:'shelf_answer_invite',cancel:'shelf_cancel_invite'}[action];
 importing=true;el('saveUsername').disabled=el('inviteByUsername').disabled=true;
 el('accountInfo').textContent='Salvando…';
 try{
  const result=await shelfRPC(rpc,args);
  el('accountInfo').textContent=action==='username'?'Nome único cadastrado.':action==='invite'?'Convite enviado dentro do app. A pessoa precisa aceitar.':action==='cancel'?'Convite cancelado.':args.p_accept?'Convite aceito. Seu progresso continua individual.':'Convite recusado.';
  if(action==='username')el('username').value=result.username;
  if(action==='answer'){sharingTarget='';sharingReadonly=false;lastData='';}
 }catch(error){el('accountInfo').textContent=error.message;}
 finally{importing=false;el('saveUsername').disabled=el('inviteByUsername').disabled=false;load();}
}
el('saveUsername').addEventListener('click',()=>accountAction('username',{p_username:el('username').value.trim()}));
el('inviteByUsername').addEventListener('click',()=>accountAction('invite',{p_username:el('targetUsername').value.trim()}));
function validRating(value){return value===null || Number.isFinite(value)&&value>=0&&value<=10&&Math.abs(value*10-Math.round(value*10))<1e-8;}
function parseRating(value){const text=String(value).trim();if(!text)return null;if(!/^(?:10(?:[.,]0)?|[0-9](?:[.,][0-9])?)$/.test(text))throw new Error('Use uma nota de 0 a 10 com no máximo uma casa decimal, como 8,5.');return Number(text.replace(',','.'));}
function formatRating(value){return Number(value).toLocaleString('pt-BR',{minimumFractionDigits:1,maximumFractionDigits:1});}
let ratingsRequest=0;
async function showAnimeRatings(item){
 const ticket=++ratingsRequest;
 el('ratingsList').replaceChildren();el('ratingsAverage').textContent='Carregando avaliações…';
 const row=item && cloudRows.find(row=>row.id===item.Id);
 if(!row){el('ratingsAverage').textContent='Salve o anime para consultar as avaliações.';return;}
 try{
  const data=await shelfRPC('shelf_ratings',{p_anime:row.id,p_shared:row.shared_title_id||null});
  if(ticket!==ratingsRequest || !editor.open)return;
  el('ratingsAverage').textContent=data.count ? 'Média: '+formatRating(data.average)+'/10 · '+data.count+' avaliação(ões)' : 'Nenhuma avaliação ainda.';
  for(const vote of data.ratings){const li=document.createElement('li');li.textContent=accountName(vote.username,vote.label)+(vote.is_me?' (você)':'')+' — '+(vote.rating==null?'Sem nota':formatRating(vote.rating)+'/10');el('ratingsList').append(li);}
 }catch(error){if(ticket===ratingsRequest)el('ratingsAverage').textContent=error.message;}
}
