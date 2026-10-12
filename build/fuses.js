const { flipFuses, FuseVersion, FuseV1Options } = require('@electron/fuses');
flipFuses(process.argv[2], {
  version: FuseVersion.V1,
  [FuseV1Options.RunAsNode]: false,                         // ELECTRON_RUN_AS_NODE 로 Node 실행 금지
  [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false, // NODE_OPTIONS 주입 금지
  [FuseV1Options.EnableNodeCliInspectArguments]: false,     // --inspect 디버거 연결 금지
  [FuseV1Options.EnableCookieEncryption]: true,
  [FuseV1Options.OnlyLoadAppFromAsar]: true,                // 앱 코드 바꿔치기 방지
  [FuseV1Options.GrantFileProtocolExtraPrivileges]: true,
}).then(() => console.log('fuses set')).catch(e => { console.error(e); process.exit(1); });
