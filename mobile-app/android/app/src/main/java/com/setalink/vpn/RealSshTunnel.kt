package com.setalink.vpn

import android.content.Context
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import net.schmizz.sshj.SSHClient
import net.schmizz.sshj.common.Buffer
import net.schmizz.sshj.connection.channel.direct.DirectConnection
import org.bouncycastle.jce.provider.BouncyCastleProvider
import java.io.InputStream
import java.io.OutputStream
import java.net.InetAddress
import java.net.ServerSocket
import java.net.Socket
import java.security.KeyFactory
import java.security.KeyPair
import java.security.KeyPairGenerator
import java.security.PublicKey
import java.security.Security
import java.security.spec.PKCS8EncodedKeySpec
import java.security.spec.X509EncodedKeySpec
import java.util.Base64
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean

/**
 * REAL SSH (transport 'real_ssh') — plain SSH dynamic-forward (SOCKS5-over-SSH)
 * fallback transport. Owns exactly two things: (1) the device's on-device
 * Ed25519 identity (generated once, private key never leaves this storage,
 * only the public key is ever handed to JS for backend provisioning), and
 * (2) a minimal SOCKS5 server whose CONNECT requests are satisfied by opening
 * an SSH direct-tcpip channel — the "-D dynamic forward" primitive — instead
 * of a local socket. XrayVpnService points the SAME tun2socks invocation it
 * already uses for Xray at this class's SOCKS5 port instead of Xray's 10808,
 * so TUN creation / metrics / traffic-stall watchdog / teardown ordering are
 * all reused unmodified.
 *
 * DNS: SOCKS5 CONNECT requests carry either an IP or a hostname; when it's a
 * hostname, sshj's direct-tcpip channel hands the hostname string to the SSH
 * SERVER, which resolves it — exactly like a real `ssh -D` dynamic forward.
 * No separate DNS path needed; nothing resolves locally.
 */
class RealSshTunnel(
    private val context: Context,
    private val log: (String) -> Unit,
) {
    companion object {
        private const val PREFS_FILE = "realgram_real_ssh_identity"
        private const val KEY_PUBLIC     = "ed25519_public_openssh"     // "ssh-ed25519 AAAA..." for upload/display
        private const val KEY_PUBLIC_DER = "ed25519_public_x509_b64"    // raw SPKI DER, for KeyFactory round-trip
        private const val KEY_PRIVATE    = "ed25519_private_pkcs8_b64"

        @Volatile private var bcRegistered = false
        private fun ensureBouncyCastle() {
            if (!bcRegistered) {
                synchronized(this) {
                    // Android ships its own provider already registered under the
                    // name "BC" — a stripped legacy AOSP BouncyCastle with no
                    // Ed25519 support. `getProvider("BC") == null` is therefore
                    // never true on a real device, so the real bcprov-jdk18on
                    // provider we depend on never got installed and
                    // KeyPairGenerator/KeyFactory.getInstance("Ed25519", "BC")
                    // resolved to Android's crippled one and threw
                    // NoSuchAlgorithmException. Must replace it, not skip it.
                    Security.removeProvider("BC")
                    Security.insertProviderAt(BouncyCastleProvider(), 1)
                    bcRegistered = true
                }
            }
        }
    }

    data class Identity(val publicKeyOpenSsh: String)

    private var ssh: SSHClient? = null
    private var socksServer: ServerSocket? = null
    private val accepting = AtomicBoolean(false)
    private val executor = Executors.newCachedThreadPool()
    private val activeSockets = CopyOnWriteArrayList<Socket>()

    private fun encryptedPrefs(): android.content.SharedPreferences {
        val masterKey = MasterKey.Builder(context)
            .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
            .build()
        return EncryptedSharedPreferences.create(
            context, PREFS_FILE, masterKey,
            EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
            EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
        )
    }

    /** OpenSSH wire-format ("ssh-ed25519 AAAA...") encoding of a public key,
     *  reusing sshj's own wire-encoder (the exact bytes it hashes for host-key
     *  fingerprints) so this matches what any SSH tooling expects. */
    private fun toOpenSshPublicKey(key: PublicKey): String {
        val wire = Buffer.PlainBuffer().putPublicKey(key).compactData
        return "ssh-ed25519 " + Base64.getEncoder().encodeToString(wire)
    }

    /** Generates (once) or returns the device's existing Ed25519 identity.
     *  Only the PUBLIC key is ever returned — the private key stays in
     *  encrypted-at-rest storage and never crosses this boundary. */
    @Synchronized
    fun getOrCreateIdentity(): Identity {
        ensureBouncyCastle()
        val prefs = encryptedPrefs()
        val existingPub  = prefs.getString(KEY_PUBLIC, null)
        val existingPriv = prefs.getString(KEY_PRIVATE, null)
        if (!existingPub.isNullOrBlank() && !existingPriv.isNullOrBlank()) {
            return Identity(existingPub)
        }

        val kpg = KeyPairGenerator.getInstance("Ed25519", "BC")
        val kp = kpg.generateKeyPair()
        val opensshPub = toOpenSshPublicKey(kp.public)
        val pubDerB64  = Base64.getEncoder().encodeToString(kp.public.encoded)
        val privB64    = Base64.getEncoder().encodeToString(kp.private.encoded)

        prefs.edit()
            .putString(KEY_PUBLIC, opensshPub)
            .putString(KEY_PUBLIC_DER, pubDerB64)
            .putString(KEY_PRIVATE, privB64)
            .apply()
        log("real_ssh identity: generated new on-device Ed25519 keypair")
        return Identity(opensshPub)
    }

    private fun loadKeyPair(): KeyPair {
        val prefs = encryptedPrefs()
        val pubDerB64 = prefs.getString(KEY_PUBLIC_DER, null) ?: throw IllegalStateException("no REAL SSH identity provisioned")
        val privB64   = prefs.getString(KEY_PRIVATE, null)    ?: throw IllegalStateException("no REAL SSH identity provisioned")
        ensureBouncyCastle()
        val kf = KeyFactory.getInstance("Ed25519", "BC")
        val priv = kf.generatePrivate(PKCS8EncodedKeySpec(Base64.getDecoder().decode(privB64)))
        val pub  = kf.generatePublic(X509EncodedKeySpec(Base64.getDecoder().decode(pubDerB64)))
        return KeyPair(pub, priv)
    }

    /**
     * Connects to the VPS and starts the local SOCKS5-over-SSH bridge.
     * Returns the local port tun2socks should point at. Blocking — call off
     * the main thread (XrayVpnService already runs establishTunnel on
     * Dispatchers.IO).
     */
    fun connect(
        host: String,
        port: Int,
        username: String,
        hostKeyFingerprint: String,
        localSocksPort: Int,
    ) {
        ensureBouncyCastle()
        val client = SSHClient()
        client.addHostKeyVerifier(hostKeyFingerprint)
        client.connectTimeout = 15_000
        client.timeout = 15_000
        log("ssh_tcp_connect: connecting to $host:$port")
        client.connect(host, port)
        log("ssh_tcp_connect: TCP+handshake OK, host key verified against pinned fingerprint")

        val keyPair = loadKeyPair()
        log("ssh_authenticate: authenticating as $username")
        client.authPublickey(username, client.loadKeys(keyPair))
        log("ssh_authenticate: OK")
        ssh = client

        startSocksServer(localSocksPort)
        log("socks_bridge_ready: SOCKS5-over-SSH listening on 127.0.0.1:$localSocksPort")
    }

    private fun startSocksServer(port: Int) {
        val server = ServerSocket(port, 128, InetAddress.getByName("127.0.0.1"))
        socksServer = server
        accepting.set(true)
        executor.execute {
            while (accepting.get()) {
                val client = try { server.accept() } catch (_: Exception) { break }
                activeSockets.add(client)
                executor.execute { handleSocksClient(client) }
            }
        }
    }

    private fun handleSocksClient(client: Socket) {
        try {
            val input = client.getInputStream()
            val output = client.getOutputStream()

            // Greeting: VER=5, NMETHODS, METHODS[NMETHODS]. We accept
            // no-auth-required regardless of what the client offers.
            val ver = input.read()
            if (ver != 0x05) { client.close(); return }
            val nMethods = input.read()
            if (nMethods > 0) readFully(input, ByteArray(nMethods))
            output.write(byteArrayOf(0x05, 0x00)); output.flush()

            // Request: VER=5, CMD, RSV=0, ATYP, DST.ADDR, DST.PORT(2, BE).
            val reqHead = ByteArray(4)
            readFully(input, reqHead)
            if (reqHead[0].toInt() != 0x05 || reqHead[1].toInt() != 0x01) {
                // Only CONNECT is supported — tun2socks never asks for BIND/UDP.
                output.write(socksReply(0x07)); output.flush(); client.close(); return
            }
            val destHost = when (reqHead[3].toInt()) {
                0x01 -> { val b = ByteArray(4); readFully(input, b); InetAddress.getByAddress(b).hostAddress }
                0x04 -> { val b = ByteArray(16); readFully(input, b); InetAddress.getByAddress(b).hostAddress }
                0x03 -> { val len = input.read(); val b = ByteArray(len); readFully(input, b); String(b, Charsets.US_ASCII) }
                else -> { output.write(socksReply(0x08)); output.flush(); client.close(); return }
            }
            val portBytes = ByteArray(2)
            readFully(input, portBytes)
            val destPort = ((portBytes[0].toInt() and 0xFF) shl 8) or (portBytes[1].toInt() and 0xFF)

            val channel: DirectConnection = try {
                ssh?.newDirectConnection(destHost, destPort)
                    ?: throw IllegalStateException("SSH session not connected")
            } catch (e: Exception) {
                log("socks_connect_fail: $destHost:$destPort — ${e.message}")
                output.write(socksReply(0x05)); output.flush(); client.close(); return
            }

            output.write(socksReply(0x00)); output.flush()

            pipe(input, channel.outputStream, client, channel)
            pipe(channel.inputStream, output, channel, client)
        } catch (_: Exception) {
            runCatching { client.close() }
        }
    }

    private fun socksReply(code: Int): ByteArray =
        byteArrayOf(0x05, code.toByte(), 0x00, 0x01, 0, 0, 0, 0, 0, 0)

    private fun readFully(input: InputStream, buf: ByteArray) {
        var off = 0
        while (off < buf.size) {
            val n = input.read(buf, off, buf.size - off)
            if (n < 0) throw java.io.EOFException("SOCKS5 handshake truncated")
            off += n
        }
    }

    /** Copies src->dst until EOF/error, then closes both endpoints. Runs on
     *  its own executor thread so the two directions of one connection don't
     *  block each other. */
    private fun pipe(src: InputStream, dst: OutputStream, a: AutoCloseable, b: AutoCloseable) {
        executor.execute {
            val buf = ByteArray(16 * 1024)
            try {
                while (true) {
                    val n = src.read(buf)
                    if (n < 0) break
                    dst.write(buf, 0, n)
                    dst.flush()
                }
            } catch (_: Exception) {
            } finally {
                runCatching { a.close() }
                runCatching { b.close() }
            }
        }
    }

    /** Tears down the SOCKS bridge and the SSH session. Idempotent. */
    fun disconnect() {
        accepting.set(false)
        runCatching { socksServer?.close() }
        socksServer = null
        activeSockets.forEach { runCatching { it.close() } }
        activeSockets.clear()
        runCatching { ssh?.disconnect() }
        runCatching { ssh?.close() }
        ssh = null
    }

    fun isConnected(): Boolean = ssh?.isConnected == true && ssh?.isAuthenticated == true
}
