export async function api(path, options={}) {
  let response;
  try {
    response=await fetch('/api'+path,{...options,credentials:'same-origin',headers:{'Content-Type':'application/json','X-CleanCycle-Request':'1',...options.headers}});
  } catch {
    throw new Error('서버에 연결하지 못했습니다. 연결 상태를 확인해 주세요.');
  }
  let value;
  try {value=await response.json();} catch {throw new Error('서버 응답을 읽지 못했습니다. 다시 시도해 주세요.');}
  if(!response.ok){
    const error=new Error(typeof value.detail==='string'?value.detail:'입력 내용을 확인해 주세요.');
    error.status=response.status;
    if((response.status===401||response.status===403)&&!path.startsWith('/auth/')&&!path.startsWith('/homes/'))window.dispatchEvent(new Event('cleancycle-session-check'));
    throw error;
  }
  return value;
}
