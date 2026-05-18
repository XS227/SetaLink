#include <cstdio>
#include <cstring>
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

// nativeStartTun2socks: fork/exec tun2socks, redirecting its stdout+stderr to
// logFilePath so we can read its output from Kotlin for diagnostics.
// The tunFd must have FD_CLOEXEC cleared (via nativeClearCloexec) before calling.
extern "C"
JNIEXPORT jint JNICALL
Java_com_setalink_vpn_XrayVpnService_nativeStartTun2socks(
        JNIEnv *env, jobject,
        jstring binPath, jint tunFd, jstring proxy, jstring logLevel, jstring logFilePath) {

    const char *bin      = env->GetStringUTFChars(binPath,     nullptr);
    const char *proxyStr = env->GetStringUTFChars(proxy,       nullptr);
    const char *level    = env->GetStringUTFChars(logLevel,    nullptr);
    const char *logFile  = env->GetStringUTFChars(logFilePath, nullptr);

    // Copy all strings before fork — JNI env must not be used in child.
    char binCopy[512], proxyCopy[256], levelCopy[32], logCopy[512];
    strncpy(binCopy,   bin,      sizeof(binCopy)   - 1);  binCopy[sizeof(binCopy)-1]   = '\0';
    strncpy(proxyCopy, proxyStr, sizeof(proxyCopy) - 1);  proxyCopy[sizeof(proxyCopy)-1]= '\0';
    strncpy(levelCopy, level,    sizeof(levelCopy) - 1);  levelCopy[sizeof(levelCopy)-1]= '\0';
    strncpy(logCopy,   logFile,  sizeof(logCopy)   - 1);  logCopy[sizeof(logCopy)-1]   = '\0';

    env->ReleaseStringUTFChars(binPath,     bin);
    env->ReleaseStringUTFChars(proxy,       proxyStr);
    env->ReleaseStringUTFChars(logLevel,    level);
    env->ReleaseStringUTFChars(logFilePath, logFile);

    pid_t pid = fork();
    if (pid == 0) {
        // ── child ─────────────────────────────────────────────────────────────
        // Redirect stdout+stderr to log file so the parent can read tun2socks output.
        int logFd = open(logCopy, O_WRONLY | O_CREAT | O_TRUNC, 0644);
        if (logFd >= 0) {
            dup2(logFd, STDOUT_FILENO);
            dup2(logFd, STDERR_FILENO);
            // Close the original after dup2; the copies at 1 and 2 stay open.
            if (logFd != STDOUT_FILENO && logFd != STDERR_FILENO) close(logFd);
        }

        char deviceArg[64];
        snprintf(deviceArg, sizeof(deviceArg), "fd://%d", tunFd);

        execl(binCopy, binCopy,
              "--device",   deviceArg,
              "--proxy",    proxyCopy,
              "--loglevel", levelCopy,
              (char *) nullptr);
        // If execl returns the binary wasn't found / not executable.
        _exit(127);
    }

    if (pid < 0) {
        __android_log_print(ANDROID_LOG_ERROR, TAG, "fork() failed while starting tun2socks");
        return -1;
    }
    __android_log_print(ANDROID_LOG_INFO, TAG,
        "tun2socks forked pid=%d tun_fd=%d log=%s", pid, tunFd, logCopy);
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
