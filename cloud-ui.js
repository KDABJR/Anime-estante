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
  if(typeof resetRecommendations==='function')resetRecommendations();
  if(typeof resetDuplicateUI==='function')resetDuplicateUI();
  if(typeof resetFriendsUI==='function')resetFriendsUI();
  if(typeof sharingState!=='undefined'){sharingState={shelf:null,members:[]};sharingTarget='';sharingReadonly=false;el('accountInfo').textContent='';el('username').value='';el('targetUsername').value='';el('incomingInvites').replaceChildren();el('outgoingInvites').replaceChildren();usernameLoadedFor=null;}
  el('grid').replaceChildren();
  el('library').hidden = true;
  el('loginPanel').hidden = false;
  images.forEach(url => URL.revokeObjectURL(url)); images=[];
});
el('sort').addEventListener('change', () => { page=0; render(); });

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
