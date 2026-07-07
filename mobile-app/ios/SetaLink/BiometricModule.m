// ObjC bridge — exposes the Swift BiometricModule to the JS runtime.
#import <React/RCTBridgeModule.h>

@interface RCT_EXTERN_MODULE(BiometricModule, NSObject)

RCT_EXTERN_METHOD(isAvailable:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(getStatus:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(getStatusDetail:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(authenticate:(NSString *)title subtitle:(NSString *)subtitle resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject)

+ (BOOL)requiresMainQueueSetup { return NO; }

@end
