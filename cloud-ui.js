let importing = false;
function enterLibrary() {
  el('loginPanel').hidden = true;
  el('library').hidden = false;
  load();
}
async function authenticate(create) {
  if (!el('loginForm').reportValidity()) return;
  el('loginButton').disabled = el('createAccount').disabled = true;
  el('loginInfo').textContent = 'Conectando…';
  try {
    if (create) {
      await signUp(el('email').value.trim(), el('password').value);
      el('loginInfo').textContent = session ? '' : 'Confirme o cadastro no e-mail recebido. Depois volte aqui e entre com sua senha.';
    } else await signIn(el('email').value.trim(), el('password').value);
    if (session) { el('password').value = ''; enterLibrary(); }
  } catch (error) { el('loginInfo').textContent = error.message; }
  finally { el('loginButton').disabled = el('createAccount').disabled = false; }
}
el('loginForm').addEventListener('submit', event => { event.preventDefault(); authenticate(false); });
el('createAccount').addEventListener('click', () => authenticate(true));
el('recover').addEventListener('click', async () => {
  if (!el('email').reportValidity() || !el('email').value) return;
  try { await recoverAccount(el('email').value.trim()); el('loginInfo').textContent = 'Verifique seu e-mail para redefinir a senha.'; }
  catch(error) { el('loginInfo').textContent = error.message; }
});
el('logout').addEventListener('click', () => {
  if (pending || importing) return;
  keepSession(null);
  items = []; cloudRows = []; lastData = '';
  if(typeof sharingState!=='undefined'){sharingState={shelf:null,members:[]};sharingTarget='';sharingReadonly=false;el('generatedInvite').value='';el('invitationResult').hidden=true;el('inviteCode').value='';el('sharingInfo').textContent='';el('accountInfo').textContent='';el('username').value='';el('targetUsername').value='';el('incomingInvites').replaceChildren();el('outgoingInvites').replaceChildren();usernameLoadedFor=null;}
  el('grid').replaceChildren();
  el('library').hidden = true;
  el('loginPanel').hidden = false;
  images.forEach(url => URL.revokeObjectURL(url)); images=[];
});
el('sort').addEventListener('change', () => { page=0; render(); });

function parseCollection(source) {
  const document = new DOMParser().parseFromString(source, 'application/xml');
  if (document.querySelector('parsererror') || document.documentElement.tagName !== 'ArrayOfAnime')
    throw new Error('Escolha o XML exportado pelo Anime Estante.');
  return [...document.documentElement.children].filter(node => node.tagName === 'Anime').map(node => {
    const text = name => [...node.children].find(child => child.tagName === name)?.textContent || '';
    const date = text('AddedAtUtc');
    const row = { id: uuid(text('Id')), title: text('Title').trim(), alternate_title: text('AlternateTitle') || null,
      status: text('Status') || 'Pendente', episode: Number(text('Episode') || 0), total: Number(text('Total') || 0),
      rating: Number(text('Rating') || 0) || null, favorite: text('Favorite') === 'true', notes: text('Notes'),
      seasonal_source: text('SeasonalSource') || null, imported_folder: text('ImportedFolder') || null,
      imported_season: Number(text('ImportedSeason') || 0), added_at: date && Number.isFinite(Date.parse(date)) ? date : null,
      cover: text('Cover').replace(/\s/g,'') };
    if (!row.title || !STATUSES.includes(row.status) || !Number.isInteger(row.episode) || !Number.isInteger(row.total) ||
        (row.rating!==null && (!Number.isFinite(row.rating) || Math.abs(row.rating*10-Math.round(row.rating*10))>1e-8)) || row.episode < 0 || row.total < 0 || row.episode > 100000 || row.total > 100000 ||
        row.rating < 0 || row.rating > 10 || (row.total > 0 && row.episode > row.total))
      throw new Error('Revise os episódios ou a nota de ' + (row.title || 'um cadastro sem título') + ' no app do PC antes de importar.');
    return row;
  });
}

el('importButton').addEventListener('click', async () => {
  if (importing || pending || loading || (typeof isAppOwner==='function' && !isAppOwner())) return;
  const file = el('importFile').files[0];
  if (!file) { el('importInfo').textContent = 'Selecione o arquivo XML da coleção.'; return; }
  if (file.size > 200 * 1024 * 1024) { el('importInfo').textContent = 'O arquivo excede 200 MB.'; return; }
  importing = true;
  el('importButton').disabled = el('add').disabled = true;
  let added = 0, skipped = 0, failed = [];
  try {
    const source = parseCollection(await file.text());
    await cloudCollection();
    const user = await currentUser();
    const ids = new Set(cloudRows.filter(row => !row._virtual).map(row => row.id));
    const sources = new Set(cloudRows.filter(row => !row._virtual).map(row => row.seasonal_source).filter(Boolean));
    const titles = new Set(cloudRows.filter(row => !row._virtual).map(row => row.title.trim().toLocaleLowerCase()));
    for (let index=0; index<source.length; index++) {
      const record = source[index];
      el('importInfo').textContent = (index+1) + '/' + source.length + ' · ' + record.title;
      const title = record.title.toLocaleLowerCase();
      if (ids.has(record.id) || titles.has(title) || (record.seasonal_source && sources.has(record.seasonal_source))) {
        skipped++; continue;
      }
      try {
        const cover = record.cover;
        delete record.cover;
        record.user_id = user.id;
        record.cover_path = cover ? await uploadCover(record.id, cover) : null;
        await send('/rest/v1/animes', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(record) });
        ids.add(record.id); titles.add(title);
        if (record.seasonal_source) sources.add(record.seasonal_source);
        added++;
      } catch(error) { failed.push(record.title + ' — ' + error.message); }
    }
    el('importInfo').textContent = added + ' importados · ' + skipped + ' já existentes' +
      (failed.length ? ' · Falhas: ' + failed.join(' | ') + '. Você pode repetir a importação.' : '. Importação concluída.');
  } catch(error) { el('importInfo').textContent = error.message; }
  finally { importing=false; el('importButton').disabled=false; load(); }
});

if (recovery && session) {
  el('loginForm').hidden=true;
  const reset=document.createElement('form');
  reset.innerHTML='<h2>Nova senha</h2><label>Senha com pelo menos 8 caracteres<input type="password" minlength="8" required autocomplete="new-password"></label><button class="primary">Salvar senha</button><p role="status"></p>';
  el('loginPanel').append(reset);
  reset.addEventListener('submit',async event=>{
    event.preventDefault();
    const button=reset.querySelector('button'); button.disabled=true;
    try {
      await send('/auth/v1/user',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({password:reset.querySelector('input').value})});
      reset.remove(); el('loginForm').hidden=false; enterLibrary();
    } catch(error) {reset.querySelector('p').textContent=error.message;}
    finally {button.disabled=false;}
  });
} else if (session) enterLibrary();
