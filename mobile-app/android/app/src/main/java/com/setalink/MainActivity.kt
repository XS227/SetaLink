package com.setalink

import android.content.Intent
import com.facebook.react.ReactActivity
import com.facebook.react.ReactActivityDelegate
import com.facebook.react.defaults.DefaultReactActivityDelegate

class MainActivity : ReactActivity() {

    // Must match the name registered in index.js (from app.json → "Realink").
    // Mismatch throws "Application <name> has not been registered" at launch.
    override fun getMainComponentName(): String = "Realink"

    override fun createReactActivityDelegate(): ReactActivityDelegate =
        DefaultReactActivityDelegate(this, mainComponentName, false)

    // A notification tap while the activity is alive (SINGLE_TOP) lands here,
    // not in onCreate. Without setIntent() the activity keeps returning the
    // ORIGINAL launch intent, so DmNotificationModule.consumeInitialRoute never
    // sees the tap's "setalink_route" extra and the tap navigates nowhere. DM
    // notifications only fire while the app process is alive (JS poll), so this
    // warm-tap path is effectively the only path.
    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
    }
}
