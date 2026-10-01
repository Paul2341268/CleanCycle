import {test,expect} from '@playwright/test';
import {todayKST,shiftDay,WEEKDAYS} from '../src/personal.js';

test('catalog, direct entry, duplicate confirmation and responsive registration',async({page},testInfo)=>{
  await page.goto('/');
  await page.getByRole('button',{name:'집안일 추가',exact:true}).first().click();
  await expect(page.getByRole('tab',{name:'목록에서 선택'})).toHaveAttribute('aria-selected','true');
  await page.getByRole('button',{name:'청소기 돌리기',exact:true}).click();
  await expect(page.getByLabel('집안일 이름')).toHaveValue('청소기 돌리기');
  await expect(page.getByLabel('관리 공간')).toHaveValue('집 전체·여러 공간');
  for(const width of [1440,390,320]) {
    await page.setViewportSize({width,height:900});
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBeTruthy();
    expect(await page.locator('dialog').evaluate(el=>el.scrollWidth<=el.clientWidth)).toBeTruthy();
    await page.screenshot({path:testInfo.outputPath('registration-'+width+'.png'),fullPage:true});
  }
  await page.getByRole('button',{name:'저장',exact:true}).click();
  await page.getByRole('button',{name:'집안일 추가',exact:true}).first().click();
  await page.getByRole('button',{name:'청소기 돌리기',exact:true}).click();
  await expect(page.getByRole('button',{name:'저장',exact:true})).toBeDisabled();
  await page.getByLabel('같은 이름·공간의 집안일이 있습니다. 별도로 등록합니다.').check();
  await expect(page.getByRole('button',{name:'저장',exact:true})).toBeEnabled();
  await page.getByRole('button',{name:'취소',exact:true}).click();
  await page.getByRole('button',{name:'집안일 추가',exact:true}).first().click();
  await page.getByRole('tab',{name:'직접 추가'}).click();
  await expect(page.locator('.catalog')).toHaveCount(0);
  await page.getByLabel('집안일 이름').fill('커피머신 청소');
  await page.getByRole('button',{name:'저장',exact:true}).click();
  await expect(page.getByRole('heading',{name:'커피머신 청소',exact:true})).toBeVisible();
});

test('waste weekdays preserve schedule through completion, undo, postponement and backup',async({page,browser})=>{
  const today=todayKST(),weekday=new Date(today+'T00:00:00Z').getUTCDay();
  await page.goto('/');
  await page.getByRole('button',{name:'집안일 추가',exact:true}).first().click();
  await page.getByRole('button',{name:'재활용 배출',exact:true}).click();
  await expect(page.getByRole('button',{name:'저장',exact:true})).toBeDisabled();
  await page.locator('.weekday-options').getByLabel(WEEKDAYS[weekday],{exact:true}).check();
  await page.getByLabel('배출 시간 (선택)').fill('20:00');
  await page.getByLabel('메모 (선택)').fill('건물 앞 지정 장소');
  await page.getByRole('button',{name:'저장',exact:true}).click();
  await expect(page.locator('.task-info')).toContainText('매주 '+WEEKDAYS[weekday]+'요일');
  await expect(page.locator('.task-info')).toContainText('20:00');
  await page.getByRole('button',{name:'재활용 배출 완료',exact:true}).click();
  await page.getByRole('button',{name:'재활용 배출 완료 취소',exact:true}).click();
  await page.getByRole('button',{name:'완료 취소',exact:true}).click();
  await page.getByRole('button',{name:'재활용 배출 다음 배출일로 미루기',exact:true}).click();
  await page.getByRole('button',{name:'모든 집안일',exact:true}).first().click();
  await expect(page.locator('.task-info')).toContainText(shiftDay(today,7).slice(5).replace('-','/'));
  await page.getByRole('button',{name:'설정',exact:true}).click();
  const pending=page.waitForEvent('download');await page.getByRole('button',{name:'백업 내보내기',exact:true}).click();
  const file=await (await pending).path();const context=await browser.newContext();
  try {
    const other=await context.newPage();await other.goto('http://127.0.0.1:8766/');
    await other.getByRole('button',{name:'설정',exact:true}).click();await other.getByLabel('백업 파일').setInputFiles(file);
    await other.getByRole('button',{name:'가져오기',exact:true}).click();await other.getByRole('button',{name:'모든 집안일',exact:true}).click();
    await expect(other.locator('.task-info')).toContainText('매주 '+WEEKDAYS[weekday]+'요일');
    await expect(other.locator('.task-info')).toContainText('건물 앞 지정 장소');
  } finally {await context.close();}
});

test('first-time guide explains scores, postponing and storage without changing records',async({page},testInfo)=>{
  await page.goto('/');
  await page.getByRole('button',{name:'서비스 소개·사용 방법',exact:true}).click();
  await expect(page.getByRole('heading',{name:'서비스 소개와 사용 방법',exact:true})).toBeVisible();
  await expect(page.locator('.page-heading').getByRole('button',{name:'집안일 추가',exact:true})).toHaveCount(0);
  await page.getByText('추천 점수가 모두 0인데, 문제가 있나요?',{exact:true}).click();
  await expect(page.locator('.guide-questions details').first()).toContainText('0점은 안 해도 된다는 뜻이 아니라');
  await page.getByText('하루 미루기와 그냥 안 하는 것은 뭐가 다른가요?',{exact:true}).click();
  await expect(page.locator('.guide-questions')).toContainText('예정일이 그대로라 1일 지연');
  await page.getByText('다른 컴퓨터에서도 내 집안일이 보이나요?',{exact:true}).click();
  await expect(page.locator('.guide-questions')).toContainText('자동 동기화나 공동 관리는 제공하지 않습니다');
  for(const width of [1440,390,320]) {
    await page.setViewportSize({width,height:900});
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBeTruthy();
    await page.screenshot({path:testInfo.outputPath('guide-'+width+'.png'),fullPage:true});
  }
  await page.getByRole('button',{name:'첫 집안일 추가',exact:true}).click();
  await page.getByLabel('집안일 이름').fill('안내에서 등록');
  await page.getByRole('button',{name:'저장',exact:true}).click();
  await expect(page.getByRole('heading',{name:'안내에서 등록',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'사용 안내',exact:true}).click();
  await page.getByRole('button',{name:'오늘의 집안일',exact:true}).click();
  await expect(page.locator('.page-heading').getByRole('button',{name:'집안일 추가',exact:true})).toBeVisible();
  await expect(page.getByRole('heading',{name:'안내에서 등록',exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:'서비스 소개·사용 방법',exact:true})).toHaveCount(0);
  await expect(page.locator('.metrics')).toContainText('기한 지난 집안일');
});

async function add(page,name='테스트 청소',kind='general') {
  await page.getByRole('button',{name:'집안일 추가',exact:true}).first().click();
  await page.getByLabel('집안일 이름').fill(name);
  await page.getByLabel('집안일 종류').selectOption(kind);
  await page.getByRole('button',{name:'저장',exact:true}).click();
  await expect(page.getByRole('heading',{name,exact:true})).toBeVisible();
}

test('no login; personal chores survive reload and support edit, completion, undo and delete',async({page})=>{
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  const writes=[];page.on('request',r=>{if(r.method()!=='GET')writes.push(r.url());});
  await page.goto('/');
  await expect(page.getByRole('heading',{name:'오늘도, 기분 좋은 우리 집'})).toBeVisible();
  await expect(page.getByText('로그인',{exact:true})).toHaveCount(0);
  await add(page);
  await page.getByRole('button',{name:'테스트 청소 수정',exact:true}).click();
  await page.getByLabel('반복 주기 (일)').fill('4');
  await page.getByRole('button',{name:'저장',exact:true}).click();
  await page.reload();
  await expect(page.locator('.task-info')).toContainText('4일마다');
  await page.getByRole('button',{name:'테스트 청소 완료',exact:true}).click();
  await expect(page.locator('.metrics')).toContainText('100');
  await page.getByRole('button',{name:'생활 리포트',exact:true}).click();
  await expect(page.locator('.history')).toContainText('테스트 청소');
  await page.getByRole('button',{name:'테스트 청소 완료 취소',exact:true}).click();
  await page.getByRole('button',{name:'완료 취소',exact:true}).click();
  await expect(page.locator('.history')).toHaveCount(0);
  await page.getByRole('button',{name:'오늘의 집안일',exact:true}).click();
  await page.getByRole('button',{name:'테스트 청소 하루 미루기',exact:true}).click();
  await expect(page.getByRole('heading',{name:'테스트 청소',exact:true})).toHaveCount(0);
  await page.getByRole('button',{name:'모든 집안일',exact:true}).first().click();
  await page.getByRole('button',{name:'테스트 청소 삭제',exact:true}).click();
  await page.getByRole('button',{name:'삭제',exact:true}).click();
  await page.reload();
  await expect(page.getByRole('heading',{name:'테스트 청소',exact:true})).toHaveCount(0);
  expect(errors).toEqual([]);expect(writes).toEqual([]);
});

test('backup moves records to another browser and invalid files preserve data',async({page,browser})=>{
  await page.goto('/');await add(page,'백업할 청소');
  await page.getByRole('button',{name:'설정',exact:true}).click();
  const downloadPromise=page.waitForEvent('download');
  await page.getByRole('button',{name:'백업 내보내기',exact:true}).click();
  const download=await downloadPromise;
  const file=await download.path();
  const context=await browser.newContext();const other=await context.newPage();
  try {
    await other.goto('http://127.0.0.1:8766/');
    await expect(other.getByRole('heading',{name:'백업할 청소',exact:true})).toHaveCount(0);
    await other.getByRole('button',{name:'설정',exact:true}).click();
    await other.getByLabel('백업 파일').setInputFiles(file);
    await other.getByRole('button',{name:'가져오기',exact:true}).click();
    await other.getByRole('button',{name:'오늘의 집안일',exact:true}).click();
    await expect(other.getByRole('heading',{name:'백업할 청소',exact:true})).toBeVisible();
    await other.getByRole('button',{name:'설정',exact:true}).click();
    await other.getByLabel('백업 파일').setInputFiles({name:'bad.json',mimeType:'application/json',buffer:Buffer.from('{"version":1}')});
    await expect(other.getByRole('alert')).toContainText('백업을 읽지 못했습니다');
    await other.reload();await other.getByRole('button',{name:'오늘의 집안일',exact:true}).click();
    await expect(other.getByRole('heading',{name:'백업할 청소',exact:true})).toBeVisible();
  } finally {await context.close();}
});

test('tabs share local records without update loops',async({page,context})=>{
  await page.goto('/');const other=await context.newPage();await other.goto('/');
  await add(page,'탭 간 기록');
  await expect(other.getByRole('heading',{name:'탭 간 기록',exact:true})).toBeVisible();
  await other.getByRole('button',{name:'탭 간 기록 완료',exact:true}).click();
  await expect(page.locator('.completed')).toContainText('탭 간 기록');
});

test('public data recommendations, desktop and mobile layouts',async({page},testInfo)=>{
  await page.route('**/api/environment?*',route=>route.fulfill({json:{region:'busan',weather:{region:'busan',status:'ok',temperature:25,humidity:80,rain_probability:80,precipitation:1,forecast_at:'2026-10-01T09:00:00+09:00'},air_quality:{region:'busan',status:'ok',station:'연산동',pm10:90,pm25:40,pm10_grade:3,pm25_grade:3,measured_at:'2026-10-01T08:00:00+09:00'}}}));
  await page.setViewportSize({width:1440,height:1000});await page.goto('/');
  await add(page,'욕실 물기 점검','bathroom');await add(page,'침구 세탁','laundry');
  await expect(page.locator('.task').first()).toContainText('욕실 물기 점검');
  await page.getByRole('button',{name:'욕실 물기 점검 추천 근거',exact:true}).click();
  await expect(page.getByRole('dialog')).toContainText('기상청 단기예보');
  await page.keyboard.press('Escape');
  await page.screenshot({path:testInfo.outputPath('personal-desktop.png'),fullPage:true});
  for(const width of [390,320]) {
    await page.setViewportSize({width,height:844});
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBeTruthy();
    await page.screenshot({path:testInfo.outputPath('personal-mobile-'+width+'.png'),fullPage:true});
    await page.getByRole('button',{name:'집안일 추가',exact:true}).first().click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.keyboard.press('Escape');
  }
});

test('network failures still allow local editing',async({page})=>{
  await page.route('**/api/environment?*',route=>route.abort());await page.goto('/');
  await expect(page.getByRole('alert')).toContainText('서버에 연결하지 못했습니다');
  await add(page,'오프라인에도 저장');await page.reload();
  await expect(page.getByRole('heading',{name:'오프라인에도 저장',exact:true})).toBeVisible();
});

test('failed local writes keep form input and do not pretend to save',async({page})=>{
  await page.addInitScript(()=>{Storage.prototype.setItem=function(){throw new DOMException('full','QuotaExceededError');};});
  await page.goto('/');await page.getByRole('button',{name:'집안일 추가',exact:true}).first().click();
  await page.getByLabel('집안일 이름').fill('저장 실패 작업');await page.getByRole('button',{name:'저장',exact:true}).click();
  await expect(page.getByRole('dialog').getByRole('alert')).toContainText('저장하지 못했습니다');
  await expect(page.getByLabel('집안일 이름')).toHaveValue('저장 실패 작업');
  await expect(page.getByRole('heading',{name:'저장 실패 작업',exact:true})).toHaveCount(0);
});

test('corrupt local records are retained and recoverable',async({page})=>{
  await page.addInitScript(()=>localStorage.setItem('cleancycle-personal-v1','bad-record'));
  await page.goto('/');
  await expect(page.getByRole('alert')).toContainText('저장된 기록을 읽지 못했습니다');
  await expect(page.getByRole('button',{name:'집안일 추가',exact:true}).first()).toBeDisabled();
  expect(await page.evaluate(()=>localStorage.getItem('cleancycle-personal-v1'))).toBe('bad-record');
});
