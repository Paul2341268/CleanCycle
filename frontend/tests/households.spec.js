import {test,expect} from '@playwright/test';

async function register(page,name){
  await page.goto('/');
  await page.getByRole('button',{name:'회원가입',exact:true}).first().click();
  await page.getByLabel('이름',{exact:true}).fill(name);
  await page.getByLabel('아이디',{exact:true}).fill('ui_'+Date.now()+'_'+Math.random().toString(36).slice(2,7));
  await page.getByLabel('비밀번호',{exact:true}).fill('test-password-123');
  await page.locator('form').getByRole('button',{name:'회원가입',exact:true}).click();
  await expect(page.getByRole('heading',{name:'함께 관리할 우리 집'})).toBeVisible();
}

test('two accounts share assignments, completions and membership changes',async({page,browser})=>{
  const otherContext=await browser.newContext({baseURL:'http://127.0.0.1:8766',viewport:{width:390,height:844}});
  const other=await otherContext.newPage();
  try{
    await register(page,'집 관리자');
    await page.getByLabel('집 이름',{exact:true}).fill('함께 사는 집');
    await page.getByRole('button',{name:'우리 집 만들기',exact:true}).click();
    await page.getByRole('button',{name:'우리 집 설정',exact:true}).click();
    await page.getByRole('button',{name:'초대 코드 발급',exact:true}).click();
    const code=await page.locator('.invitation code').innerText();
    await register(other,'룸메이트');
    await other.getByRole('button',{name:'초대로 참여',exact:true}).click();
    await other.getByLabel('초대 코드',{exact:true}).fill(code);
    await other.getByRole('button',{name:'초대 확인',exact:true}).click();
    await expect(other.locator('.join-preview')).toContainText('함께 사는 집');
    await other.getByRole('button',{name:'이 집에 참여',exact:true}).click();
    await page.reload();
    await page.getByRole('button',{name:'집안일 추가',exact:true}).first().click();
    await page.getByLabel('집안일 이름').fill('함께하는 욕실 청소');
    await page.getByLabel('담당자').selectOption({label:'룸메이트'});
    await page.getByRole('button',{name:'저장',exact:true}).click();
    await other.reload();
    await expect(other.getByRole('heading',{name:'함께하는 욕실 청소',exact:true})).toBeVisible();
    await other.getByRole('button',{name:'함께하는 욕실 청소 완료',exact:true}).click();
    await expect(other.getByRole('status')).toContainText('완료했어요');
    await page.bringToFront();
    await expect(page.locator('.metrics>div').nth(1).locator('strong')).toHaveText('1개',{timeout:20000});
    await page.getByRole('navigation').getByRole('button',{name:'생활 리포트',exact:true}).click();
    await expect(page.locator('.history')).toContainText('룸메이트');
    await expect(page.locator('.sharing-row').filter({hasText:'룸메이트'})).toContainText('1회');
    await page.screenshot({path:'../../work/household-desktop.png',fullPage:true});
    await other.getByRole('button',{name:'우리 집 설정',exact:true}).click();
    await expect(other.getByRole('button',{name:'초대 코드 발급'})).toHaveCount(0);
    await other.screenshot({path:'../../work/household-mobile.png',fullPage:true});
    for(const width of [390,320]){
      await other.setViewportSize({width,height:844});
      expect(await other.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    }
    await page.getByRole('button',{name:'우리 집 설정',exact:true}).click();
    await page.getByRole('button',{name:'룸메이트 내보내기',exact:true}).click();
    await page.getByRole('alertdialog').getByRole('button',{name:'확인',exact:true}).click();
    await other.reload();
    await expect(other.getByRole('heading',{name:'함께 관리할 우리 집'})).toBeVisible();
    await page.getByRole('button',{name:'로그아웃',exact:true}).click();
    await expect(page.getByRole('heading',{name:'로그인',exact:true})).toBeVisible();
  }finally{await otherContext.close();}
});
