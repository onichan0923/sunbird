import init,{Build} from './vendor/patcher_web.js';

const tracker='https://tracker.vendetta.rocks/tracker/download/';
const proxy='https://phoenix-apk-proxy.mantikafasi.workers.dev/tracker/download/';
const mirror='https://dl.redeem.saarland/';
const dpi={ldpi:120,mdpi:160,hdpi:240,xhdpi:320,xxhdpi:480,xxxhdpi:640};
const report=message=>postMessage({kind:'progress',message});
const sha256=async data=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',data)),v=>v.toString(16).padStart(2,'0')).join('');
async function get(url,options) {
  const response=await fetch(url,options);
  if(!response.ok)throw new Error(url+' · HTTP '+response.status);
  return response;
}
async function unpack(asset){
  const chunks=await Promise.all(asset.parts.map(async path=>(await get(path+'?v='+asset.sha256)).arrayBuffer()));
  const bytes=new Uint8Array(await new Response(new Blob(chunks).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer());
  if(bytes.length!==asset.bytes||await sha256(bytes)!==asset.sha256)throw new Error('網頁資源校驗失敗，請重新整理。');
  return bytes;
}
class SplitError extends Error {}
async function split(code,name,hashes,optional=false){
  const path='android/'+code+'/'+name+'.apk',pin=hashes[path];
  const urls=pin?[mirror+path,proxy+code+'/'+name,tracker+code+'/'+name]:[proxy+code+'/'+name,tracker+code+'/'+name];
  report('下載 '+name+'.apk…');let missing=false;
  for(const url of urls){
    let response,bytes;
    try {
      response=await fetch(url);
      if(!response.ok){if(response.status===404)missing=true;continue;}
      bytes=new Uint8Array(await response.arrayBuffer());
    } catch { continue; }
    if(pin&&await sha256(bytes)!==pin)throw new SplitError(name+'.apk 的 SHA-256 與已知版本不同。請重新下載分包。');
    if(bytes[0]!==0x50||bytes[1]!==0x4b)continue;
    return bytes;
  }
  if(optional&&missing)return null;
  throw new SplitError('無法下載 '+name+'.apk。可改用本機 APK 分包繼續。');
}
async function input(build,r){
  if(r.manual){
    for(const file of r.files){report('讀取 '+file.name+'…');build.addApk(new Uint8Array(await file.arrayBuffer()));}
    return;
  }
  const hashes=await (await get('./split-hashes.json')).json();
  build.addApk(await split(r.version,'base',hashes));
  build.addApk(await split(r.version,r.abi==='arm64'?'config.arm64_v8a':'config.armeabi_v7a',hashes));
  const order=Object.keys(dpi).sort((a,b)=>Math.abs(dpi[a]-dpi[r.density])-Math.abs(dpi[b]-dpi[r.density])||dpi[b]-dpi[a]);
  let density=null;
  for(const d of order){
    density=await split(r.version,'config.'+d,hashes,true);
    if(density)break;
  }
  if(!density)throw new SplitError('找不到可用的螢幕密度分包，請選擇本機 APK。');
  build.addApk(density);
  if(r.language){
    const lang=await split(r.version,'config.'+r.language,hashes,true);
    if(lang)build.addApk(lang);
  }
}
onmessage=async({data:r})=>{
  let build;
  try{
    const specs=await (await get('./loaders.json?v=112')).json();
    await init({module_or_path:await unpack(specs.wasm)});
    build=new Build();
    await input(build,r);
    report('加入系統外觀執行檔…');
    build.addLibrary('libplm.so',await unpack(specs[r.abi]));
    build.addLibrary('libshadowhook_nothing.so',new Uint8Array(await (await get('./vendor/shadow-'+r.abi+'.so')).arrayBuffer()));
    if(r.theme || r.recover){
      const source=await (await get('./m3e-theme.js?v=114')).text();
      // The runtime reads this line from the APK before looking up installed
      // JS. The token belongs to this APK so reopening it respects later choices.
      const pause=r.recover?'// @pause-once '+crypto.randomUUID().replaceAll('-','')+'\n':'';
      build.addPlugin('m3e-theme',pause+source);
    }
    const used=new Set(r.theme||r.recover?['m3e-theme']:[]);
    if(r.systemFont){
      build.addPlugin('system-font',await (await get('./system-font.js?v=031')).text());
      used.add('system-font');
    }
    for(const file of r.plugins){
      const name=file.name.replace(/\.js$/i,'');
      if(!/^[a-zA-Z0-9_-]+$/.test(name)||used.has(name))throw new Error('插件檔名無效或重複：'+file.name);
      build.addPlugin(name,await file.text());used.add(name);
    }
    report('合併並簽署 APK…');
    const parts=build.merge(r.pkg,r.label,line=>report(line));
    const apk=new Blob(parts,{type:'application/vnd.android.package-archive'});
    postMessage({kind:'done',apk});
  }catch(error){postMessage({kind:'error',message:error.message||String(error),download:error instanceof SplitError});}
  finally{build?.free();}
};
