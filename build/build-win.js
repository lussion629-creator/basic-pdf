// Windows 오프라인 설치본 빌드
//   node build/build-win.js → dist/release/ (Basic-PDF-Setup.zip, data.002 ~ data.004)
// GitHub 첨부 한도에 맞춰 앱을 27MB 조각으로 나누고, 설치 스크립트가 합친 뒤 SHA-256으로 확인한다.
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { zipSync } = require('fflate');
const { packager } = require('@electron/packager');

const ROOT = path.join(__dirname, '..');
const DIST = path.join(ROOT, 'dist');
const REL = path.join(DIST, 'release');
const ELECTRON = require(path.join(ROOT, 'node_modules', 'electron', 'package.json')).version;
const CHUNK = 29 * 1000 * 1000; // 첨부 한도(30MB) 아래
const crlf = (t) => Buffer.from(t.replace(/\r\n/g, '\n').replace(/\n/g, '\r\n'), 'utf8');
const bom = (t) => Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), crlf(t)]);

(async () => {
  fs.rmSync(path.join(DIST, 'win'), { recursive: true, force: true });
  fs.rmSync(REL, { recursive: true, force: true });
  fs.mkdirSync(REL, { recursive: true });

  // 1) 패키징
  fs.copyFileSync(path.join(__dirname, 'icon.png'), path.join(ROOT, 'app', 'icon.png'));
  const [out] = await packager({
    dir: path.join(ROOT, 'app'), name: 'Basic PDF', executableName: 'BasicPDF', appVersion: require('../app/package.json').version,
    platform: 'win32', arch: 'x64', electronVersion: ELECTRON, asar: true, overwrite: true, out: path.join(DIST, 'win'),
  });
  const exe = path.join(out, 'BasicPDF.exe');
  console.log('패키징:', path.relative(ROOT, out));

  // 2) 보안 퓨즈 + 아이콘·버전 정보
  require('child_process').execFileSync(process.execPath, [path.join(__dirname, 'fuses.js'), exe], { stdio: 'inherit' });
  require('child_process').execFileSync(process.execPath, [path.join(__dirname, 'seticon.js'), exe, path.join(__dirname, 'icon.ico')], { stdio: 'inherit' });

  // 3) 한국어·영어 외 언어 파일 정리, 안내문
  for (const f of fs.readdirSync(path.join(out, 'locales'))) if (!['ko.pak', 'en-US.pak'].includes(f)) fs.rmSync(path.join(out, 'locales', f));
  fs.writeFileSync(path.join(out, '사용 안내.txt'), bom(fs.readFileSync(path.join(__dirname, 'usage.txt'), 'utf8').replace(/^﻿/, '')));

  // 4) 앱 전체를 zip 으로 묶고 조각내기
  const entries = {};
  (function walk(dir) {
    for (const f of fs.readdirSync(dir)) {
      const p = path.join(dir, f);
      if (fs.statSync(p).isDirectory()) walk(p);
      else entries[path.relative(out, p).split(path.sep).join('/')] = [new Uint8Array(fs.readFileSync(p)), { level: 9 }];
    }
  })(out);
  const full = Buffer.from(zipSync(entries));
  const sha = crypto.createHash('sha256').update(full).digest('hex');
  // 조각 크기를 고르게 나눈다 (조각당 최대 CHUNK)
  const n = Math.ceil(full.length / CHUNK);
  const size = Math.ceil(full.length / n);
  const parts = [];
  for (let i = 0; i < full.length; i += size) parts.push(full.subarray(i, i + size));
  const names = parts.map((_, i) => `data.${String(i + 1).padStart(3, '0')}`);
  parts.slice(1).forEach((b, i) => fs.writeFileSync(path.join(REL, names[i + 1]), b));
  console.log(`앱 압축본 ${(full.length / 1048576).toFixed(1)} MB → ${n}조각`);

  // 5) 설치 zip (설치 스크립트 + 첫 조각)
  const F = 'Basic PDF 설치/';
  const last = names[names.length - 1];
  const inst = fs.readFileSync(path.join(__dirname, 'install-offline.ps1'), 'utf8')
    .replace('__SHA256__', sha)
    .replace(/\$parts\s*=\s*@\([^)]*\)/, `$parts   = @(${names.map(x => `'${x}'`).join(', ')})`)
    .replace(/data\.001 ~ data\.004/g, `data.001 ~ ${last}`)
    .replace(/data\.002 ~ data\.004/g, `data.002 ~ ${last}`);
  const guide = fs.readFileSync(path.join(__dirname, 'install-guide.txt'), 'utf8')
    .replace(/파일 4개/g, `파일 ${n}개`).replace(/data\.002, data\.003, data\.004/g, names.slice(1).join(', ')).replace(/data\.002 ~ data\.004/g, `data.002 ~ ${last}`);
  const zip = zipSync({
    [F + '설치.bat']: [crlf('@echo off\npowershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0install.ps1"\npause\n'), { level: 6 }],
    [F + '제거.bat']: [crlf('@echo off\npowershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0uninstall.ps1"\npause\n'), { level: 6 }],
    [F + 'install.ps1']: [bom(inst), { level: 6 }],
    [F + 'uninstall.ps1']: [bom(fs.readFileSync(path.join(__dirname, 'uninstall.ps1'), 'utf8')), { level: 6 }],
    [F + '설치 방법.txt']: [bom(guide), { level: 6 }],
    [F + 'data.001']: [new Uint8Array(parts[0]), { level: 0 }],
  });
  fs.writeFileSync(path.join(REL, 'Basic-PDF-Setup.zip'), zip);
  fs.writeFileSync(path.join(REL, 'SHA256.txt'), `${sha}  (data.001 ~ ${last} 를 합친 파일)\n`);

  for (const f of fs.readdirSync(REL)) console.log(`  ${f}  ${(fs.statSync(path.join(REL, f)).size / 1048576).toFixed(1)} MB`);
  console.log('완료 → dist/release/ 의 파일을 GitHub Releases 에 올리세요.');
})().catch((e) => { console.error(e); process.exit(1); });
