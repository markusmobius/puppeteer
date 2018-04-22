/**
 * Copyright 2018 Google Inc. All rights reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

module.exports.addTests = function({testRunner, expect, puppeteer, headless}) {
  const {describe, xdescribe, fdescribe} = testRunner;
  const {it, fit, xit} = testRunner;
  const {beforeAll, beforeEach, afterAll, afterEach} = testRunner;

  describe('Browser.version', function() {
    it('should return whether we are in headless', async({browser}) => {
      const version = await browser.version();
      expect(version.length).toBeGreaterThan(0);
      expect(version.startsWith('Headless')).toBe(headless);
    });
  });

  describe('Browser.userAgent', function() {
    it('should include WebKit', async({browser}) => {
      const userAgent = await browser.userAgent();
      expect(userAgent.length).toBeGreaterThan(0);
      expect(userAgent).toContain('WebKit');
    });
  });

  describe('Browser.newIsolatedPage', function() {
    beforeEach(async state => {
      state.incognitoPage1 = await state.browser.newIsolatedPage();
      state.incognitoPage2 = await state.browser.newIsolatedPage();
    });

    afterEach(async state => {
      await state.incognitoPage1.close();
      state.incognitoPage1 = null;
      await state.incognitoPage2.close();
      state.incognitoPage2 = null;
    });

    it('should use a separate browser context', async function({page, incognitoPage1, incognitoPage2, server}) {
      await page.goto(server.PREFIX + '/grid.html');
      await incognitoPage1.goto(server.PREFIX + '/grid.html');
      await incognitoPage2.goto(server.PREFIX + '/grid.html');
      expect(await page.cookies()).toEqual([]);
      expect(await incognitoPage1.cookies()).toEqual([]);
      expect(await incognitoPage2.cookies()).toEqual([]);
      await incognitoPage1.setCookie({
        name: 'password',
        value: '123456'
      });
      await incognitoPage2.setCookie({
        name: 'password',
        value: '654321'
      });
      expect(await incognitoPage1.cookies()).toEqual([{
        name: 'password',
        value: '123456',
        domain: 'localhost',
        path: '/',
        expires: -1,
        size: 14,
        httpOnly: false,
        secure: false,
        session: true
      }]);
      expect(await incognitoPage2.cookies()).toEqual([{
        name: 'password',
        value: '654321',
        domain: 'localhost',
        path: '/',
        expires: -1,
        size: 14,
        httpOnly: false,
        secure: false,
        session: true
      }]);
      expect(await page.cookies()).toEqual([]);
    });
  });

  describe('Browser.process', function() {
    it('should return child_process instance', async function({browser}) {
      const process = await browser.process();
      expect(process.pid).toBeGreaterThan(0);
      const browserWSEndpoint = browser.wsEndpoint();
      const remoteBrowser = await puppeteer.connect({browserWSEndpoint});
      expect(remoteBrowser.process()).toBe(null);
      await remoteBrowser.disconnect();
    });
  });
};
