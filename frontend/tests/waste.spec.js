import {test, expect} from '@playwright/test';
import {setupAccount} from './helpers';

test('waste settings persist, keep weather separate and exclude apartments', async ({page}, testInfo) => {
  await setupAccount(page);
  await page.goto('/');
  await page.getByRole('button',{name:'우리 집 설정',exact:true}).click();
  const section=page.getByRole('region',{name:'쓰레기 배출 일정'});
  await section.getByLabel('배출 지역').selectOption('incheon-yeonsu');
  await section.getByRole('button',{name:'배출 설정 저장'}).click();
  await expect(section.getByRole('status')).toHaveText('저장했습니다.');
  await expect(section.getByRole('heading',{name:'인천 연수구 연수동'})).toBeVisible();
  await expect(page.getByLabel('날씨 지역')).toHaveValue('busan');
  await expect(section.locator('li')).toHaveCount(7);
  await page.reload();
  await page.getByRole('button',{name:'우리 집 설정',exact:true}).click();
  await expect(section.getByLabel('배출 지역')).toHaveValue('incheon-yeonsu');
  await page.screenshot({path:testInfo.outputPath('waste-desktop.png'),fullPage:true});
  await page.setViewportSize({width:390,height:844});
  await section.scrollIntoViewIfNeeded();
  await page.screenshot({path:testInfo.outputPath('waste-mobile.png'),fullPage:true});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBeTruthy();
  await section.getByLabel('주택 유형').selectOption('apartment');
  await section.getByRole('button',{name:'배출 설정 저장'}).click();
  await expect(section.getByText(/단지별 배출일이 달라/)).toBeVisible();
  await expect(section.locator('li')).toHaveCount(0);
});
