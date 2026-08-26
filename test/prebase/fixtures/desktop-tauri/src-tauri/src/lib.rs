#[tauri::command]
fn greet(name: String) -> String {
	format!("Hello, {name}")
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
	let mut builder = tauri::Builder::default();
	#[cfg(all(debug_assertions, feature = "prebase-testing"))]
	{
		builder = builder
			.plugin(tauri_plugin_wdio::init())
			.plugin(tauri_plugin_wdio_webdriver::init());
	}
	builder
		.invoke_handler(tauri::generate_handler![greet])
		.run(tauri::generate_context!())
		.expect("error while running tauri application");
}
