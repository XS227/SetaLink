package com.setalink.vpn

/** Tracks physical upstream identity, independently of Android callback delivery order. */
internal class NetworkHandoverState {
    private var active = false
    private var seenNetwork = false
    private var upstream: Long? = null
    private var generation = 0L

    @Synchronized fun start() {
        active = true
        seenNetwork = false
        upstream = null
        generation++
    }

    /** Initial availability and duplicate callbacks do not request a restart. */
    @Synchronized fun available(handle: Long): Long? {
        if (!active || upstream == handle) return null
        val changed = seenNetwork
        seenNetwork = true
        upstream = handle
        generation++
        return if (changed) generation else null
    }

    /** A delayed loss for the old Wi-Fi must not erase the new mobile upstream. */
    @Synchronized fun lost(handle: Long): Boolean {
        if (!active || upstream != handle) return false
        upstream = null
        generation++
        return true
    }

    @Synchronized fun isCurrent(token: Long, handle: Long): Boolean =
        active && generation == token && upstream == handle

    @Synchronized fun accepts(handle: Long): Boolean = active && upstream == handle

    @Synchronized fun stop() {
        active = false
        upstream = null
        generation++
    }
}
