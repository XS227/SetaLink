package com.setalink

import com.facebook.react.ReactActivity
import com.facebook.react.ReactActivityDelegate
import com.facebook.react.defaults.DefaultReactActivityDelegate

class MainActivity : ReactActivity() {

    // Must match the name registered in index.js (from app.json → "Realink").
    // Mismatch throws "Application <name> has not been registered" at launch.
    override fun getMainComponentName(): String = "Realink"

    override fun createReactActivityDelegate(): ReactActivityDelegate =
        DefaultReactActivityDelegate(this, mainComponentName, false)
}
