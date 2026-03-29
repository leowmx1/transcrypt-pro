const { FusesPlugin } = require('@electron-forge/plugin-fuses');
const { FuseV1Options, FuseVersion } = require('@electron/fuses');
const path = require('path');
const appIconPath = path.resolve(__dirname, 'assets', 'app-icon.ico');

module.exports = {
  packagerConfig: {
    asar: {
      unpackDir: "node_modules/{ffmpeg-static,ffprobe-static}"
    },
    icon: appIconPath,
    name: 'TransCrypt Pro'
  },
  rebuildConfig: {},
  makers: [
    {
      name: '@electron-forge/maker-wix',
      config: {
        language: 2052, // 中文(简体)的 locale ID
        manufacturer: 'leowmx', // 会显示在安装程序中
        description: 'A powerful file format transformer and encryption tool built with Electron.', // 应用描述
        icon: appIconPath,
        extensions: ['WixUtilExtension'],
        associateExtensions: '.tclock,.tckey',
        ui: {
           chooseDirectory: true // 是否允许用户选择安装目录
        }
      }
    }
  ],
  plugins: [
    {
      name: '@electron-forge/plugin-auto-unpack-natives',
      config: {},
    },
    // Fuses are used to enable/disable various Electron functionality
    // at package time, before code signing the application
    new FusesPlugin({
      version: FuseVersion.V1,
      [FuseV1Options.RunAsNode]: false,
      [FuseV1Options.EnableCookieEncryption]: true,
      [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
      [FuseV1Options.EnableNodeCliInspectArguments]: false,
      [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
      [FuseV1Options.OnlyLoadAppFromAsar]: true,
    }),
  ],
};
