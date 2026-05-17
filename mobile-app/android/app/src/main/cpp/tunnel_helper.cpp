#include <jni.h>
#include <fcntl.h>
#include <unistd.h>
#include <android/log.h>

#define TAG "TunnelHelper"

extern "C"
JNIEXPORT jint JNICALL
Java_com_setalink_vpn_XrayVpnService_nativeClearCloexec(JNIEnv *, jobject, jint fd) {
    int flags = fcntl(fd, F_GETFD);
    if (flags == -1) {
        __android_log_print(ANDROID_LOG_WARN, TAG, "fcntl(F_GETFD) failed for fd=%d", fd);
        return -1;
    }
    int ret = fcntl(fd, F_SETFD, flags & ~FD_CLOEXEC);
    if (ret == -1) {
        __android_log_print(ANDROID_LOG_WARN, TAG, "fcntl(F_SETFD) failed for fd=%d", fd);
    } else {
        __android_log_print(ANDROID_LOG_DEBUG, TAG, "FD_CLOEXEC cleared on fd=%d (was flags=0x%x)", fd, flags);
    }
    return ret;
}
