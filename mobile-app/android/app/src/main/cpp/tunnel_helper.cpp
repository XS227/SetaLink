#include <jni.h>
#include <fcntl.h>
#include <unistd.h>
#include <signal.h>
#include <sys/wait.h>
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

extern "C"
JNIEXPORT jint JNICALL
Java_com_setalink_vpn_XrayVpnService_nativeStartTun2socks(
        JNIEnv *env, jobject, jstring binPath, jint tunFd, jstring proxy, jstring logLevel) {
    const char *bin = env->GetStringUTFChars(binPath, nullptr);
    const char *proxyStr = env->GetStringUTFChars(proxy, nullptr);
    const char *level = env->GetStringUTFChars(logLevel, nullptr);

    pid_t pid = fork();
    if (pid == 0) {
        // child
        char deviceArg[64];
        snprintf(deviceArg, sizeof(deviceArg), "fd://%d", tunFd);
        execl(
            bin, bin,
            "--device", deviceArg,
            "--proxy", proxyStr,
            "--loglevel", level,
            (char *) nullptr
        );
        _exit(127);
    }

    env->ReleaseStringUTFChars(binPath, bin);
    env->ReleaseStringUTFChars(proxy, proxyStr);
    env->ReleaseStringUTFChars(logLevel, level);

    if (pid < 0) {
        __android_log_print(ANDROID_LOG_ERROR, TAG, "fork() failed while starting tun2socks");
        return -1;
    }
    __android_log_print(ANDROID_LOG_INFO, TAG, "tun2socks forked pid=%d with tun fd=%d", pid, tunFd);
    return (jint) pid;
}

extern "C"
JNIEXPORT jint JNICALL
Java_com_setalink_vpn_XrayVpnService_nativeTun2socksExitCode(JNIEnv *, jobject, jint pid) {
    if (pid <= 0) return -2;
    int status = 0;
    int ret = waitpid((pid_t) pid, &status, WNOHANG);
    if (ret == 0) return -2; // still running
    if (ret < 0) return -3; // waitpid error
    if (WIFEXITED(status)) return WEXITSTATUS(status);
    if (WIFSIGNALED(status)) return 128 + WTERMSIG(status);
    return -4;
}

extern "C"
JNIEXPORT void JNICALL
Java_com_setalink_vpn_XrayVpnService_nativeStopTun2socks(JNIEnv *, jobject, jint pid) {
    if (pid <= 0) return;
    kill((pid_t) pid, SIGTERM);
    usleep(200 * 1000);
    int status = 0;
    int ret = waitpid((pid_t) pid, &status, WNOHANG);
    if (ret == 0) {
        kill((pid_t) pid, SIGKILL);
        waitpid((pid_t) pid, &status, 0);
    }
}
