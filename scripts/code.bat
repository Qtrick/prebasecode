@echo off
setlocal enabledelayedexpansion

title PreBase Dev

pushd %~dp0\..

:: Get electron, compile, built-in extensions
if "%VSCODE_SKIP_PRELAUNCH%"=="" (
	node build/lib/preLaunch.ts || (
		echo Failed to prepare PreBase for launch ^(build/lib/preLaunch.ts^). 1>&2
		exit /b 1
	)
)

set "NAMESHORT="
for /f "tokens=2 delims=:," %%a in ('findstr /R /C:"\"nameShort\":.*" product.json') do if not defined NAMESHORT set "NAMESHORT=%%~a"
set NAMESHORT=%NAMESHORT: "=%
set NAMESHORT=%NAMESHORT:"=%.exe
set CODE=".build\electron\%NAMESHORT%"

:: Manage built-in extensions
if "%~1"=="--builtin" goto builtin

:: Configuration
set NODE_ENV=development
set VSCODE_DEV=1
set VSCODE_CLI=1
set ELECTRON_ENABLE_LOGGING=1
set ELECTRON_ENABLE_STACK_DUMPING=1

set DISABLE_TEST_EXTENSION="--disable-extension=vscode.vscode-api-tests"
for %%A in (%*) do (
	if "%%~A"=="--extensionTestsPath" (
		set DISABLE_TEST_EXTENSION=""
	)
)

:: Enable Magnus proposed APIs.
:: Do NOT pass --extensionDevelopmentPath by default — opt in with PREBASE_MAGNUS_EXT_DEV=1.
set MAGNUS_DEV_PATH=%~dp0..\extensions\prebase-magnus
set MAGNUS_DEV_ARG=
set INPUT_ARGS=%*
if not "!INPUT_ARGS:prebase.magnus=!"=="!INPUT_ARGS!" goto skip_proposed
	set MAGNUS_DEV_ARG=--enable-proposed-api=prebase.magnus
:skip_proposed

set MAGNUS_EXT_DEV_ARG=
if "%PREBASE_MAGNUS_EXT_DEV%"=="1" (
	if exist "%MAGNUS_DEV_PATH%" (
		if "!INPUT_ARGS:--extensionDevelopmentPath=!"=="!INPUT_ARGS!" (
			set "MAGNUS_EXT_DEV_ARG=--extensionDevelopmentPath=%MAGNUS_DEV_PATH%"
		)
	)
)

:: Never send usage/crash telemetry to Microsoft or third parties.
set TELEMETRY_ARG=--disable-telemetry
if not "!INPUT_ARGS:--disable-telemetry=!"=="!INPUT_ARGS!" set TELEMETRY_ARG=

:: Launch PreBase
%CODE% . %DISABLE_TEST_EXTENSION% %MAGNUS_DEV_ARG% %MAGNUS_EXT_DEV_ARG% %TELEMETRY_ARG% %*
goto end

:builtin
%CODE% build/builtin

:end

popd

endlocal
