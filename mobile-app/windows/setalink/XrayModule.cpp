#include "pch.h"
#include "XrayModule.h"

#define WIN32_LEAN_AND_MEAN
#include <windows.h>

#include <sstream>
#include <thread>
#include <unordered_map>

#include "../shared/PipeProtocol.h"

using namespace RealGramVpn;
using winrt::Microsoft::ReactNative::JSValueArray;
using winrt::Microsoft::ReactNative::JSValueObject;
using winrt::Microsoft::ReactNative::ReactPromise;

namespace winrt::SetaLink {

namespace {

std::string WideToUtf8(const std::wstring &s) {
  if (s.empty()) return "";
  int len = WideCharToMultiByte(CP_UTF8, 0, s.data(), (int)s.size(), nullptr, 0, nullptr, nullptr);
  std::string out(len, '\0');
  WideCharToMultiByte(CP_UTF8, 0, s.data(), (int)s.size(), out.data(), len, nullptr, nullptr);
  return out;
}

// Connects, sends one framed request, reads one framed response, closes.
// See mobile-app/windows/shared/PipeProtocol.h for the wire format. Runs on
// a background thread from every REACT_METHOD below — this can block for
// several seconds on Start (the service doesn't reply until it has spawned
// Xray/tun2socks and probed real traffic), so it must never run on the JS
// thread.
bool CallService(Command cmd, const std::string &payload, ResponseStatus &outStatus, std::string &outResponse,
                  DWORD timeoutMs, std::string &transportError) {
  HANDLE pipe = INVALID_HANDLE_VALUE;
  const DWORD waitStart = GetTickCount();
  // CreateFileW is excluded from WINAPI_PARTITION_APP, which this project
  // targets as a react-native-windows/C++-WinRT app — CreateFile2 is the
  // app-family-compatible replacement for opening the named pipe.
  CREATEFILE2_EXTENDED_PARAMETERS pipeParams = {};
  pipeParams.dwSize = sizeof(pipeParams);
  pipeParams.dwFileAttributes = FILE_ATTRIBUTE_NORMAL;
  for (;;) {
    pipe = CreateFile2(kPipeName, GENERIC_READ | GENERIC_WRITE, 0, OPEN_EXISTING, &pipeParams);
    if (pipe != INVALID_HANDLE_VALUE) break;
    if (GetLastError() != ERROR_PIPE_BUSY) {
      transportError =
          "RealGram VPN service not reachable (is it installed/running? error=" + std::to_string(GetLastError()) +
          ")";
      return false;
    }
    if (GetTickCount() - waitStart > timeoutMs || !WaitNamedPipeW(kPipeName, 2000)) {
      transportError = "RealGram VPN service busy — timed out waiting for a free pipe instance";
      return false;
    }
  }

  DWORD mode = PIPE_READMODE_BYTE;
  SetNamedPipeHandleState(pipe, &mode, nullptr, nullptr);

  unsigned char header[5];
  header[0] = static_cast<unsigned char>(cmd);
  uint32_t len = (uint32_t)payload.size();
  header[1] = (unsigned char)(len & 0xFF);
  header[2] = (unsigned char)((len >> 8) & 0xFF);
  header[3] = (unsigned char)((len >> 16) & 0xFF);
  header[4] = (unsigned char)((len >> 24) & 0xFF);

  DWORD written = 0;
  if (!WriteFile(pipe, header, sizeof(header), &written, nullptr) || written != sizeof(header) ||
      (len > 0 && (!WriteFile(pipe, payload.data(), len, &written, nullptr) || written != len))) {
    transportError = "failed writing to RealGram VPN service pipe";
    CloseHandle(pipe);
    return false;
  }

  unsigned char respHeader[5];
  DWORD read = 0;
  if (!ReadFile(pipe, respHeader, sizeof(respHeader), &read, nullptr) || read != sizeof(respHeader)) {
    transportError = "failed reading from RealGram VPN service pipe (it may have crashed)";
    CloseHandle(pipe);
    return false;
  }
  outStatus = static_cast<ResponseStatus>(respHeader[0]);
  uint32_t rlen = (uint32_t)respHeader[1] | ((uint32_t)respHeader[2] << 8) | ((uint32_t)respHeader[3] << 16) |
                  ((uint32_t)respHeader[4] << 24);
  outResponse.clear();
  if (rlen > 0 && rlen < 8 * 1024 * 1024) {
    outResponse.resize(rlen);
    DWORD got = 0;
    if (!ReadFile(pipe, outResponse.data(), rlen, &got, nullptr) || got != rlen) {
      transportError = "truncated response from RealGram VPN service";
      CloseHandle(pipe);
      return false;
    }
  }
  CloseHandle(pipe);
  return true;
}

std::unordered_map<std::string, std::string> ParseStatus(const std::string &body) {
  std::unordered_map<std::string, std::string> out;
  std::istringstream stream(body);
  std::string line;
  while (std::getline(stream, line)) {
    auto eq = line.find('=');
    if (eq == std::string::npos) continue;
    out[line.substr(0, eq)] = line.substr(eq + 1);
  }
  return out;
}

void DoStart(bool emergency, std::string config, ReactPromise<void> promise) {
  std::thread([emergency, config = std::move(config), promise = std::move(promise)]() mutable {
    ResponseStatus status;
    std::string response, transportErr;
    bool ok = CallService(emergency ? Command::StartEmergency : Command::Start, config, status, response,
                           /*timeoutMs=*/20000, transportErr);
    if (!ok) {
      promise.Reject(transportErr.c_str());
      return;
    }
    if (status == ResponseStatus::Error) {
      promise.Reject(response.c_str());
      return;
    }
    promise.Resolve();
  }).detach();
}

}  // namespace

void XrayModule::Initialize(ReactContext const &reactContext) noexcept { m_reactContext = reactContext; }

void XrayModule::start(std::string config, ReactPromise<void> promise) noexcept {
  DoStart(false, std::move(config), std::move(promise));
}

void XrayModule::startEmergency(std::string config, ReactPromise<void> promise) noexcept {
  DoStart(true, std::move(config), std::move(promise));
}

void XrayModule::stop(ReactPromise<void> promise) noexcept {
  std::thread([promise = std::move(promise)]() mutable {
    ResponseStatus status;
    std::string response, transportErr;
    // Best-effort: if the service is already unreachable, there's nothing
    // running to stop either — resolve rather than surface a scary error
    // for what the user experiences as "disconnect", matching how Android's
    // stop() falls back to a plain Intent when the static handle is gone.
    CallService(Command::Stop, "", status, response, 5000, transportErr);
    promise.Resolve();
  }).detach();
}

void XrayModule::isRunning(ReactPromise<bool> promise) noexcept {
  std::thread([promise = std::move(promise)]() mutable {
    ResponseStatus status;
    std::string response, transportErr;
    if (!CallService(Command::Status, "", status, response, 5000, transportErr) || status == ResponseStatus::Error) {
      promise.Resolve(false);
      return;
    }
    auto fields = ParseStatus(response);
    promise.Resolve(fields["running"] == "1");
  }).detach();
}

void XrayModule::getLastProbeResult(ReactPromise<bool> promise) noexcept {
  std::thread([promise = std::move(promise)]() mutable {
    ResponseStatus status;
    std::string response, transportErr;
    if (!CallService(Command::Status, "", status, response, 5000, transportErr) || status == ResponseStatus::Error) {
      promise.Resolve(false);
      return;
    }
    auto fields = ParseStatus(response);
    promise.Resolve(fields["probeOk"] == "1");
  }).detach();
}

void XrayModule::getLastError(ReactPromise<std::string> promise) noexcept {
  std::thread([promise = std::move(promise)]() mutable {
    ResponseStatus status;
    std::string response, transportErr;
    if (!CallService(Command::Status, "", status, response, 5000, transportErr) || status == ResponseStatus::Error) {
      promise.Resolve(transportErr);
      return;
    }
    auto fields = ParseStatus(response);
    promise.Resolve(fields["error"]);
  }).detach();
}

void XrayModule::getStats(ReactPromise<JSValueObject> promise) noexcept {
  std::thread([promise = std::move(promise)]() mutable {
    ResponseStatus status;
    std::string response, transportErr;
    JSValueObject stats;
    // Per-byte counters aren't available in this first pass (would need
    // reading the child processes' IO counters) — 0 is a safe default;
    // vpnBridge.ts's VpnStats already treats missing fields as `?? 0`.
    stats["uploadBytes"] = 0;
    stats["downloadBytes"] = 0;
    stats["pingMs"] = 0;
    stats["uptime"] = 0;
    if (CallService(Command::Status, "", status, response, 5000, transportErr) && status == ResponseStatus::Ok) {
      auto fields = ParseStatus(response);
      auto it = fields.find("uptime");
      if (it != fields.end()) {
        try {
          stats["uptime"] = std::stod(it->second);
        } catch (...) {
        }
      }
    }
    promise.Resolve(stats);
  }).detach();
}

void XrayModule::getConnectionLog(ReactPromise<JSValueArray> promise) noexcept {
  std::thread([promise = std::move(promise)]() mutable {
    ResponseStatus status;
    std::string response, transportErr;
    JSValueArray log;
    if (CallService(Command::Status, "", status, response, 5000, transportErr)) {
      log.push_back(WideToUtf8(L"[XrayModule] service status: ") + response);
    } else {
      log.push_back(transportErr);
    }
    promise.Resolve(log);
  }).detach();
}

void XrayModule::getXrayLog(ReactPromise<std::string> promise) noexcept {
  std::thread([promise = std::move(promise)]() mutable {
    ResponseStatus status;
    std::string response, transportErr;
    if (!CallService(Command::GetXrayLog, "", status, response, 5000, transportErr)) {
      promise.Resolve("(no xray log — " + transportErr + ")");
      return;
    }
    promise.Resolve(response);
  }).detach();
}

void XrayModule::getTun2socksLog(ReactPromise<std::string> promise) noexcept {
  std::thread([promise = std::move(promise)]() mutable {
    ResponseStatus status;
    std::string response, transportErr;
    if (!CallService(Command::GetTun2socksLog, "", status, response, 5000, transportErr)) {
      promise.Resolve("(no tun2socks log — " + transportErr + ")");
      return;
    }
    promise.Resolve(response);
  }).detach();
}

void XrayModule::getGeneratedConfig(ReactPromise<std::string> promise) noexcept {
  std::thread([promise = std::move(promise)]() mutable {
    ResponseStatus status;
    std::string response, transportErr;
    if (!CallService(Command::GetGeneratedConfig, "", status, response, 5000, transportErr)) {
      promise.Resolve("(not available)");
      return;
    }
    promise.Resolve(response);
  }).detach();
}

}  // namespace winrt::SetaLink
