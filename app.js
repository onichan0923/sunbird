const get = id => document.getElementById(id);
const form = get('form');
get('recover').checked = new URLSearchParams(location.search).get('recover') === 'm3e';
const densities = { ldpi:120, mdpi:160, hdpi:240, xhdpi:320, xxhdpi:480, xxxhdpi:640 };
const closest = Object.keys(densities).sort((a,b) => Math.abs(densities[a]-devicePixelRatio*160) - Math.abs(densities[b]-devicePixelRatio*160))[0];
for (const [name,dpi] of Object.entries(densities)) get('density').add(new Option(name+' · '+dpi+' dpi',name,false,name===closest));
const languages='en ar bg cs da de el es fi fr hi hr hu id it ja ko lt nl no pl pt ro ru sv th tr uk vi zh'.split(' ');
const names=new Intl.DisplayNames(['zh-Hant'],{type:'language'});
for (const code of languages) get('language').add(new Option(names.of(code)+' · '+code,code));
get('language').value=languages.includes(navigator.language.slice(0,2))?navigator.language.slice(0,2):'en';

function source() { return form.elements.namedItem('source').value; }
function refresh() {
  const recovering = get('recover').checked;
  if(recovering) get('theme').checked=true;
  get('theme').disabled=recovering;
  form.querySelector('[type=submit]').textContent=recovering?'製作恢復 APK':'修補 APK';
  get('manual').hidden=source()!=='files';
  const side=get('mode').value==='side';
  get('package-label').hidden=!side;
  get('label').placeholder=side?'Discord Phoenix':'Discord';
  get('split-links').replaceChildren();
  const version=get('version').value;
  const files=['base',get('abi').value==='arm64'?'config.arm64_v8a':'config.armeabi_v7a','config.'+get('density').value];
  if(get('language').value) files.push('config.'+get('language').value);
  const densityFallback= densities[get('density').value]<400?'hdpi':'xxhdpi';
  const alt='config.'+densityFallback;
  if(!files.includes(alt)) files.push(alt);
  for(const file of files){
    const link=document.createElement('a');
    link.textContent=file+'.apk'+(file===alt && file!=='config.'+get('density').value?'（備用密度）':'');
    link.href='https://tracker.vendetta.rocks/tracker/download/'+version+'/'+file;
    link.target='_blank'; link.rel='noopener';
    get('split-links').append(link);
  }
  get('package').setCustomValidity('');
}
form.addEventListener('change',refresh);
get('package').addEventListener('input',()=>get('package').setCustomValidity(''));
refresh();

let worker,downloadUrl;
function finish(){get('controls').disabled=false;worker?.terminate();worker=null;}
function fail(message,allowFiles){
  finish();
  get('output').classList.add('error');
  get('status').textContent=message;
  get('progress').hidden=true;
  get('fallback').hidden=!allowFiles;
}
get('fallback').onclick=()=>{
  form.querySelector('[name=source][value=files]').checked=true;
  refresh(); get('manual').scrollIntoView({block:'center'}); get('apks').focus();
};
form.onsubmit=event=>{
  event.preventDefault();
  if(worker)return;
  const side=get('mode').value==='side';
  const pkg=get('package').value.trim();
  if(side&&(!/^[a-zA-Z][a-zA-Z0-9_]*(\.[a-zA-Z][a-zA-Z0-9_]*)+$/.test(pkg)||pkg==='com.discord'||pkg.length>127)){
    get('package').setCustomValidity('請填入有效且有別於 com.discord 的套件名稱。');
    get('package').reportValidity();return;
  }
  const manual=source()==='files';
  const files=Array.from(get('apks').files);
  if(manual&&files.length<3){get('apks').setCustomValidity('請同時選擇 base、架構與螢幕密度分包。');get('apks').reportValidity();get('apks').setCustomValidity('');return;}
  if(downloadUrl)URL.revokeObjectURL(downloadUrl);
  get('save').hidden=true;get('save').removeAttribute('href');
  get('output').hidden=false;get('output').classList.remove('error');get('fallback').hidden=true;
  get('progress').hidden=false;get('status').textContent='準備瀏覽器修補器…';get('controls').disabled=true;
  get('output').scrollIntoView({block:'nearest'});
  try {
    worker=new Worker(new URL('./worker.js?v=091',import.meta.url),{type:'module'});
    worker.onmessage=({data})=>{
      if(data.kind==='error')return fail(data.message,data.download);
      if(data.kind==='progress'){get('status').textContent=data.message;return;}
      if(data.kind==='done'){
        finish();get('progress').hidden=true;get('status').textContent='修補完成，可下載已簽署的 APK。';
        downloadUrl=URL.createObjectURL(data.apk);const save=get('save');save.href=downloadUrl;
        save.download='discord-'+get('version').value+(get('recover').checked?'-sunbird-recovery-':'-sunbird-m3e-')+get('abi').value+'.apk';save.hidden=false;save.focus();
      }
    };
    worker.onerror=e=>fail(e.message||'無法啟動修補器。請重新整理網頁後再試。',false);
    worker.postMessage({manual,files,version:get('version').value,abi:get('abi').value,density:get('density').value,language:get('language').value,
      pkg:side?pkg:null,label:get('label').value.trim()||(side?'Discord Phoenix':null),theme:get('theme').checked,recover:get('recover').checked,plugins:Array.from(get('plugins').files)});
  } catch(error){fail(error.message,false);}
};
