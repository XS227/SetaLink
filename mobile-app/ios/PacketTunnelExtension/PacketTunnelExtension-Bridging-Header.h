// Bridging header for PacketTunnelExtension.
// Imports the LibXray ObjC interface when the xcframework is present.
// The #if __has_include guard means the extension still compiles when
// LibXray.xcframework has not yet been built (local dev / LIBXRAY_AVAILABLE not set).

#if __has_include(<LibXray/LibXray.h>)
#import <LibXray/LibXray.h>
#endif
