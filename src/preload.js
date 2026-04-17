'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('rrElectron', {
  invoke: (channel, ...args) => ipcRenderer.invoke(channel, ...args),
  on: (channel, callback) => {
    if (typeof callback !== 'function') return;
    ipcRenderer.on(channel, (event, ...rest) => callback(event, ...rest));
  },
});
