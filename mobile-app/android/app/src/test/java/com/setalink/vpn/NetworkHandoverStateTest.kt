package com.setalink.vpn

import org.junit.Assert.*
import org.junit.Test

class NetworkHandoverStateTest {
    @Test fun initialNetworkAndDuplicateDoNotRestart() {
        val state = NetworkHandoverState()
        state.start()
        assertNull(state.available(1))
        assertNull(state.available(1))
        assertTrue(state.accepts(1))
    }

    @Test fun wifiToMobileAndBackCreatesNewRecoveryTokens() {
        val state = NetworkHandoverState()
        state.start()
        state.available(1)
        val mobile = state.available(2)!!
        assertTrue(state.isCurrent(mobile, 2))
        val wifi = state.available(1)!!
        assertFalse(state.isCurrent(mobile, 2))
        assertTrue(state.isCurrent(wifi, 1))
    }

    @Test fun oldNetworkLossDoesNotCancelNewNetworkRecovery() {
        val state = NetworkHandoverState()
        state.start()
        state.available(1)
        val token = state.available(2)!!
        assertFalse(state.lost(1))
        assertTrue(state.isCurrent(token, 2))
    }

    @Test fun lossCancelsPendingRecoveryAndReturnRequestsNewRecovery() {
        val state = NetworkHandoverState()
        state.start()
        state.available(1)
        val token = state.available(2)!!
        assertTrue(state.lost(2))
        assertFalse(state.isCurrent(token, 2))
        assertNotNull(state.available(2))
    }

    @Test fun manualStopInvalidatesPendingAndLateCallbacks() {
        val state = NetworkHandoverState()
        state.start()
        state.available(1)
        val token = state.available(2)!!
        state.stop()
        assertFalse(state.isCurrent(token, 2))
        assertNull(state.available(3))
        assertFalse(state.accepts(3))
        state.start()
        assertNull(state.available(3))
    }
}
