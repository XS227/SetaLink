package com.setalink.modules

import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule

abstract class NativeXrayModuleSpec(context: ReactApplicationContext) :
    ReactContextBaseJavaModule(context) {

    abstract fun start(config: String, promise: Promise)
    abstract fun stop(promise: Promise)
    abstract fun isRunning(promise: Promise)
    abstract fun getStats(promise: Promise)
    abstract fun validateConfig(config: String, promise: Promise)
    abstract fun getLastError(promise: Promise)
    abstract fun getConnectionLog(promise: Promise)
}
