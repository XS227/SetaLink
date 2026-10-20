// RealGramVpnService.cpp
//
// SYSTEM-level Windows service that owns the RealGram VPN tunnel on Windows.
// Installed (sc create) and started by RealGram-Setup.exe, running for the
// life of the machine (like any VPN client's helper service — this is the
// same shape WireGuard/NordVPN/etc. use on Windows). It exists because
// Windows has no per-app equivalent of Android's VpnService permission
// dialog: creating a WinTun adapter and changing the default route needs
// Administrator rights, and this app should not run its whole (unelevated,
// unpackaged) UI process elevated just to get that.
//
// Responsibilities:
//   - Own the xray-core + tun2socks child processes (same binaries/versions
//     Android bundles — see mobile-app/android/app/src/main/assets and
//     docs/realgram/BUILD_SIZE_BUDGET.md).
//   - tun2socks creates + owns the WinTun adapter itself (`wintun://` device
//     support built into xjasonlyu/tun2socks v2.6.0) and sets the default
//     route through it — this service does not touch the routing table by
//     hand.
//   - Verify real traffic flows before reporting success (Rule 2 in
//     docs/CLAUDE_REALINK_RULES.md: "Connected != Working Unless Internet
//     Traffic Is Verified") via a real SOCKS5 HTTP probe, not just a
//     process-alive check.
//   - Expose start/stop/status to the unelevated app process over a named
//     pipe — see shared/PipeProtocol.h for the wire format.
//
// First pass ("minimal core", per the scoping decision): start, stop,
// status (running/probeOk/uptime/lastError), and log/config readback. No
// self-test, QUIC probe, REAL SSH identity, per-app bypass, or telemetry
// upload yet — vpnBridge.ts already treats all of those as optional
// (`?.()` with `.catch()` fallbacks), matching how iOS's gaps are handled
// today, so their absence here doesn't break anything JS-side.

#define WIN32_LEAN_AND_MEAN
#include <winsock2.h>
#include <ws2tcpip.h>
#include <windows.h>
#include <sddl.h>

#include <atomic>
#include <cstring>
#include <fstream>
#include <mutex>
#include <sstream>
#include <string>
#include <vector>

#include "../shared/PipeProtocol.h"

#pragma comment(lib, "ws2_32.lib")
#pragma comment(lib, "advapi32.lib")

using namespace RealGramVpn;

namespace {

constexpr wchar_t kServiceName[] = L"RealGramVpnService";

SERVICE_STATUS g_status{};
SERVICE_STATUS_HANDLE g_statusHandle = nullptr;
HANDLE g_stopEvent = nullptr;

std::wstring g_binDir;   // folder holding xray.exe / tun2socks.exe / wintun.dll (staged next to this service exe by the installer)
std::wstring g_dataDir;  // C:\ProgramData\RealGram — generated config + logs, service-writable regardless of which user is logged in

PROCESS_INFORMATION g_xrayProc{};
PROCESS_INFORMATION g_tun2socksProc{};
std::mutex g_procMutex;

std::atomic<bool> g_running{false};
std::atomic<bool> g_probeOk{false};
std::atomic<ULONGLONG> g_connectedAtTick{0};

std::wstring g_lastError;
std::mutex g_lastErrorMutex;

std::wstring GetModuleDir() {
  wchar_t path[MAX_PATH];
  DWORD n = GetModuleFileNameW(nullptr, path, MAX_PATH);
  std::wstring s(path, n);
  size_t pos = s.find_last_of(L"\\/");
  return pos == std::wstring::npos ? L"." : s.substr(0, pos);
}

void SetLastError(const std::wstring& msg) {
  std::lock_guard<std::mutex> lock(g_lastErrorMutex);
  g_lastError = msg;
}

std::wstring GetLastErrorMsg() {
  std::lock_guard<std::mutex> lock(g_lastErrorMutex);
  return g_lastError;
}

std::wstring Utf8ToWide(const std::string& s) {
  if (s.empty()) return L"";
  int len = MultiByteToWideChar(CP_UTF8, 0, s.data(), (int)s.size(), nullptr, 0);
  std::wstring out(len, L'\0');
  MultiByteToWideChar(CP_UTF8, 0, s.data(), (int)s.size(), out.data(), len);
  return out;
}

std::string WideToUtf8(const std::wstring& s) {
  if (s.empty()) return "";
  int len = WideCharToMultiByte(CP_UTF8, 0, s.data(), (int)s.size(), nullptr, 0, nullptr, nullptr);
  std::string out(len, '\0');
  WideCharToMultiByte(CP_UTF8, 0, s.data(), (int)s.size(), out.data(), len, nullptr, nullptr);
  return out;
}

bool ProcessAlive(PROCESS_INFORMATION& pi) {
  if (pi.hProcess == nullptr) return false;
  DWORD code = 0;
  if (!GetExitCodeProcess(pi.hProcess, &code)) return false;
  return code == STILL_ACTIVE;
}

void KillProcess(PROCESS_INFORMATION& pi) {
  if (pi.hProcess) {
    if (ProcessAlive(pi)) {
      TerminateProcess(pi.hProcess, 0);
      WaitForSingleObject(pi.hProcess, 3000);
    }
    CloseHandle(pi.hProcess);
  }
  if (pi.hThread) CloseHandle(pi.hThread);
  pi = PROCESS_INFORMATION{};
}

// Launches `exePath args`, stdout+stderr appended to logPath. `extraEnvVar`
// (optional) is added to the child's environment — used for Xray's
// XRAY_LOCATION_ASSET, same env var Android sets on its ProcessBuilder.
bool LaunchProcess(const std::wstring& exePath, const std::wstring& args, const std::wstring& workDir,
                    const std::wstring& logPath, const std::wstring& extraEnvVar, const std::wstring& extraEnvVal,
                    PROCESS_INFORMATION& outPi, std::wstring& err) {
  SECURITY_ATTRIBUTES sa{sizeof(sa), nullptr, TRUE};
  HANDLE hLog = CreateFileW(logPath.c_str(), FILE_APPEND_DATA, FILE_SHARE_READ, &sa, OPEN_ALWAYS,
                            FILE_ATTRIBUTE_NORMAL, nullptr);
  if (hLog == INVALID_HANDLE_VALUE) {
    err = L"cannot open log file " + logPath;
    return false;
  }
  SetFilePointer(hLog, 0, nullptr, FILE_END);

  STARTUPINFOW si{};
  si.cb = sizeof(si);
  si.dwFlags = STARTF_USESTDHANDLES;
  si.hStdOutput = hLog;
  si.hStdError = hLog;
  si.hStdInput = nullptr;

  std::wstring cmdLine = L"\"" + exePath + L"\" " + args;

  // Child environment = this service's own environment (+ one optional var).
  // A SYSTEM service's environment is a safe, minimal base — no user profile
  // leakage — which is exactly what a child that only needs to reach the
  // network and read its own config directory should have.
  LPWCH envBlock = GetEnvironmentStringsW();
  std::wstring env;
  for (LPWCH p = envBlock; *p;) {
    size_t len = wcslen(p);
    env.append(p, len);
    env.push_back(L'\0');
    p += len + 1;
  }
  FreeEnvironmentStringsW(envBlock);
  if (!extraEnvVar.empty()) {
    env += extraEnvVar + L"=" + extraEnvVal;
    env.push_back(L'\0');
  }
  env.push_back(L'\0');

  ZeroMemory(&outPi, sizeof(outPi));
  BOOL ok = CreateProcessW(nullptr, cmdLine.data(), nullptr, nullptr, /*bInheritHandles=*/TRUE,
                            CREATE_NO_WINDOW | CREATE_UNICODE_ENVIRONMENT, (LPVOID)env.data(), workDir.c_str(), &si,
                            &outPi);
  CloseHandle(hLog);
  if (!ok) {
    wchar_t buf[256]{};
    FormatMessageW(FORMAT_MESSAGE_FROM_SYSTEM | FORMAT_MESSAGE_IGNORE_INSERTS, nullptr, GetLastError(), 0, buf, 256,
                    nullptr);
    err = L"CreateProcess(" + exePath + L") failed: " + buf;
    return false;
  }
  return true;
}

void StopTunnelInternal() {
  std::lock_guard<std::mutex> lock(g_procMutex);
  KillProcess(g_tun2socksProc);
  KillProcess(g_xrayProc);
  g_running = false;
  g_probeOk = false;
  g_connectedAtTick = 0;
}

// Minimal SOCKS5 client: CONNECT to a known host:80 through Xray's local
// SOCKS5 inbound, send a plain HTTP GET, confirm we get an HTTP response
// back. This is deliberately real traffic through the whole chain (this
// process -> 127.0.0.1:10808 -> Xray -> VLESS/REALITY -> VPN server ->
// internet), not just "is the port open" — same intent as Android's
// runRoutingValidation SOCKS5 probe (Rule 2).
bool ProbeThroughSocks5(int timeoutMs) {
  SOCKET s = socket(AF_INET, SOCK_STREAM, IPPROTO_TCP);
  if (s == INVALID_SOCKET) return false;

  u_long nonBlocking = 1;
  ioctlsocket(s, FIONBIO, &nonBlocking);

  sockaddr_in addr{};
  addr.sin_family = AF_INET;
  addr.sin_port = htons((u_short)kSocksPort);
  InetPtonA(AF_INET, "127.0.0.1", &addr.sin_addr);
  connect(s, (sockaddr*)&addr, sizeof(addr));

  fd_set writeSet;
  FD_ZERO(&writeSet);
  FD_SET(s, &writeSet);
  timeval tv{timeoutMs / 1000, (timeoutMs % 1000) * 1000};
  if (select(0, nullptr, &writeSet, nullptr, &tv) <= 0) {
    closesocket(s);
    return false;
  }

  u_long blocking = 0;
  ioctlsocket(s, FIONBIO, &blocking);

  DWORD to = timeoutMs;
  setsockopt(s, SOL_SOCKET, SO_RCVTIMEO, (const char*)&to, sizeof(to));
  setsockopt(s, SOL_SOCKET, SO_SNDTIMEO, (const char*)&to, sizeof(to));

  // SOCKS5 greeting: version 5, 1 auth method, "no auth".
  const char greeting[] = {0x05, 0x01, 0x00};
  if (send(s, greeting, sizeof(greeting), 0) != sizeof(greeting)) {
    closesocket(s);
    return false;
  }
  char greetReply[2];
  if (recv(s, greetReply, 2, 0) != 2 || greetReply[0] != 0x05 || greetReply[1] != 0x00) {
    closesocket(s);
    return false;
  }

  // CONNECT request, domain address type, example.com:80 — a stable, low-
  // weight target purely to prove the tunnel carries real traffic.
  const char host[] = "example.com";
  const unsigned char hostLen = (unsigned char)strlen(host);
  std::string req;
  req.push_back(0x05);
  req.push_back(0x01);  // CONNECT
  req.push_back(0x00);  // reserved
  req.push_back(0x03);  // ATYP = domain name
  req.push_back((char)hostLen);
  req.append(host, hostLen);
  req.push_back(0);
  req.push_back(80);  // port 80, big-endian
  if (send(s, req.data(), (int)req.size(), 0) != (int)req.size()) {
    closesocket(s);
    return false;
  }

  // Reply: VER REP RSV ATYP <addr> <port(2)> — read the fixed 4 bytes, then
  // the variable-length address based on ATYP, then the 2-byte port.
  unsigned char replyHead[4];
  if (recv(s, (char*)replyHead, 4, 0) != 4 || replyHead[1] != 0x00) {
    closesocket(s);
    return false;
  }
  int addrLen = 0;
  switch (replyHead[3]) {
    case 0x01: addrLen = 4; break;   // IPv4
    case 0x04: addrLen = 16; break;  // IPv6
    case 0x03: {                     // domain: 1 length byte + N
      unsigned char domLen;
      if (recv(s, (char*)&domLen, 1, 0) != 1) { closesocket(s); return false; }
      addrLen = domLen;
      break;
    }
    default: closesocket(s); return false;
  }
  std::vector<char> discard(addrLen + 2);  // + 2-byte port
  if (recv(s, discard.data(), (int)discard.size(), 0) != (int)discard.size()) {
    closesocket(s);
    return false;
  }

  // Real HTTP request/response over the now-established relay.
  const char httpReq[] = "GET / HTTP/1.0\r\nHost: example.com\r\nConnection: close\r\n\r\n";
  if (send(s, httpReq, (int)strlen(httpReq), 0) <= 0) {
    closesocket(s);
    return false;
  }
  char httpResp[16]{};
  int got = recv(s, httpResp, sizeof(httpResp) - 1, 0);
  closesocket(s);
  if (got <= 0) return false;
  return strncmp(httpResp, "HTTP/", 5) == 0;
}

bool StartTunnelInternal(const std::string& configJsonUtf8, bool /*emergency*/, std::wstring& err) {
  StopTunnelInternal();

  CreateDirectoryW(g_dataDir.c_str(), nullptr);
  std::wstring configPath = g_dataDir + L"\\xray.json";
  {
    HANDLE h = CreateFileW(configPath.c_str(), GENERIC_WRITE, 0, nullptr, CREATE_ALWAYS, FILE_ATTRIBUTE_NORMAL, nullptr);
    if (h == INVALID_HANDLE_VALUE) {
      err = L"cannot write xray.json to " + g_dataDir;
      return false;
    }
    DWORD written = 0;
    WriteFile(h, configJsonUtf8.data(), (DWORD)configJsonUtf8.size(), &written, nullptr);
    CloseHandle(h);
  }

  std::wstring xrayExe = g_binDir + L"\\xray.exe";
  std::wstring t2sExe = g_binDir + L"\\tun2socks.exe";
  std::wstring xrayLog = g_dataDir + L"\\xray.log";
  std::wstring t2sLog = g_dataDir + L"\\tun2socks.log";

  if (GetFileAttributesW(xrayExe.c_str()) == INVALID_FILE_ATTRIBUTES) {
    err = L"xray.exe missing at " + xrayExe;
    return false;
  }
  if (GetFileAttributesW(t2sExe.c_str()) == INVALID_FILE_ATTRIBUTES) {
    err = L"tun2socks.exe missing at " + t2sExe;
    return false;
  }

  // 1. Xray — `xray run -c <config>`, same shape as Android's
  //    ProcessBuilder(xrayBin, "run", "-c", configFile). XRAY_LOCATION_ASSET
  //    points at the binary dir in case geoip/geosite data ever gets bundled
  //    (not needed today — the generated config has no such rules, confirmed
  //    against mobile's asset bundle, which ships none either).
  if (!LaunchProcess(xrayExe, L"run -c \"" + configPath + L"\"", g_dataDir, xrayLog, L"XRAY_LOCATION_ASSET", g_binDir,
                      g_xrayProc, err)) {
    return false;
  }

  // Wait for Xray's local SOCKS5 inbound to actually open (up to ~10s,
  // matching Android's waitForPort(10808, 10_000L) budget) before starting
  // tun2socks against it.
  bool socksOpen = false;
  for (int i = 0; i < 40; ++i) {
    Sleep(250);
    if (!ProcessAlive(g_xrayProc)) {
      err = L"Xray exited immediately — see xray.log";
      StopTunnelInternal();
      return false;
    }
    SOCKET probe = socket(AF_INET, SOCK_STREAM, IPPROTO_TCP);
    sockaddr_in addr{};
    addr.sin_family = AF_INET;
    addr.sin_port = htons((u_short)kSocksPort);
    InetPtonA(AF_INET, "127.0.0.1", &addr.sin_addr);
    if (connect(probe, (sockaddr*)&addr, sizeof(addr)) == 0) socksOpen = true;
    closesocket(probe);
    if (socksOpen) break;
  }
  if (!socksOpen) {
    err = L"Xray SOCKS5 inbound (127.0.0.1:" + std::to_wstring(kSocksPort) + L") never opened";
    StopTunnelInternal();
    return false;
  }

  // 2. tun2socks — on Android this bridges a TUN fd VpnService.Builder
  //    already established; Windows has no such OS API, so tun2socks
  //    creates + owns the WinTun adapter itself via its built-in
  //    `wintun://<name>` device support and sets the default route through
  //    it. wintun.dll must sit next to tun2socks.exe (staged by the
  //    installer, same folder as xray.exe).
  std::wstring t2sArgs = L"--device wintun://RealGramTun --proxy socks5://127.0.0.1:" +
                          std::to_wstring(kSocksPort) + L" --loglevel info";
  if (!LaunchProcess(t2sExe, t2sArgs, g_binDir, t2sLog, L"", L"", g_tun2socksProc, err)) {
    StopTunnelInternal();
    return false;
  }

  Sleep(1500);  // let the WinTun adapter + default route come up
  if (!ProcessAlive(g_tun2socksProc)) {
    err = L"tun2socks exited immediately — see tun2socks.log (wintun.dll missing next to tun2socks.exe?)";
    StopTunnelInternal();
    return false;
  }

  bool probeOk = ProbeThroughSocks5(8000);
  {
    std::lock_guard<std::mutex> lock(g_procMutex);
    g_probeOk = probeOk;
    g_running = true;
    g_connectedAtTick = GetTickCount64();
  }
  if (!probeOk) {
    // Deliberately not a hard failure: tunnel is up, traffic just didn't
    // verify this round. Matches Android/iOS "fails open, surface
    // probeOk=false" behavior already documented in the app's task log —
    // vpnStore.ts's own 20s re-probe loop and failover ladder handle this
    // from here, unchanged.
    SetLastError(L"Tunnel is up but the internet probe did not succeed");
  } else {
    SetLastError(L"");
  }
  return true;
}

// ---- pipe server ----

void HandleConnection(HANDLE pipe) {
  unsigned char header[5];
  DWORD read = 0;
  if (!ReadFile(pipe, header, sizeof(header), &read, nullptr) || read != sizeof(header)) {
    CloseHandle(pipe);
    return;
  }
  Command cmd = static_cast<Command>(header[0]);
  uint32_t len = (uint32_t)header[1] | ((uint32_t)header[2] << 8) | ((uint32_t)header[3] << 16) |
                 ((uint32_t)header[4] << 24);
  std::string payload;
  if (len > 0 && len < 8 * 1024 * 1024) {  // sanity cap — configs are a few KB, never MB
    payload.resize(len);
    DWORD got = 0;
    if (!ReadFile(pipe, payload.data(), len, &got, nullptr) || got != len) {
      CloseHandle(pipe);
      return;
    }
  }

  ResponseStatus status = ResponseStatus::Ok;
  std::string response;

  switch (cmd) {
    case Command::Start:
    case Command::StartEmergency: {
      std::wstring err;
      if (!StartTunnelInternal(payload, cmd == Command::StartEmergency, err)) {
        status = ResponseStatus::Error;
        response = WideToUtf8(err);
        SetLastError(err);
      }
      break;
    }
    case Command::Stop:
      StopTunnelInternal();
      break;
    case Command::Status: {
      ULONGLONG connectedAt = g_connectedAtTick.load();
      ULONGLONG uptimeSec = connectedAt ? (GetTickCount64() - connectedAt) / 1000 : 0;
      std::wostringstream os;
      os << L"running=" << (g_running.load() ? 1 : 0) << L"\n"
         << L"probeOk=" << (g_probeOk.load() ? 1 : 0) << L"\n"
         << L"uptime=" << uptimeSec << L"\n"
         << L"error=" << GetLastErrorMsg() << L"\n";
      response = WideToUtf8(os.str());
      break;
    }
    case Command::GetXrayLog:
    case Command::GetTun2socksLog: {
      std::wstring path = g_dataDir + (cmd == Command::GetXrayLog ? L"\\xray.log" : L"\\tun2socks.log");
      std::ifstream f(path, std::ios::binary);
      if (f) {
        std::ostringstream ss;
        ss << f.rdbuf();
        response = ss.str();
        constexpr size_t kTail = 8000;
        if (response.size() > kTail) response = response.substr(response.size() - kTail);
      } else {
        response = "(no log yet)";
      }
      break;
    }
    case Command::GetGeneratedConfig: {
      std::wstring path = g_dataDir + L"\\xray.json";
      std::ifstream f(path, std::ios::binary);
      if (f) {
        std::ostringstream ss;
        ss << f.rdbuf();
        response = ss.str();
      } else {
        response = "(not available)";
      }
      break;
    }
    default:
      status = ResponseStatus::Error;
      response = "unknown command";
  }

  unsigned char outHeader[5];
  outHeader[0] = static_cast<unsigned char>(status);
  uint32_t rlen = (uint32_t)response.size();
  outHeader[1] = (unsigned char)(rlen & 0xFF);
  outHeader[2] = (unsigned char)((rlen >> 8) & 0xFF);
  outHeader[3] = (unsigned char)((rlen >> 16) & 0xFF);
  outHeader[4] = (unsigned char)((rlen >> 24) & 0xFF);
  DWORD written = 0;
  WriteFile(pipe, outHeader, sizeof(outHeader), &written, nullptr);
  if (rlen) WriteFile(pipe, response.data(), rlen, &written, nullptr);
  FlushFileBuffers(pipe);
  DisconnectNamedPipe(pipe);
  CloseHandle(pipe);
}

DWORD WINAPI ConnectionThread(LPVOID param) {
  HandleConnection((HANDLE)param);
  return 0;
}

DWORD WINAPI PipeServerThread(LPVOID) {
  // A SYSTEM process's default pipe DACL does not include regular
  // interactive users — grant Authenticated Users read/write explicitly so
  // the unelevated RealGram.exe (running in the logged-in user's session)
  // can actually reach this pipe.
  PSECURITY_DESCRIPTOR sd = nullptr;
  ConvertStringSecurityDescriptorToSecurityDescriptorW(L"D:(A;;GA;;;AU)", SDDL_REVISION_1, &sd, nullptr);
  SECURITY_ATTRIBUTES sa{sizeof(sa), sd, FALSE};

  while (WaitForSingleObject(g_stopEvent, 0) != WAIT_OBJECT_0) {
    HANDLE pipe = CreateNamedPipeW(kPipeName, PIPE_ACCESS_DUPLEX | FILE_FLAG_OVERLAPPED,
                                    PIPE_TYPE_BYTE | PIPE_READMODE_BYTE | PIPE_WAIT, PIPE_UNLIMITED_INSTANCES,
                                    64 * 1024, 64 * 1024, 0, &sa);
    if (pipe == INVALID_HANDLE_VALUE) {
      Sleep(1000);
      continue;
    }

    OVERLAPPED ov{};
    ov.hEvent = CreateEventW(nullptr, TRUE, FALSE, nullptr);
    bool connected = ConnectNamedPipe(pipe, &ov) != 0;
    if (!connected && GetLastError() == ERROR_IO_PENDING) {
      HANDLE waitHandles[2] = {ov.hEvent, g_stopEvent};
      DWORD w = WaitForMultipleObjects(2, waitHandles, FALSE, INFINITE);
      connected = (w == WAIT_OBJECT_0);
      if (w == WAIT_OBJECT_0 + 1) {  // stop requested
        CancelIoEx(pipe, &ov);
        CloseHandle(ov.hEvent);
        CloseHandle(pipe);
        break;
      }
    } else if (!connected && GetLastError() == ERROR_PIPE_CONNECTED) {
      connected = true;
    }
    CloseHandle(ov.hEvent);

    if (!connected) {
      CloseHandle(pipe);
      continue;
    }

    // Handle each connection on its own thread — control-plane traffic is
    // low frequency (a few calls/second from JS-side polling at most), no
    // thread pool needed for this.
    HANDLE h = CreateThread(nullptr, 0, ConnectionThread, pipe, 0, nullptr);
    if (h) CloseHandle(h);
  }
  if (sd) LocalFree(sd);
  return 0;
}

void UpdateStatus(DWORD state, DWORD exitCode = 0, DWORD waitHint = 0) {
  g_status.dwCurrentState = state;
  g_status.dwWin32ExitCode = exitCode;
  g_status.dwWaitHint = waitHint;
  SetServiceStatus(g_statusHandle, &g_status);
}

DWORD WINAPI ServiceCtrlHandlerEx(DWORD control, DWORD, LPVOID, LPVOID) {
  if (control == SERVICE_CONTROL_STOP || control == SERVICE_CONTROL_SHUTDOWN) {
    UpdateStatus(SERVICE_STOP_PENDING, 0, 3000);
    SetEvent(g_stopEvent);
    StopTunnelInternal();
    return NO_ERROR;
  }
  return NO_ERROR;
}

void WINAPI ServiceMain(DWORD, LPWSTR*) {
  g_statusHandle = RegisterServiceCtrlHandlerExW(kServiceName, ServiceCtrlHandlerEx, nullptr);
  if (!g_statusHandle) return;

  g_status.dwServiceType = SERVICE_WIN32_OWN_PROCESS;
  g_status.dwControlsAccepted = SERVICE_ACCEPT_STOP | SERVICE_ACCEPT_SHUTDOWN;
  UpdateStatus(SERVICE_START_PENDING, 0, 3000);

  WSADATA wsaData;
  WSAStartup(MAKEWORD(2, 2), &wsaData);

  g_binDir = GetModuleDir();
  g_dataDir = L"C:\\ProgramData\\RealGram";
  CreateDirectoryW(g_dataDir.c_str(), nullptr);

  g_stopEvent = CreateEventW(nullptr, TRUE, FALSE, nullptr);

  UpdateStatus(SERVICE_RUNNING);

  HANDLE pipeThread = CreateThread(nullptr, 0, PipeServerThread, nullptr, 0, nullptr);
  WaitForSingleObject(g_stopEvent, INFINITE);
  if (pipeThread) {
    WaitForSingleObject(pipeThread, 5000);
    CloseHandle(pipeThread);
  }

  WSACleanup();
  UpdateStatus(SERVICE_STOPPED);
}

}  // namespace

int wmain() {
  SERVICE_TABLE_ENTRYW table[] = {{const_cast<LPWSTR>(kServiceName), ServiceMain}, {nullptr, nullptr}};
  StartServiceCtrlDispatcherW(table);
  return 0;
}
