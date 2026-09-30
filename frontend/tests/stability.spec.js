import {test,expect} from '@playwright/test';
import {setupAccount} from './helpers';
test.beforeEach(async({page})=>setupAccount(page));

const snapshot=(region='busan')=>({today:'2026-09-21',tasks:[],logs:[],daily_summary:{completed:1,total:2,percent:50},weather:{status:'ok',region,temperature:22,humidity:70,rain_probability:20,precipitation:0,forecast_at:'2026-09-21T20:00:00+09:00'},air_quality:{status:'unconfigured'}});

test('save failure stays inside dialog and retry preserves input',async({page})=>{
  await page.route('**/api/dashboard?*',r=>r.fulfill({json:snapshot()}));
  let attempts=0;
  await page.route('**/api/tasks',r=>r.fulfill(++attempts===1?{status:500,json:{detail:'저장하지 못했습니다. 다시 시도해 주세요.'}}:{json:{id:1}}));
  await page.goto('/');
  await page.getByRole('button',{name:'집안일 추가',exact:true}).first().click();
  await page.getByLabel('집안일 이름').fill('입력 유지 확인');
  await page.getByRole('button',{name:'저장',exact:true}).click();
  await expect(page.getByRole('dialog').getByRole('alert')).toContainText('저장하지 못했습니다');
  await expect(page.getByLabel('집안일 이름')).toHaveValue('입력 유지 확인');
  await page.screenshot({path:'../../work/stability-error.png'});
  await page.getByRole('button',{name:'저장',exact:true}).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(attempts).toBe(2);
});

test('save finishing after region switch reloads current region',async({page})=>{
  const regions=[];
  await page.route('**/api/dashboard?*',r=>{const region=new URL(r.request().url()).searchParams.get('region');regions.push(region);return r.fulfill({json:snapshot(region)})});
  let release,started;
  const gate=new Promise(resolve=>release=resolve);
  const pending=new Promise(resolve=>started=resolve);
  await page.route('**/api/tasks',async r=>{started();await gate;await r.fulfill({json:{id:1}})});
  await page.goto('/');
  await expect(page.locator('.temperature')).toBeVisible();
  await page.getByRole('button',{name:'집안일 추가',exact:true}).first().click();
  await page.getByLabel('집안일 이름').fill('지역 변경 확인');
  await page.getByRole('button',{name:'저장',exact:true}).click();
  await pending;
  await page.getByRole('button',{name:'닫기',exact:true}).click();
  await page.getByLabel('날씨 지역').selectOption('seoul');
  await expect.poll(()=>regions.at(-1)).toBe('seoul');
  release();
  await expect(page.getByRole('status')).toContainText('저장했습니다');
  await expect.poll(()=>regions.length).toBe(3);
  expect(regions).toEqual(['busan','seoul','seoul']);
  await expect(page.locator('.temperature')).toBeVisible();
  await expect(page.getByLabel('날씨 지역')).toHaveValue('seoul');
});

test('daily percentage uses persisted summary, not remaining tasks',async({page})=>{
  await page.route('**/api/dashboard?*',r=>r.fulfill({json:snapshot()}));
  await page.goto('/');
  await expect(page.locator('.metrics>div').nth(3)).toContainText('50');
  await page.reload();
  await expect(page.locator('.metrics>div').nth(3)).toContainText('50');
});
