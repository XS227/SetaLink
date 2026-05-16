// ObjC bridge file — required for Swift modules in React Native
// Exposes XrayModule to the JS runtime via RCT_EXTERN_MODULE.

#import <React/RCTBridgeModule.h>

RCT_EXTERN_MODULE(XrayModule, NSObject)

RCT_EXTERN_METHOD(start:(NSString *)config resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(stop:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(isRunning:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(getStats:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(validateConfig:(NSString *)config resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject)
