package com.setalink.modules

import android.util.Log
import androidx.biometric.BiometricManager
import androidx.biometric.BiometricPrompt
import androidx.core.content.ContextCompat
import androidx.fragment.app.FragmentActivity
import com.facebook.react.bridge.*

class BiometricModule(private val reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    companion object {
        const val NAME = "BiometricModule"
        private const val TAG = "BiometricModule"
    }

    override fun getName(): String = NAME

    @ReactMethod
    fun isAvailable(promise: Promise) {
        try {
            val bm = BiometricManager.from(reactContext)
            val result = bm.canAuthenticate(
                BiometricManager.Authenticators.BIOMETRIC_STRONG or
                BiometricManager.Authenticators.BIOMETRIC_WEAK
            )
            promise.resolve(result == BiometricManager.BIOMETRIC_SUCCESS)
        } catch (e: Exception) {
            promise.resolve(false)
        }
    }

    @ReactMethod
    fun authenticate(title: String, subtitle: String, promise: Promise) {
        val activity = reactContext.currentActivity
        if (activity == null || activity !is FragmentActivity) {
            promise.reject("NO_ACTIVITY", "No FragmentActivity available for biometric prompt")
            return
        }

        activity.runOnUiThread {
            try {
                val executor = ContextCompat.getMainExecutor(reactContext)
                val callback = object : BiometricPrompt.AuthenticationCallback() {
                    override fun onAuthenticationSucceeded(result: BiometricPrompt.AuthenticationResult) {
                        Log.i(TAG, "Biometric authentication succeeded")
                        promise.resolve(true)
                    }
                    override fun onAuthenticationError(errorCode: Int, errString: CharSequence) {
                        Log.w(TAG, "Biometric error $errorCode: $errString")
                        if (errorCode == BiometricPrompt.ERROR_NEGATIVE_BUTTON ||
                            errorCode == BiometricPrompt.ERROR_USER_CANCELED) {
                            promise.reject("USER_CANCELED", "Authentication cancelled by user")
                        } else {
                            promise.reject("AUTH_ERROR", errString.toString())
                        }
                    }
                    override fun onAuthenticationFailed() {
                        Log.d(TAG, "Biometric authentication failed (retry)")
                        // Don't reject — let user retry (prompt stays open)
                    }
                }

                val prompt = BiometricPrompt(activity as FragmentActivity, executor, callback)
                val info = BiometricPrompt.PromptInfo.Builder()
                    .setTitle(title)
                    .setSubtitle(subtitle)
                    .setNegativeButtonText("Cancel")
                    .setAllowedAuthenticators(
                        BiometricManager.Authenticators.BIOMETRIC_STRONG or
                        BiometricManager.Authenticators.BIOMETRIC_WEAK
                    )
                    .build()

                prompt.authenticate(info)
            } catch (e: Exception) {
                Log.e(TAG, "BiometricPrompt error: ${e.message}", e)
                promise.reject("PROMPT_ERROR", e.message ?: "Biometric prompt failed")
            }
        }
    }
}
