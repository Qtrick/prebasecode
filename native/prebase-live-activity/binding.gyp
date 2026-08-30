{
  "targets": [
    {
      "target_name": "prebase_live_activity",
      "conditions": [
        ["OS=='mac'", {
          "sources": ["src/live_activity.mm"],
          "include_dirs": [
            "../../node_modules/node-addon-api"
          ],
          "libraries": ["-framework AppKit", "-framework Foundation"],
          "defines": ["NAPI_DISABLE_CPP_EXCEPTIONS", "NAPI_VERSION=8"],
          "xcode_settings": {
            "MACOSX_DEPLOYMENT_TARGET": "12.0",
            "CLANG_ENABLE_OBJC_ARC": "YES",
            "CLANG_CXX_LANGUAGE_STANDARD": "c++17",
            "GCC_ENABLE_CPP_EXCEPTIONS": "NO",
            "OTHER_CPLUSPLUSFLAGS": ["-std=c++17", "-fobjc-arc"]
          }
        }],
        ["OS!='mac'", {
          "sources": ["src/live_activity_stub.cc"]
        }]
      ]
    }
  ]
}
