const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');

function createWindow() {
	const win = new BrowserWindow({
		width: 640,
		height: 480,
		webPreferences: {
			preload: path.join(__dirname, 'preload.js'),
			contextIsolation: true,
			nodeIntegration: false,
		},
	});
	void win.loadFile(path.join(__dirname, 'index.html'));
}

ipcMain.handle('greet', (_event, name) => {
	console.log('main greet', name);
	return `Hello, ${String(name || 'world')}`;
});

app.whenReady().then(() => {
	createWindow();
	app.on('activate', () => {
		if (BrowserWindow.getAllWindows().length === 0) {
			createWindow();
		}
	});
});

app.on('window-all-closed', () => {
	app.quit();
});
