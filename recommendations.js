'use strict';
let recommendationData=null,recommendationBusy=false,recommendationLast='',recommendationCover=null,recommendationTicket=0;
function resetRecommendations(){recommendationTicket++;recommendationData=null;recommendationLast='';recommendationBusy=false;if(recommendationCover)URL.revokeObjectURL(recommendationCover);recommendationCover=null;el('recommendationCard').hidden=true;el('recommendationEmpty').hidden=true;el('recommendationInfo').textContent='';el('recommendationRefresh').textContent='';for(const id of ['recommendationTitle','recommendationAlternate','recommendationPeople','recommendationScore','recommendationEpisodes'])el(id).textContent='';el('recommendationArt').replaceChildren();}
function watcherNames(watchers){const names=watchers.map(person=>accountName(person.username,person.label));return names.length<2?(names[0]||'Uma pessoa'):names.slice(0,-1).join(', ')+' e '+names.at(-1);}
async function refreshRecommendations(force=false){
 if(!session || document.hidden || friendsTabActive!=='recommended' || pending || importing || loading || recommendationBusy)return;
 recommendationBusy=true;const ticket=++recommendationTicket,viewer=session.user?.id;
 try{
  const data=await shelfRPC('anime_recommendation');
  if(ticket!==recommendationTicket || session?.user?.id!==viewer)return;
  const signature=JSON.stringify(data);if(!force && signature===recommendationLast)return;
  recommendationData=data;recommendationLast=signature;
  el('recommendationInfo').textContent='';el('recommendationEmpty').hidden=!!data.recommendation;el('recommendationCard').hidden=!data.recommendation;
  if(data.next_refresh_at){const time=new Date(data.next_refresh_at);el('recommendationRefresh').textContent='Próxima troca às '+time.toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'})+(data.eligible_count?' · '+data.eligible_count+' opção(ões) para você':'');}
  if(recommendationCover)URL.revokeObjectURL(recommendationCover);recommendationCover=null;
  const rec=data.recommendation;if(!rec)return;
  el('recommendationTitle').textContent=rec.title;el('recommendationAlternate').textContent=rec.alternate_title||'';
  el('recommendationAlternate').hidden=!rec.alternate_title;
  el('recommendationWant').textContent=rec.own_status==='Quero assistir'?'Na sua lista de Quero assistir':'Quero assistir';el('recommendationWant').disabled=rec.own_status==='Quero assistir';
  const names=watcherNames(rec.watchers);
  el('recommendationPeople').textContent=names+(rec.watcher_count===1?' já assistiu a este anime.':' já assistiram a este anime.');
  el('recommendationScore').textContent=rec.rating_count?'Média de quem avaliou: '+formatRating(rec.average)+'/10 · '+rec.rating_count+' avaliação(ões)':'Essas pessoas ainda não deram uma nota.';
  el('recommendationEpisodes').textContent=rec.total?rec.total+' episódios':'Total de episódios ainda não informado';
  const art=el('recommendationArt');art.replaceChildren();art.textContent=rec.cover_path?'Carregando capa…':'Sem capa';
  if(rec.cover_path){
   try{
    const response=await send('/storage/v1/object/authenticated/anime-covers/'+rec.cover_path.split('/').map(encodeURIComponent).join('/'));
    const blob=await response.blob();if(ticket!==recommendationTicket)return;
    const image=new Image();image.alt='Capa de '+rec.title;recommendationCover=URL.createObjectURL(blob);image.src=recommendationCover;art.replaceChildren(image);
   }catch{if(ticket===recommendationTicket)art.textContent='Capa indisponível';}
  }
 }catch(error){
  if(ticket===recommendationTicket){recommendationData=null;recommendationLast='';el('recommendationCard').hidden=true;el('recommendationEmpty').hidden=true;
   el('recommendationInfo').textContent=/Could not find.*anime_recommendation|function.*anime_recommendation.*does not exist/i.test(error.message)?'As recomendações ainda não foram ativadas nesta versão.':error.message;}
 }finally{if(ticket===recommendationTicket)recommendationBusy=false;}
}
async function markRecommendationSeen(status='Assistido'){
 const rec=recommendationData?.recommendation;
 if(!rec || !session || importing || pending || loading || recommendationBusy)return;
 let failure=null;importing=true;el('recommendationSeen').disabled=el('recommendationWant').disabled=true;el('recommendationInfo').textContent='Atualizando apenas o seu progresso…';
 try{
  const result=await shelfRPC('anime_recommendation_status',{p_source_user:rec.source_user,p_source_anime:rec.source_anime,p_status:status});if(result.kept_finished)failure='Esse anime já foi marcado como Assistido em sua conta. O status foi preservado.';
  sharingTarget='';sharingReadonly=false;lastData='';page=0;
  el('filter').value='';el('search').value='';el('onlyFavorites').checked=false;
  el('recommendationInfo').textContent='Marcado como Assistido na sua conta.';
 }catch(error){failure=error.message;el('recommendationInfo').textContent=error.message;}
 finally{importing=false;el('recommendationSeen').disabled=el('recommendationWant').disabled=false;await load();await refreshRecommendations(true);el('recommendationInfo').textContent=failure||(status==='Quero assistir'?'Adicionado a Quero assistir apenas na sua conta.':'Marcado como Assistido apenas na sua conta.');}
}
function viewRecommendation(){
 const rec=recommendationData?.recommendation;if(!rec)return;
 if(importing||pending||loading||recommendationBusy||editor.open){el('recommendationInfo').textContent='Aguarde a atualização terminar.';return;}
 sharingTarget=rec.source_user;sharingReadonly=true;lastData='';page=0;el('filter').value='';el('onlyFavorites').checked=false;el('search').value=rec.title;
 selectAppTab('collection');applySharingAccess();load();
}
el('recommendedTabButton').addEventListener('click',()=>selectAppTab('recommended'));
el('recommendationSeen').addEventListener('click',()=>markRecommendationSeen());
el('recommendationView').addEventListener('click',viewRecommendation);
setInterval(()=>{refreshRecommendations().catch(()=>{});},15000);
document.addEventListener('visibilitychange',()=>{if(!document.hidden)refreshRecommendations().catch(()=>{});});

el('recommendationWant').addEventListener('click',()=>markRecommendationSeen('Quero assistir'));
