#include <napi.h>

Napi::Object Init(Napi::Env env, Napi::Object exports) {
	exports.Set("unavailable", Napi::Boolean::New(env, true));
	return exports;
}

NODE_API_MODULE(prebase_live_activity, Init)
