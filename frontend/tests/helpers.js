export async function setupAccount(page, name='테스트 사용자') {
  const username='test_'+Date.now()+'_'+Math.random().toString(36).slice(2,8);
  const headers={'X-CleanCycle-Request':'1'};
  const registration=await page.request.post('/api/auth/register',{headers,data:{username,password:'test-password-123',name}});
  if(!registration.ok())throw new Error(await registration.text());
  const home=await page.request.post('/api/homes',{headers,data:{name:'테스트 집',region:'busan'}});
  if(!home.ok())throw new Error(await home.text());
  return registration.json();
}
