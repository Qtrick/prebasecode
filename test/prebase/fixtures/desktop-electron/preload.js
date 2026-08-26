const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('fixture', {
	greet: (name) => ipcRenderer.invoke('greet', name),
});
