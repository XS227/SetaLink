package com.setalink.modules

import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.turbomodule.core.interfaces.TurboModule

/**
 * Codegen-style abstract base that mirrors NativeXrayModule.ts spec.
 * In a full codegen setup this file would be auto-generated from the TS spec.
 */
abstract class NativeXrayModuleSpec(context: ReactApplicationContext) :
    com.facebook.react.bridge.ReactContextBaseJavaModule(context), TurboModule {

    abstract fun start(config: String, promise: Promise)
    abstract fun stop(promise: Promise)
    abstract fun isRunning(promise: Promise)
    abstract fun getStats(promise: Promise)
    abstract fun validateConfig(config: String, promise: Promise)
}
