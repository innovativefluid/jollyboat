// jollyboat-audio: one app's sound for a screen share on Windows (10 2004 / build 19041 and newer).
//
//   jollyboat-audio sessions      the apps playing sound right now, one JSON object per line:
//                                 {"pid":1234,"exe":"spotify.exe","name":"Spotify"}
//   jollyboat-audio capture <pid> that process's sound (and its child processes'), as raw PCM on
//                                 stdout: 48 kHz, stereo, signed 16-bit little endian, until stdin
//                                 closes or stdout is gone
//   jollyboat-audio version
//
// The capture is WASAPI process loopback (AUDIOCLIENT_ACTIVATION_TYPE_PROCESS_LOOPBACK), as in
// Microsoft's ApplicationLoopback sample (Windows-classic-samples, MIT). Exit codes: 0 done,
// 2 bad arguments, 3 no audio device / sessions unavailable, 4 activation failed, 5 capture failed.

#define WIN32_LEAN_AND_MEAN
#define NOMINMAX
#include <windows.h>
#include <initguid.h>
#include <mmdeviceapi.h>
#include <audioclient.h>
#include <audiopolicy.h>
#include <fcntl.h>
#include <io.h>
#include <atomic>
#include <cstdio>
#include <cstdlib>
#include <cwchar>
#include <string>
#include <vector>

#if __has_include(<audioclientactivationparams.h>)
#include <audioclientactivationparams.h>
#else
// (older sdks and mingw: the few declarations process loopback needs)
typedef enum AUDIOCLIENT_ACTIVATION_TYPE {
  AUDIOCLIENT_ACTIVATION_TYPE_DEFAULT = 0,
  AUDIOCLIENT_ACTIVATION_TYPE_PROCESS_LOOPBACK = 1
} AUDIOCLIENT_ACTIVATION_TYPE;
typedef enum PROCESS_LOOPBACK_MODE {
  PROCESS_LOOPBACK_MODE_INCLUDE_TARGET_PROCESS_TREE = 0,
  PROCESS_LOOPBACK_MODE_EXCLUDE_TARGET_PROCESS_TREE = 1
} PROCESS_LOOPBACK_MODE;
typedef struct AUDIOCLIENT_PROCESS_LOOPBACK_PARAMS {
  DWORD TargetProcessId;
  PROCESS_LOOPBACK_MODE ProcessLoopbackMode;
} AUDIOCLIENT_PROCESS_LOOPBACK_PARAMS;
typedef struct AUDIOCLIENT_ACTIVATION_PARAMS {
  AUDIOCLIENT_ACTIVATION_TYPE ActivationType;
  union {
    AUDIOCLIENT_PROCESS_LOOPBACK_PARAMS ProcessLoopbackParams;
  };
} AUDIOCLIENT_ACTIVATION_PARAMS;
#define VIRTUAL_AUDIO_DEVICE_PROCESS_LOOPBACK L"VAD\\Process_Loopback"
#endif

static const int RATE = 48000;
static const int CHANNELS = 2;
static const int BITS = 16;

// --- sessions -----------------------------------------------------------------------------

static std::string utf8(const std::wstring &w) {
  if (w.empty()) return {};
  int n = WideCharToMultiByte(CP_UTF8, 0, w.data(), (int)w.size(), nullptr, 0, nullptr, nullptr);
  std::string s(n, '\0');
  WideCharToMultiByte(CP_UTF8, 0, w.data(), (int)w.size(), s.data(), n, nullptr, nullptr);
  return s;
}

static std::string json(const std::string &s) {
  std::string out = "\"";
  for (unsigned char c : s) {
    if (c == '"' || c == '\\') out += '\\', out += (char)c;
    else if (c < 0x20) {
      char buf[8];
      snprintf(buf, sizeof buf, "\\u%04x", c);
      out += buf;
    } else out += (char)c;
  }
  return out + "\"";
}

static std::wstring exeOf(DWORD pid) {
  std::wstring out;
  HANDLE h = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, FALSE, pid);
  if (!h) return out;
  wchar_t path[MAX_PATH * 2];
  DWORD len = (DWORD)(sizeof path / sizeof path[0]);
  if (QueryFullProcessImageNameW(h, 0, path, &len)) {
    out.assign(path, len);
    size_t slash = out.find_last_of(L"\\/");
    if (slash != std::wstring::npos) out = out.substr(slash + 1);
  }
  CloseHandle(h);
  return out;
}

static int listSessions() {
  IMMDeviceEnumerator *devices = nullptr;
  if (FAILED(CoCreateInstance(__uuidof(MMDeviceEnumerator), nullptr, CLSCTX_ALL, __uuidof(IMMDeviceEnumerator), (void **)&devices))) return 3;
  IMMDeviceCollection *endpoints = nullptr;
  if (FAILED(devices->EnumAudioEndpoints(eRender, DEVICE_STATE_ACTIVE, &endpoints))) {
    devices->Release();
    return 3;
  }
  UINT count = 0;
  endpoints->GetCount(&count);
  std::vector<DWORD> seen;
  for (UINT i = 0; i < count; i++) {
    IMMDevice *device = nullptr;
    if (FAILED(endpoints->Item(i, &device))) continue;
    IAudioSessionManager2 *manager = nullptr;
    if (SUCCEEDED(device->Activate(__uuidof(IAudioSessionManager2), CLSCTX_ALL, nullptr, (void **)&manager))) {
      IAudioSessionEnumerator *sessions = nullptr;
      if (SUCCEEDED(manager->GetSessionEnumerator(&sessions))) {
        int n = 0;
        sessions->GetCount(&n);
        for (int k = 0; k < n; k++) {
          IAudioSessionControl *control = nullptr;
          if (FAILED(sessions->GetSession(k, &control))) continue;
          IAudioSessionControl2 *control2 = nullptr;
          if (SUCCEEDED(control->QueryInterface(__uuidof(IAudioSessionControl2), (void **)&control2))) {
            DWORD pid = 0;
            AudioSessionState state = AudioSessionStateInactive;
            control2->GetProcessId(&pid);
            control2->GetState(&state);
            bool system = control2->IsSystemSoundsSession() == S_OK;
            bool known = false;
            for (DWORD s : seen) known = known || s == pid;
            // playing now (or paused a moment ago: inactive sessions of a running app count too,
            // as long as the process is there); not the system sounds, not twice
            if (pid && !system && !known && state != AudioSessionStateExpired) {
              std::wstring exe = exeOf(pid);
              if (!exe.empty()) {
                seen.push_back(pid);
                LPWSTR display = nullptr;
                std::wstring name;
                if (SUCCEEDED(control2->GetDisplayName(&display)) && display) {
                  // a resource reference ("@%SystemRoot%\...") is no name
                  if (display[0] && display[0] != L'@') name = display;
                  CoTaskMemFree(display);
                }
                printf("{\"pid\":%lu,\"exe\":%s,\"name\":%s,\"active\":%s}\n", (unsigned long)pid, json(utf8(exe)).c_str(), json(utf8(name)).c_str(),
                       state == AudioSessionStateActive ? "true" : "false");
              }
            }
            control2->Release();
          }
          control->Release();
        }
        sessions->Release();
      }
      manager->Release();
    }
    device->Release();
  }
  endpoints->Release();
  devices->Release();
  fflush(stdout);
  return 0;
}

// --- capture ------------------------------------------------------------------------------

// the completion of ActivateAudioInterfaceAsync: an agile COM object that signals an event
class Activation : public IActivateAudioInterfaceCompletionHandler, public IAgileObject {
 public:
  HANDLE done = CreateEventW(nullptr, TRUE, FALSE, nullptr);
  HRESULT result = E_FAIL;
  IAudioClient *client = nullptr;
  virtual ~Activation() { CloseHandle(done); }

  STDMETHODIMP QueryInterface(REFIID riid, void **out) override {
    if (riid == __uuidof(IUnknown) || riid == __uuidof(IActivateAudioInterfaceCompletionHandler)) {
      *out = static_cast<IActivateAudioInterfaceCompletionHandler *>(this);
    } else if (riid == __uuidof(IAgileObject)) {
      *out = static_cast<IAgileObject *>(this);
    } else {
      *out = nullptr;
      return E_NOINTERFACE;
    }
    AddRef();
    return S_OK;
  }
  STDMETHODIMP_(ULONG) AddRef() override { return ++refs; }
  STDMETHODIMP_(ULONG) Release() override {
    ULONG n = --refs;
    if (!n) delete this;
    return n;
  }
  STDMETHODIMP ActivateCompleted(IActivateAudioInterfaceAsyncOperation *operation) override {
    HRESULT activated = E_FAIL;
    IUnknown *unknown = nullptr;
    result = operation->GetActivateResult(&activated, &unknown);
    if (SUCCEEDED(result)) result = activated;
    if (SUCCEEDED(result) && unknown) result = unknown->QueryInterface(__uuidof(IAudioClient), (void **)&client);
    if (unknown) unknown->Release();
    SetEvent(done);
    return S_OK;
  }

 private:
  std::atomic<ULONG> refs{1};
};

static std::atomic<bool> stopping{false};

// stdin closing (the app let go of us) ends the capture
static DWORD WINAPI watchStdin(LPVOID) {
  char buf[64];
  while (fread(buf, 1, sizeof buf, stdin) > 0) {
  }
  stopping = true;
  return 0;
}

static int capture(DWORD pid) {
  AUDIOCLIENT_ACTIVATION_PARAMS params = {};
  params.ActivationType = AUDIOCLIENT_ACTIVATION_TYPE_PROCESS_LOOPBACK;
  params.ProcessLoopbackParams.TargetProcessId = pid;
  params.ProcessLoopbackParams.ProcessLoopbackMode = PROCESS_LOOPBACK_MODE_INCLUDE_TARGET_PROCESS_TREE;

  PROPVARIANT prop = {};
  prop.vt = VT_BLOB;
  prop.blob.cbSize = sizeof params;
  prop.blob.pBlobData = (BYTE *)&params;

  Activation *activation = new Activation();
  IActivateAudioInterfaceAsyncOperation *operation = nullptr;
  HRESULT hr = ActivateAudioInterfaceAsync(VIRTUAL_AUDIO_DEVICE_PROCESS_LOOPBACK, __uuidof(IAudioClient), &prop, activation, &operation);
  if (FAILED(hr)) {
    fprintf(stderr, "activate: 0x%08lx\n", (unsigned long)hr);
    activation->Release();
    return 4;
  }
  WaitForSingleObject(activation->done, 10000);
  if (operation) operation->Release();
  IAudioClient *client = activation->client;
  hr = activation->result;
  activation->client = nullptr;
  activation->Release();
  if (FAILED(hr) || !client) {
    fprintf(stderr, "activation result: 0x%08lx\n", (unsigned long)hr);
    return 4;
  }

  WAVEFORMATEX format = {};
  format.wFormatTag = WAVE_FORMAT_PCM;
  format.nChannels = CHANNELS;
  format.nSamplesPerSec = RATE;
  format.wBitsPerSample = BITS;
  format.nBlockAlign = (WORD)(CHANNELS * BITS / 8);
  format.nAvgBytesPerSec = RATE * format.nBlockAlign;

  // 20 ms of buffer; the event says when a packet is there
  hr = client->Initialize(AUDCLNT_SHAREMODE_SHARED, AUDCLNT_STREAMFLAGS_LOOPBACK | AUDCLNT_STREAMFLAGS_EVENTCALLBACK, 200000, 0, &format, nullptr);
  if (FAILED(hr)) {
    fprintf(stderr, "initialize: 0x%08lx\n", (unsigned long)hr);
    client->Release();
    return 5;
  }
  HANDLE ready = CreateEventW(nullptr, FALSE, FALSE, nullptr);
  IAudioCaptureClient *capture = nullptr;
  if (FAILED(client->SetEventHandle(ready)) || FAILED(client->GetService(__uuidof(IAudioCaptureClient), (void **)&capture)) || FAILED(client->Start())) {
    fprintf(stderr, "start failed\n");
    if (capture) capture->Release();
    client->Release();
    return 5;
  }

  CreateThread(nullptr, 0, watchStdin, nullptr, 0, nullptr);
  std::vector<BYTE> silence;
  int code = 0;
  while (!stopping) {
    // a quiet app delivers no packets: the wait times out and the loop just looks again
    WaitForSingleObject(ready, 100);
    UINT32 packet = 0;
    while (!stopping && SUCCEEDED(capture->GetNextPacketSize(&packet)) && packet > 0) {
      BYTE *data = nullptr;
      UINT32 frames = 0;
      DWORD flags = 0;
      if (FAILED(capture->GetBuffer(&data, &frames, &flags, nullptr, nullptr))) {
        code = 5;
        stopping = true;
        break;
      }
      size_t bytes = (size_t)frames * format.nBlockAlign;
      const BYTE *out = data;
      if (flags & AUDCLNT_BUFFERFLAGS_SILENT) {
        silence.assign(bytes, 0);
        out = silence.data();
      }
      bool written = fwrite(out, 1, bytes, stdout) == bytes;
      capture->ReleaseBuffer(frames);
      if (!written) {
        stopping = true;
        break;
      }
    }
    fflush(stdout);
  }

  client->Stop();
  capture->Release();
  client->Release();
  CloseHandle(ready);
  return code;
}

int wmain(int argc, wchar_t **argv) {
  if (argc < 2) return 2;
  std::wstring cmd = argv[1];
  if (cmd == L"version") {
    printf("jollyboat-audio 1\n");
    return 0;
  }
  // stdout carries pcm: no newline translation
  _setmode(_fileno(stdout), _O_BINARY);
  if (FAILED(CoInitializeEx(nullptr, COINIT_MULTITHREADED))) return 3;
  int code = 2;
  if (cmd == L"sessions") code = listSessions();
  else if (cmd == L"capture" && argc >= 3) {
    DWORD pid = (DWORD)wcstoul(argv[2], nullptr, 10);
    code = pid ? capture(pid) : 2;
  }
  CoUninitialize();
  return code;
}
