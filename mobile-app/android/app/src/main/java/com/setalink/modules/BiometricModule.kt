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

    // androidx.biometric 1.1.0 returns BIOMETRIC_STATUS_UNKNOWN for a combined
    // STRONG|WEAK query on some Android 10 / OEM builds even with a fingerprint
    // enrolled. Query each class separately so a usable authenticator is detected
    // (v0.9.35 #5).
    private fun bestStatus(): Int {
        val bm = BiometricManager.from(reactContext)
        val strong = bm.canAuthenticate(BiometricManager.Authenticators.BIOMETRIC_STRONG)
        val weak   = bm.canAuthenticate(BiometricManager.Authenticators.BIOMETRIC_WEAK)
        val cred   = bm.canAuthenticate(BiometricManager.Authenticators.DEVICE_CREDENTIAL)
        // Available if ANY usable authenticator exists — fingerprint, face, OR the
        // device PIN/pattern/password (device-credential fallback, v0.9.36 #3).
        return if (strong == BiometricManager.BIOMETRIC_SUCCESS ||
                   weak   == BiometricManager.BIOMETRIC_SUCCESS ||
                   cred   == BiometricManager.BIOMETRIC_SUCCESS)
            BiometricManager.BIOMETRIC_SUCCESS
        // Prefer the most informative of the non-success codes.
        else if (weak != BiometricManager.BIOMETRIC_STATUS_UNKNOWN) weak
        else if (strong != BiometricManager.BIOMETRIC_STATUS_UNKNOWN) strong
        else cred
    }

    @ReactMethod
    fun isAvailable(promise: Promise) {
        try {
            promise.resolve(bestStatus() == BiometricManager.BIOMETRIC_SUCCESS)
        } catch (e: Exception) {
            promise.resolve(false)
        }
    }

    /** Raw diagnostic — the exact canAuthenticate() code for each authenticator
     *  class plus the SDK level, so the in-app debug panel can show precisely what
     *  this device reports (v0.9.36 #3). Codes: 0=SUCCESS, 1=HW_UNAVAILABLE,
     *  11=NONE_ENROLLED, 12=NO_HARDWARE, 15=SECURITY_UPDATE_REQUIRED, -1=UNKNOWN,
     *  -2=UNSUPPORTED. */
    @ReactMethod
    fun getStatusDetail(promise: Promise) {
        val map = Arguments.createMap()
        try {
            val bm = BiometricManager.from(reactContext)
            map.putInt("strong", bm.canAuthenticate(BiometricManager.Authenticators.BIOMETRIC_STRONG))
            map.putInt("weak",   bm.canAuthenticate(BiometricManager.Authenticators.BIOMETRIC_WEAK))
            map.putInt("deviceCredential", bm.canAuthenticate(BiometricManager.Authenticators.DEVICE_CREDENTIAL))
            map.putInt("sdkInt", android.os.Build.VERSION.SDK_INT)
            map.putBoolean("available", bestStatus() == BiometricManager.BIOMETRIC_SUCCESS)
        } catch (e: Exception) {
            map.putString("error", e.message ?: "unknown")
        }
        promise.resolve(map)
    }

    /** Detailed status string so the UI can show the right guidance
     *  (enroll a fingerprint vs. no hardware). */
    @ReactMethod
    fun getStatus(promise: Promise) {
        try {
            val status = when (bestStatus()) {
                BiometricManager.BIOMETRIC_SUCCESS                         -> "available"
                BiometricManager.BIOMETRIC_ERROR_NONE_ENROLLED            -> "none_enrolled"
                BiometricManager.BIOMETRIC_ERROR_NO_HARDWARE              -> "no_hardware"
                BiometricManager.BIOMETRIC_ERROR_HW_UNAVAILABLE          -> "hw_unavailable"
                BiometricManager.BIOMETRIC_ERROR_SECURITY_UPDATE_REQUIRED -> "update_required"
                else                                                      -> "unknown"
            }
            promise.resolve(status)
        } catch (e: Exception) {
            promise.resolve("unknown")
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
                // Choose authenticators that actually exist on this device. Using
                // BIOMETRIC_WEAK|DEVICE_CREDENTIAL crashes pre-API30, so fall back to
                // DEVICE_CREDENTIAL alone (PIN/pattern) when no biometric is enrolled
                // (v0.9.36 #3). A negative button is only valid WITHOUT device cred.
                val bm = BiometricManager.from(reactContext)
                val hasBio =
                    bm.canAuthenticate(BiometricManager.Authenticators.BIOMETRIC_STRONG) == BiometricManager.BIOMETRIC_SUCCESS ||
                    bm.canAuthenticate(BiometricManager.Authenticators.BIOMETRIC_WEAK)   == BiometricManager.BIOMETRIC_SUCCESS
                val builder = BiometricPrompt.PromptInfo.Builder()
                    .setTitle(title)
                    .setSubtitle(subtitle)
                if (hasBio) {
                    builder.setAllowedAuthenticators(
                        BiometricManager.Authenticators.BIOMETRIC_STRONG or
                        BiometricManager.Authenticators.BIOMETRIC_WEAK
                    ).setNegativeButtonText("Cancel")
                } else {
                    // PIN/pattern/password — supplies its own cancel affordance.
                    builder.setAllowedAuthenticators(BiometricManager.Authenticators.DEVICE_CREDENTIAL)
                }
                prompt.authenticate(builder.build())
            } catch (e: Exception) {
                Log.e(TAG, "BiometricPrompt error: ${e.message}", e)
                promise.reject("PROMPT_ERROR", e.message ?: "Biometric prompt failed")
            }
        }
    }
}
