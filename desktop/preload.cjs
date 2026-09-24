const { contextBridge } = require('electron');

contextBridge.exposeInMainWorld(
  'correlationMonolithsDesktop',
  {
    isElectron: true
  }
);
