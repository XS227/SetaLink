// ObjC bridge — exposes the Swift DmNotificationModule to the JS runtime.
// Mirrors the Android DmNotification module (notifyMessage/areNotificationsEnabled/
// consumeInitialRoute) so services/dmNotifications.ts works cross-platform.
#import <React/RCTBridgeModule.h>

@interface RCT_EXTERN_MODULE(DmNotification, NSObject)

RCT_EXTERN_METHOD(notifyMessage:(NSString *)title
                  body:(NSString *)body
                  id:(double)id
                  route:(NSString *)route
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(areNotificationsEnabled:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(consumeInitialRoute:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

+ (BOOL)requiresMainQueueSetup { return NO; }

@end
