import assert from 'node:assert/strict';
import {chromium,expect} from '@playwright/test';
import {mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
const out=resolve('../.impeccable/review');await mkdir(out,{recursive:true});
const browser=await chromium.launch({headless:true});const errors=[];
const page=await browser.newPage({viewport:{width:1440,height:970}});page.on('pageerror',e=>errors.push(e.message));
const shot=name=>page.screenshot({path:resolve(out,name+'.png'),fullPage:true});
async function inspect(floor){
 await page.getByRole('link',{name:floor?'Factory floor':'Agent map',exact:true}).click();
 await page.getByRole('button',{name:floor?/^CNC Lathe 1,/: 'Planning station'}).focus();await page.keyboard.press('Enter');
 const drawer=page.getByRole('dialog',{name:floor?'CNC Lathe 1':'Planning',exact:true});await expect(drawer).toBeVisible();
 await expect(page.locator('.floor-workspace')).toHaveAttribute('data-inspecting','true');await expect(page.locator('.floor-model')).toHaveAttribute('data-zoom','1.45');await page.waitForTimeout(260);
 const s=await page.locator('.floor-viewport').boundingBox(),p=await drawer.boundingBox(),workspace=await page.locator('.floor-workspace').boundingBox();
 assert(Math.abs(s.width-workspace.width)<1&&Math.abs(s.height-workspace.height)<1,'Floating inspector must not crop any part of the canvas');
 const marker=await page.locator('.floor-marker').boundingBox();assert(marker&&(marker.x+marker.width<p.x||marker.y+marker.height<p.y),'Focused item should stay clear of the floating panel');
 const angle=await page.locator('.floor-model').getAttribute('data-azimuth');await page.getByRole('button',{name:'Rotate right',exact:true}).click();
 await expect(page.locator('.floor-model')).not.toHaveAttribute('data-azimuth',angle);
 await expect(page.locator('.floor-model')).toHaveAttribute('data-detail','full');
 await drawer.getByRole('button',{name:floor?'Focus machine':'Focus agent'}).click();await page.waitForTimeout(260);
 await shot((floor?'floor':'agents')+'-inspector-'+page.viewportSize().width);
 await page.keyboard.press('Escape');await expect(drawer).toHaveCount(0);
 await page.getByRole('button',{name:'Reset camera',exact:true}).click();await expect(page.locator('.floor-model')).toHaveAttribute('data-zoom','1.00');
 const b=await page.locator('.floor-model').boundingBox(),before=await page.locator('.floor-model > g').getAttribute('transform'),panAngle=await page.locator('.floor-model').getAttribute('data-azimuth');
 await page.mouse.move(b.x+b.width*.4,b.y+b.height*.55);await page.mouse.down({button:'right'});await page.mouse.move(b.x+b.width*.4+45,b.y+b.height*.55+25,{steps:8});await expect(page.locator('.floor-model')).toHaveAttribute('data-detail','motion');await page.mouse.up({button:'right'});await expect(page.locator('.floor-model')).toHaveAttribute('data-detail','full');
 await expect(page.getByRole('dialog')).toHaveCount(0);assert.notEqual(await page.locator('.floor-model > g').getAttribute('transform'),before);assert.equal(await page.locator('.floor-model').getAttribute('data-azimuth'),panAngle);assert(await page.locator('.floor-model').evaluate(el=>!el.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true}))));
}
try{
 await page.goto(process.env.P5_URL??'http://127.0.0.1:5173');await page.getByLabel('Email').fill('manager@factory.local');await page.getByLabel('Password').fill('demo');await page.getByRole('button',{name:'Log in',exact:true}).click();
 await page.getByRole('button',{name:/^CNC Lathe 1,/}).waitFor();await inspect(true);await inspect(false);
 await page.locator('.agent-replay > summary').click();await page.getByRole('combobox',{name:'Order replay'}).selectOption({label:'SO-2026-0412'});await page.getByRole('button',{name:'Play',exact:true}).click();await expect(page.getByRole('button',{name:'Pause',exact:true})).toBeVisible();await page.getByRole('button',{name:'Pause',exact:true}).click();
 for(const section of ['Approvals','Orders','Schedule','Materials','Quotations','Dashboards','Quality','History']){await page.getByRole('link',{name:section,exact:true}).click();await expect(page.getByRole('heading',{name:section,exact:true}).first()).toBeVisible();await page.waitForTimeout(250);await shot(section.toLowerCase()+'-desktop');}
 await page.getByRole('link',{name:'Dashboards',exact:true}).click();const diag=page.getByRole('button',{name:/Quality & workflow diagnostics/});await expect(diag).toHaveAttribute('aria-expanded','false');await diag.click();await expect(page.getByRole('heading',{name:'AI cost per day'})).toBeVisible();
 await page.getByRole('button',{name:/Choose From/}).click();await expect(page.getByRole('dialog',{name:'Choose date'})).toBeVisible();await shot('calendar-desktop');await page.keyboard.press('ArrowRight');await page.keyboard.press('Enter');await expect(page.getByRole('dialog',{name:'Choose date'})).toHaveCount(0);
 await page.getByRole('button',{name:'Switch to dark theme'}).click();await page.waitForTimeout(300);await shot('dashboard-dark');await page.getByRole('link',{name:'Agent map',exact:true}).click();await expect(page.getByRole('heading',{name:'Agent map',exact:true})).toBeVisible();await page.waitForTimeout(250);await shot('agents-dark');await page.getByRole('button',{name:'Switch to light theme'}).click();
 await page.setViewportSize({width:390,height:844});await page.emulateMedia({reducedMotion:'reduce'});await page.getByRole('button',{name:'Collapse sidebar'}).click();await inspect(true);await inspect(false);
 for(const section of ['Dashboards','Schedule','Orders']){await page.getByRole('link',{name:section,exact:true}).click();await page.waitForTimeout(250);assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),section+' overflows mobile');await shot(section.toLowerCase()+'-mobile');}
 assert.deepEqual(errors,[]);console.log('UI checks passed: auto-focus, docked inspectors, orbit, pan, reset, replay, all routes, custom calendar, dark theme, mobile.');
}finally{await browser.close();}
