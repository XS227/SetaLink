# React Native
-keep class com.facebook.react.** { *; }
-keep class com.facebook.hermes.** { *; }
-keep class com.facebook.jni.**    { *; }

# SetaLink native modules
-keep class com.setalink.modules.** { *; }
-keep class com.setalink.vpn.**     { *; }

# Kotlin coroutines
-keepnames class kotlinx.coroutines.** { *; }

# Keep enums
-keepclassmembers enum * { *; }

# Remove logging in release
-assumenosideeffects class android.util.Log {
    public static *** d(...);
    public static *** v(...);
    public static *** i(...);
}
