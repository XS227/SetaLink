#include "pch.h"

#include "App.h"

#include "AutolinkedNativeModules.g.h"
#include "ReactPackageProvider.h"

#include <string>

using namespace winrt;
using namespace xaml;
using namespace xaml::Controls;
using namespace xaml::Navigation;

using namespace Windows::ApplicationModel;
namespace winrt::SetaLink::implementation
{
namespace
{
/// <summary>
/// Absolute path of the "Bundle" folder sitting next to the running exe.
///
/// RealGram for Windows ships UNPACKAGED — a loose setalink.exe installed by
/// Inno Setup, with no MSIX package identity (see release-windows.yml and
/// installer/RealGram.iss for why the .msix path was dropped). ReactInstanceWin
/// defaults BundleRootPath to "ms-appx:///Bundle/", and that URI scheme only
/// resolves for a *packaged* app: with no identity the JS bundle load throws
/// and the process dies the instant after the XAML window appears (Khabat,
/// 2026-08-24 field test: "et slags vindu et millisekund så forsvant").
///
/// LocalBundleReader::LoadBundleAsync treats any root that isn't "ms-app..."
/// or "resource://" as a plain filesystem path (GetFileFromPathAsync), so
/// pointing it at our own install directory works whether or not the app is
/// packaged. Returns an empty string if the module path can't be read, which
/// leaves BundleRootPath at its default rather than setting a bogus one.
/// </summary>
winrt::hstring GetLocalBundleRootPath() noexcept
{
    std::wstring modulePath(MAX_PATH, L'\0');
    for (;;)
    {
        const DWORD length = ::GetModuleFileNameW(nullptr, modulePath.data(), static_cast<DWORD>(modulePath.size()));
        if (length == 0)
        {
            return {}; // Can't locate ourselves — fall back to the default.
        }
        if (length < modulePath.size())
        {
            modulePath.resize(length);
            break;
        }
        // Truncated (ERROR_INSUFFICIENT_BUFFER): retry with a bigger buffer.
        modulePath.resize(modulePath.size() * 2);
    }

    const auto lastSeparator = modulePath.find_last_of(L"\\/");
    if (lastSeparator == std::wstring::npos)
    {
        return {};
    }
    modulePath.resize(lastSeparator + 1);

    // hstring constructs straight from a wide string; winrt::to_hstring has no
    // std::wstring overload (its string_view overload expects UTF-8).
    return winrt::hstring{modulePath + L"Bundle"};
}
} // namespace

/// <summary>
/// Initializes the singleton application object.  This is the first line of
/// authored code executed, and as such is the logical equivalent of main() or
/// WinMain().
/// </summary>
App::App() noexcept
{
#if BUNDLE
    JavaScriptBundleFile(L"index.windows");
    InstanceSettings().UseFastRefresh(false);
    // Load index.windows.bundle from our own install folder, not ms-appx:///
    // — see GetLocalBundleRootPath above. Without this the app can never find
    // its JavaScript once installed, no matter what the installer ships.
    if (const auto bundleRootPath = GetLocalBundleRootPath(); !bundleRootPath.empty())
    {
        InstanceSettings().BundleRootPath(bundleRootPath);
    }
#else
    JavaScriptBundleFile(L"index");
    InstanceSettings().UseFastRefresh(true);
#endif

#if _DEBUG
    InstanceSettings().UseDirectDebugger(true);
    InstanceSettings().UseDeveloperSupport(true);
#else
    InstanceSettings().UseDirectDebugger(false);
    InstanceSettings().UseDeveloperSupport(false);
#endif

    RegisterAutolinkedNativeModulePackages(PackageProviders()); // Includes any autolinked modules

    PackageProviders().Append(make<ReactPackageProvider>()); // Includes all modules in this project

    InitializeComponent();
}

/// <summary>
/// Invoked when the application is launched normally by the end user.  Other entry points
/// will be used such as when the application is launched to open a specific file.
/// </summary>
/// <param name="e">Details about the launch request and process.</param>
void App::OnLaunched(activation::LaunchActivatedEventArgs const& e)
{
    super::OnLaunched(e);

    Frame rootFrame = Window::Current().Content().as<Frame>();
    rootFrame.Navigate(xaml_typename<MainPage>(), box_value(e.Arguments()));
}

/// <summary>
/// Invoked when the application is activated by some means other than normal launching.
/// </summary>
void App::OnActivated(Activation::IActivatedEventArgs const &e) {
  auto preActivationContent = Window::Current().Content();
  super::OnActivated(e);
  if (!preActivationContent && Window::Current()) {
    Frame rootFrame = Window::Current().Content().as<Frame>();
    rootFrame.Navigate(xaml_typename<MainPage>(), nullptr);
  }
}

/// <summary>
/// Invoked when application execution is being suspended.  Application state is saved
/// without knowing whether the application will be terminated or resumed with the contents
/// of memory still intact.
/// </summary>
/// <param name="sender">The source of the suspend request.</param>
/// <param name="e">Details about the suspend request.</param>
void App::OnSuspending([[maybe_unused]] IInspectable const& sender, [[maybe_unused]] SuspendingEventArgs const& e)
{
    // Save application state and stop any background activity
}

/// <summary>
/// Invoked when Navigation to a certain page fails
/// </summary>
/// <param name="sender">The Frame which failed navigation</param>
/// <param name="e">Details about the navigation failure</param>
void App::OnNavigationFailed(IInspectable const&, NavigationFailedEventArgs const& e)
{
    throw hresult_error(E_FAIL, hstring(L"Failed to load Page ") + e.SourcePageType().Name);
}

} // namespace winrt::SetaLink::implementation
