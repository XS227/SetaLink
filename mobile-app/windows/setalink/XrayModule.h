#pragma once
// RN Windows native module — the Windows counterpart of Android's
// mobile-app/android/app/src/main/java/com/setalink/modules/XrayModule.kt.
// vpnBridge.ts's createAdapter() looks up `NativeModules.XrayModule` (old-
// architecture bridge path) and, if present, wraps it in the exact same
// NativeAdapter used on Android/iOS — so this module only needs to expose
// matching method names/shapes, no JS changes required.
//
// Unlike Android (in-process VpnService + broadcasts) or iOS (App Group +
// Network Extension), the actual tunnel on Windows is owned by a separate
// SYSTEM-level service (RealGramVpnService.exe — see mobile-app/windows/
// vpn-service/) because creating a WinTun adapter and changing the default
// route needs Administrator rights that this app's unelevated process
// should not run with. This module is a thin named-pipe client talking to
// that service; see mobile-app/windows/shared/PipeProtocol.h for the wire
// format both sides share.
//
// First pass ("minimal core" scope): start/stop/isRunning/getStats/
// getLastProbeResult/getLastError/getConnectionLog/getXrayLog/
// getTun2socksLog/getGeneratedConfig. Methods Android/iOS expose that
// aren't implemented here (runSelfTest, runQuicProbe, getOrCreateRealSshIdentity,
// setBypassApps, telemetry, ...) are already handled gracefully by
// vpnBridge.ts's optional-chaining + .catch() fallbacks — same as the real
// gaps that already exist on iOS today.

#include "pch.h"

#include <NativeModules.h>
#include <winrt/Microsoft.ReactNative.h>

namespace winrt::SetaLink {

REACT_MODULE(XrayModule, L"XrayModule")
struct XrayModule {
  using ReactContext = winrt::Microsoft::ReactNative::ReactContext;

  REACT_INIT(Initialize)
  void Initialize(ReactContext const &reactContext) noexcept;

  REACT_METHOD(start, L"start")
  void start(std::string config,
             winrt::Microsoft::ReactNative::ReactPromise<void> promise) noexcept;

  REACT_METHOD(startEmergency, L"startEmergency")
  void startEmergency(std::string config,
                       winrt::Microsoft::ReactNative::ReactPromise<void> promise) noexcept;

  REACT_METHOD(stop, L"stop")
  void stop(winrt::Microsoft::ReactNative::ReactPromise<void> promise) noexcept;

  REACT_METHOD(isRunning, L"isRunning")
  void isRunning(winrt::Microsoft::ReactNative::ReactPromise<bool> promise) noexcept;

  REACT_METHOD(getLastProbeResult, L"getLastProbeResult")
  void getLastProbeResult(winrt::Microsoft::ReactNative::ReactPromise<bool> promise) noexcept;

  REACT_METHOD(getLastError, L"getLastError")
  void getLastError(winrt::Microsoft::ReactNative::ReactPromise<std::string> promise) noexcept;

  REACT_METHOD(getStats, L"getStats")
  void getStats(
      winrt::Microsoft::ReactNative::ReactPromise<winrt::Microsoft::ReactNative::JSValueObject> promise) noexcept;

  REACT_METHOD(getConnectionLog, L"getConnectionLog")
  void getConnectionLog(
      winrt::Microsoft::ReactNative::ReactPromise<winrt::Microsoft::ReactNative::JSValueArray> promise) noexcept;

  REACT_METHOD(getXrayLog, L"getXrayLog")
  void getXrayLog(winrt::Microsoft::ReactNative::ReactPromise<std::string> promise) noexcept;

  REACT_METHOD(getTun2socksLog, L"getTun2socksLog")
  void getTun2socksLog(winrt::Microsoft::ReactNative::ReactPromise<std::string> promise) noexcept;

  REACT_METHOD(getGeneratedConfig, L"getGeneratedConfig")
  void getGeneratedConfig(winrt::Microsoft::ReactNative::ReactPromise<std::string> promise) noexcept;

 private:
  ReactContext m_reactContext{nullptr};
};

}  // namespace winrt::SetaLink
