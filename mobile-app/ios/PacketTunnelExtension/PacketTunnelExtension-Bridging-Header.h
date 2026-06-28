// Bridging header for PacketTunnelExtension.
// Imports C headers guarded by __has_include so local dev builds compile
// even when the xcframeworks have not been built yet.

#if __has_include(<LibXray/LibXray.h>)
#import <LibXray/LibXray.h>
#endif

#if __has_include(<HevSocks5Tunnel/hev-main.h>)
#import <HevSocks5Tunnel/hev-main.h>
#endif
