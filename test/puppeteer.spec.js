/**
 * Copyright 2017 Google Inc. All rights reserved.
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
const fs = require('fs');
const os = require('os');
const rm = require('rimraf').sync;
const path = require('path');
const {helper} = require('../lib/helper');
const mkdtempAsync = helper.promisify(fs.mkdtemp);
const readFileAsync = helper.promisify(fs.readFile);
const statAsync = helper.promisify(fs.stat);
const TMP_FOLDER = path.join(os.tmpdir(), 'pptr_tmp_folder-');
const utils = require('./utils');

module.exports.addTests = function({testRunner, expect, PROJECT_ROOT, defaultBrowserOptions}) {
  const {describe, xdescribe, fdescribe} = testRunner;
  const {it, fit, xit} = testRunner;
  const {beforeAll, beforeEach, afterAll, afterEach} = testRunner;
  const puppeteer = require(PROJECT_ROOT);

  describe('Puppeteer', function() {
    describe('BrowserFetcher', function() {
      it('should download and extract linux binary', async({server}) => {
        const downloadsFolder = await mkdtempAsync(TMP_FOLDER);
        const browserFetcher = puppeteer.createBrowserFetcher({
          platform: 'linux',
          path: downloadsFolder,
          host: server.PREFIX
        });
        let revisionInfo = browserFetcher.revisionInfo('123456');
        server.setRoute(revisionInfo.url.substring(server.PREFIX.length), (req, res) => {
          server.serveFile(req, res, '/chromium-linux.zip');
        });

        expect(revisionInfo.local).toBe(false);
        expect(browserFetcher.platform()).toBe('linux');
        expect(await browserFetcher.canDownload('100000')).toBe(false);
        expect(await browserFetcher.canDownload('123456')).toBe(true);

        revisionInfo = await browserFetcher.download('123456');
        expect(revisionInfo.local).toBe(true);
        expect(await readFileAsync(revisionInfo.executablePath, 'utf8')).toBe('LINUX BINARY\n');
        const expectedPermissions = os.platform() === 'win32' ? 0666 : 0755;
        expect((await statAsync(revisionInfo.executablePath)).mode & 0777).toBe(expectedPermissions);
        expect(await browserFetcher.localRevisions()).toEqual(['123456']);
        await browserFetcher.remove('123456');
        expect(await browserFetcher.localRevisions()).toEqual([]);
        rm(downloadsFolder);
      });
    });
    describe('AppMode', function() {
      it('should work', async() => {
        const options = Object.assign({appMode: true}, defaultBrowserOptions);
        const browser = await puppeteer.launch(options);
        const page = await browser.newPage();
        expect(await page.evaluate('11 * 11')).toBe(121);
        await page.close();
        await browser.close();
      });
    });
    describe('Puppeteer.launch', function() {
      it('should support ignoreHTTPSErrors option', async({httpsServer}) => {
        const options = Object.assign({ignoreHTTPSErrors: true}, defaultBrowserOptions);
        const browser = await puppeteer.launch(options);
        const page = await browser.newPage();
        let error = null;
        const response = await page.goto(httpsServer.EMPTY_PAGE).catch(e => error = e);
        expect(error).toBe(null);
        expect(response.ok()).toBe(true);
        expect(response.securityDetails()).toBeTruthy();
        expect(response.securityDetails().protocol()).toBe('TLS 1.2');
        await page.close();
        await browser.close();
      });
      it('Network redirects should report SecurityDetails', async({httpsServer}) => {
        const options = Object.assign({ignoreHTTPSErrors: true}, defaultBrowserOptions);
        const browser = await puppeteer.launch(options);
        const page = await browser.newPage();
        httpsServer.setRedirect('/plzredirect', '/empty.html');
        const responses =  [];
        page.on('response', response => responses.push(response));
        await page.goto(httpsServer.PREFIX + '/plzredirect');
        expect(responses.length).toBe(2);
        expect(responses[0].status()).toBe(302);
        const securityDetails = responses[0].securityDetails();
        expect(securityDetails.protocol()).toBe('TLS 1.2');
        await page.close();
        await browser.close();
      });
      it('should work with mixed content', async({server, httpsServer}) => {
        httpsServer.setRoute('/mixedcontent.html', (req, res) => {
          res.end(`<iframe src=${server.EMPTY_PAGE}></iframe>`);
        });
        const options = Object.assign({ignoreHTTPSErrors: true}, defaultBrowserOptions);
        const browser = await puppeteer.launch(options);
        const page = await browser.newPage();
        await page.goto(httpsServer.PREFIX + '/mixedcontent.html', {waitUntil: 'load'});
        await page.close();
        await browser.close();
      });
      it('should reject all promises when browser is closed', async() => {
        const browser = await puppeteer.launch(defaultBrowserOptions);
        const page = await browser.newPage();
        let error = null;
        const neverResolves = page.evaluate(() => new Promise(r => {})).catch(e => error = e);
        await browser.close();
        await neverResolves;
        expect(error.message).toContain('Protocol error');
      });
      it('should reject if executable path is invalid', async({server}) => {
        let waitError = null;
        const options = Object.assign({}, defaultBrowserOptions, {executablePath: 'random-invalid-path'});
        await puppeteer.launch(options).catch(e => waitError = e);
        expect(waitError.message.startsWith('Failed to launch chrome! spawn random-invalid-path ENOENT')).toBe(true);
      });
      it('userDataDir option', async({server}) => {
        const userDataDir = await mkdtempAsync(TMP_FOLDER);
        const options = Object.assign({userDataDir}, defaultBrowserOptions);
        const browser = await puppeteer.launch(options);
        expect(fs.readdirSync(userDataDir).length).toBeGreaterThan(0);
        await browser.close();
        expect(fs.readdirSync(userDataDir).length).toBeGreaterThan(0);
        rm(userDataDir);
      });
      it('userDataDir argument', async({server}) => {
        const userDataDir = await mkdtempAsync(TMP_FOLDER);
        const options = Object.assign({}, defaultBrowserOptions);
        options.args = [`--user-data-dir=${userDataDir}`].concat(options.args);
        const browser = await puppeteer.launch(options);
        expect(fs.readdirSync(userDataDir).length).toBeGreaterThan(0);
        await browser.close();
        expect(fs.readdirSync(userDataDir).length).toBeGreaterThan(0);
        rm(userDataDir);
      });
      it('userDataDir option should restore state', async({server}) => {
        const userDataDir = await mkdtempAsync(TMP_FOLDER);
        const options = Object.assign({userDataDir}, defaultBrowserOptions);
        const browser = await puppeteer.launch(options);
        const page = await browser.newPage();
        await page.goto(server.EMPTY_PAGE);
        await page.evaluate(() => localStorage.hey = 'hello');
        await browser.close();

        const browser2 = await puppeteer.launch(options);
        const page2 = await browser2.newPage();
        await page2.goto(server.EMPTY_PAGE);
        expect(await page2.evaluate(() => localStorage.hey)).toBe('hello');
        await browser2.close();
        rm(userDataDir);
      });
      it('userDataDir option should restore cookies', async({server}) => {
        const userDataDir = await mkdtempAsync(TMP_FOLDER);
        const options = Object.assign({userDataDir}, defaultBrowserOptions);
        const browser = await puppeteer.launch(options);
        const page = await browser.newPage();
        await page.goto(server.EMPTY_PAGE);
        await page.evaluate(() => document.cookie = 'doSomethingOnlyOnce=true; expires=Fri, 31 Dec 9999 23:59:59 GMT');
        await browser.close();

        const browser2 = await puppeteer.launch(options);
        const page2 = await browser2.newPage();
        await page2.goto(server.EMPTY_PAGE);
        expect(await page2.evaluate(() => document.cookie)).toBe('doSomethingOnlyOnce=true');
        await browser2.close();
        rm(userDataDir);
      });
      xit('headless should be able to read cookies written by headful', async({server}) => {
        const userDataDir = await mkdtempAsync(TMP_FOLDER);
        const options = Object.assign({userDataDir}, defaultBrowserOptions);
        // Write a cookie in headful chrome
        options.headless = false;
        const headfulBrowser = await puppeteer.launch(options);
        const headfulPage = await headfulBrowser.newPage();
        await headfulPage.goto(server.EMPTY_PAGE);
        await headfulPage.evaluate(() => document.cookie = 'foo=true; expires=Fri, 31 Dec 9999 23:59:59 GMT');
        await headfulBrowser.close();
        // Read the cookie from headless chrome
        options.headless = true;
        const headlessBrowser = await puppeteer.launch(options);
        const headlessPage = await headlessBrowser.newPage();
        await headlessPage.goto(server.EMPTY_PAGE);
        const cookie = await headlessPage.evaluate(() => document.cookie);
        await headlessBrowser.close();
        rm(userDataDir);
        expect(cookie).toBe('foo=true');
      });
      it('should return the default chrome arguments', async() => {
        const args = puppeteer.defaultArgs();
        expect(args).toContain('--no-first-run');
      });
      it('should dump browser process stderr', async({server}) => {
        const dumpioTextToLog = 'MAGIC_DUMPIO_TEST';
        let dumpioData = '';
        const {spawn} = require('child_process');
        const options = Object.assign({dumpio: true}, defaultBrowserOptions);
        const res = spawn('node',
            [path.join(__dirname, 'fixtures', 'dumpio.js'), PROJECT_ROOT, JSON.stringify(options), server.EMPTY_PAGE, dumpioTextToLog]);
        res.stderr.on('data', data => dumpioData += data.toString('utf8'));
        await new Promise(resolve => res.on('close', resolve));

        expect(dumpioData).toContain(dumpioTextToLog);
      });
      it('should close the browser when the node process closes', async({ server }) => {
        const {spawn, execSync} = require('child_process');
        const res = spawn('node', [path.join(__dirname, 'fixtures', 'closeme.js'), PROJECT_ROOT, JSON.stringify(defaultBrowserOptions)]);
        let wsEndPointCallback;
        const wsEndPointPromise = new Promise(x => wsEndPointCallback = x);
        let output = '';
        res.stdout.on('data', data => {
          output += data;
          if (output.indexOf('\n'))
            wsEndPointCallback(output.substring(0, output.indexOf('\n')));
        });
        const browser = await puppeteer.connect({ browserWSEndpoint: await wsEndPointPromise });
        const promises = [
          new Promise(resolve => browser.once('disconnected', resolve)),
          new Promise(resolve => res.on('close', resolve))];
        if (process.platform === 'win32')
          execSync(`taskkill /pid ${res.pid} /T /F`);
        else
          process.kill(res.pid);
        await Promise.all(promises);
      });
      it('should support the pipe option', async() => {
        const options = Object.assign({pipe: true}, defaultBrowserOptions);
        const browser = await puppeteer.launch(options);
        expect(browser.wsEndpoint()).toBe('');
        const page = await browser.newPage();
        expect(await page.evaluate('11 * 11')).toBe(121);
        await page.close();
        await browser.close();
      });
      it('should support the pipe argument', async() => {
        const options = Object.assign({}, defaultBrowserOptions);
        options.ignoreDefaultArgs = true;
        options.args = ['--remote-debugging-pipe'].concat(options.args);
        const browser = await puppeteer.launch(options);
        expect(browser.wsEndpoint()).toBe('');
        const page = await browser.newPage();
        expect(await page.evaluate('11 * 11')).toBe(121);
        await page.close();
        await browser.close();
      });
      it('should work with no default arguments', async() => {
        const options = Object.assign({}, defaultBrowserOptions);
        options.ignoreDefaultArgs = true;
        const browser = await puppeteer.launch(options);
        const page = await browser.newPage();
        expect(await page.evaluate('11 * 11')).toBe(121);
        await page.close();
        await browser.close();
      });
    });
    describe('Puppeteer.connect', function() {
      it('should be able to connect multiple times to the same browser', async({server}) => {
        const originalBrowser = await puppeteer.launch(defaultBrowserOptions);
        const browser = await puppeteer.connect({
          browserWSEndpoint: originalBrowser.wsEndpoint()
        });
        const page = await browser.newPage();
        expect(await page.evaluate(() => 7 * 8)).toBe(56);
        browser.disconnect();

        const secondPage = await originalBrowser.newPage();
        expect(await secondPage.evaluate(() => 7 * 6)).toBe(42, 'original browser should still work');
        await originalBrowser.close();
      });
      it('should be able to reconnect to a disconnected browser', async({server}) => {
        const originalBrowser = await puppeteer.launch(defaultBrowserOptions);
        const browserWSEndpoint = originalBrowser.wsEndpoint();
        const page = await originalBrowser.newPage();
        await page.goto(server.PREFIX + '/frames/nested-frames.html');
        originalBrowser.disconnect();

        const browser = await puppeteer.connect({browserWSEndpoint});
        const pages = await browser.pages();
        const restoredPage = pages.find(page => page.url() === server.PREFIX + '/frames/nested-frames.html');
        expect(utils.dumpFrames(restoredPage.mainFrame())).toBeGolden('reconnect-nested-frames.txt');
        expect(await restoredPage.evaluate(() => 7 * 8)).toBe(56);
        await browser.close();
      });
    });
    describe('Puppeteer.executablePath', function() {
      it('should work', async({server}) => {
        const executablePath = puppeteer.executablePath();
        expect(fs.existsSync(executablePath)).toBe(true);
      });
    });
  });

  describe('Browser.Events.disconnected', function() {
    it('should be emitted when: browser gets closed, disconnected or underlying websocket gets closed', async() => {
      const originalBrowser = await puppeteer.launch(defaultBrowserOptions);
      const browserWSEndpoint = originalBrowser.wsEndpoint();
      const remoteBrowser1 = await puppeteer.connect({browserWSEndpoint});
      const remoteBrowser2 = await puppeteer.connect({browserWSEndpoint});

      let disconnectedOriginal = 0;
      let disconnectedRemote1 = 0;
      let disconnectedRemote2 = 0;
      originalBrowser.on('disconnected', () => ++disconnectedOriginal);
      remoteBrowser1.on('disconnected', () => ++disconnectedRemote1);
      remoteBrowser2.on('disconnected', () => ++disconnectedRemote2);

      await Promise.all([
        utils.waitEvent(remoteBrowser2, 'disconnected'),
        remoteBrowser2.disconnect(),
      ]);

      expect(disconnectedOriginal).toBe(0);
      expect(disconnectedRemote1).toBe(0);
      expect(disconnectedRemote2).toBe(1);

      await Promise.all([
        utils.waitEvent(remoteBrowser1, 'disconnected'),
        utils.waitEvent(originalBrowser, 'disconnected'),
        originalBrowser.close(),
      ]);

      expect(disconnectedOriginal).toBe(1);
      expect(disconnectedRemote1).toBe(1);
      expect(disconnectedRemote2).toBe(1);
    });
  });

};
